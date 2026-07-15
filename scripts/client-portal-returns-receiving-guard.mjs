import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
import { readSourceTree } from './lib/source-tree.mjs';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '';

let failed = false;
function assert(cond, msg) {
  console[cond ? 'log' : 'error'](`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failed = true;
}

function stripLineComments(src) {
  return src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
}

const route = readSourceTree([
  'src/routes/client-portal/returns.ts',
  'src/routes/client-portal/returns',
]);
const routeCode = stripLineComments(route);
const receivingRouteCode = stripLineComments(read('src/routes/client-portal/returns/receiving.ts'));
const api = readActiveClientPortalApiSource();
const activityService = read('src/services/return-activity.ts');
const hooks = read('portal-client/src/lib/hooks.ts');
const page = [
  read('portal-client/src/pages/Returns.tsx'),
  read('portal-client/src/components/returns/ReturnDetailDrawer.tsx'),
  read('portal-client/src/components/returns/ReturnInspectionHistory.tsx'),
  read('portal-client/src/components/returns/ReturnAttachmentGallery.tsx'),
  read('portal-client/src/components/returns/ReturnHistoryTimeline.tsx'),
  read('portal-client/src/components/returns/returnPresentation.ts'),
].join('\n');
const receiving = read('portal-client/src/components/returns/ReturnReceivingModal.tsx');
const inspectionEditor = read('portal-client/src/components/returns/ReturnInspectionEditor.tsx');
const receivingUi = `${receiving}\n${inspectionEditor}`;
const envFile = read('src/lib/env.ts');
const supa = read('src/lib/supabase.ts');
const pkg = JSON.parse(read('package.json'));

// ── 0. The new endpoints exist ──
assert(route.length > 0, 'src/routes/client-portal/returns.ts exists');
assert(
  /app\.get\('\/returns\/receiving'/.test(route),
  'GET /returns/receiving (the receiving queue) is declared',
);
assert(
  /app\.post\('\/returns\/:id\{\[0-9\]\+\}\/inspection'/.test(route),
  'POST /returns/:id/inspection (record inspection) is declared',
);
assert(
  /app\.post\('\/returns\/:id\{\[0-9\]\+\}\/inspection\/:iid\{\[0-9\]\+\}\/media'/.test(route),
  'POST /returns/:id/inspection/:iid/media (attach media) is declared',
);

// ── 1. Receiving queue is operator-only; scoped clients may write inspections ──
assert(
  /!scope\.isGlobal\s*&&\s*!scope\.permissions\.includes\('settings:write'\)/.test(routeCode),
  "the operator gate (!scope.isGlobal && !scope.permissions.includes('settings:write')) is present",
);
assert(
  /function operatorGateOrResponse\(/.test(routeCode),
  'a single operatorGateOrResponse helper carries the 403 operator gate',
);
const receivingQueueStart = receivingRouteCode.indexOf('function registerReceivingQueueRoute');
const inspectionStart = receivingRouteCode.indexOf('function registerInspectionRoute');
const mediaStart = receivingRouteCode.indexOf('function registerInspectionMediaRoute');
const registrationStart = receivingRouteCode.indexOf('export function registerReturnReceivingRoutes');
const receivingQueueBlock = receivingRouteCode.slice(receivingQueueStart, inspectionStart);
const inspectionBlock = receivingRouteCode.slice(inspectionStart, mediaStart);
const mediaBlock = receivingRouteCode.slice(mediaStart, registrationStart);
assert(
  /operatorGateOrResponse\(c,\s*scope\)/.test(receivingQueueBlock),
  'the warehouse receiving queue remains operator-gated',
);
assert(
  /operatorGateOrResponse[\s\S]{0,220}?return\s+c\.json\(\s*\{\s*error:[^}]*\}\s*,\s*403\s*\)/.test(routeCode),
  'the receiving-queue operator gate returns a 403',
);
assert(
  !/operatorGateOrResponse\(/.test(inspectionBlock) && !/operatorGateOrResponse\(/.test(mediaBlock),
  'authenticated clients may create inspections and media without an operator role',
);

// ── 2. Scope-gated + scope-revalidated like the siblings ──
assert(
  /scopeOrResponse\(c\)/.test(routeCode) && /isClientPortalScope/.test(routeCode),
  'the new endpoints use scopeOrResponse + isClientPortalScope (same scope guard as the siblings)',
);
// The receiving list + inspection + media must all be bounded by
// returnScopePredicate so a client can only touch its own returns.
const scopePredicateUses = (routeCode.match(/returnScopePredicate\(/g) || []).length;
assert(
  scopePredicateUses >= 6,
  `the receiving/inspection/media surfaces re-validate scope with returnScopePredicate (${scopePredicateUses} total uses)`,
);
// The media write validates the inspection belongs to the return.
assert(
  /returnInspections\.returnId/.test(routeCode) && /eq\(returnInspections\.id,\s*iid\)/.test(routeCode),
  'the media write validates the inspection belongs to THIS return (returnId + inspection id)',
);
assert(
  /returnScopePredicate\(scope\)/.test(inspectionBlock) && /returnScopePredicate\(scope\)/.test(mediaBlock),
  'both client write endpoints enforce canonical return scope',
);
// Audit on the new surfaces.
assert(
  /portal\.returns\.receiving\.list/.test(routeCode) &&
    /portal\.returns\.inspection\.record/.test(routeCode) &&
    /portal\.returns\.inspection\.media\.add/.test(routeCode),
  'the receiving/inspection/media surfaces are audited (recordPortalAudit events)',
);

// ── 3. Media persists to return_inspection_media, linked, no binary-in-DB ──
assert(
  /db\s*\.insert\(returnInspectionMedia\)/.test(routeCode) || /insert\(returnInspectionMedia\)/.test(routeCode),
  'inspection media persists to the return_inspection_media table',
);
assert(
  /inspectionId:\s*iid/.test(routeCode),
  'the media row is linked to the inspection (inspectionId)',
);
assert(
  /storageRef/.test(routeCode) && /mediaType/.test(routeCode),
  'media is stored as metadata (storageRef + mediaType) — never a binary in the DB',
);
// Guard against a binary-in-DB regression: the route must not persist base64 /
// raw file bytes / a data-URI blob column.
for (const bad of ['base64', 'Buffer.from', 'bytea', 'blobData', 'fileData']) {
  assert(
    !new RegExp(bad).test(routeCode),
    `the media write never stores a binary in the DB (no ${bad})`,
  );
}
// inspectorEmail is stamped from the caller's scope, not client-supplied.
assert(
  /inspectorEmail:\s*scope\.email/.test(routeCode),
  'the inspection stamps inspectorEmail from the caller scope (not client-supplied)',
);
assert(
  /const inspectorType\s*=\s*scope\.isGlobal\s*\|\|\s*scope\.permissions\.includes\('settings:write'\)/.test(routeCode) &&
    /inspectorEmail:\s*scope\.email[\s\S]{0,100}?inspectorType,/.test(routeCode) &&
    /actorLabel:\s*inspection\.inspectorType\s*===\s*'client'/.test(routeCode),
  'inspection history distinguishes client submissions from PrepShip operators',
);

// ── 3b. CP-030 acceptance: media is DURABLE (Supabase Storage), not preview-only ──
// The media endpoint relays the uploaded binary to a PRIVATE Supabase bucket
// (only the backend holds the service key) and stores the returned object PATH;
// the detail endpoint serves media back through short-lived SIGNED URLs. No
// blob: preview URL is ever persisted.
assert(
  /await c\.req\.formData\(\)/.test(routeCode),
  'the media endpoint accepts a multipart/form-data file upload (not a JSON storageRef)',
);
assert(
  /uploadReturnInspectionMedia\(/.test(routeCode),
  'the media endpoint uploads the binary to durable storage (uploadReturnInspectionMedia)',
);
assert(
  /getReturnMediaSignedUrl\(/.test(routeCode),
  'the return detail serves media via short-lived signed URLs (getReturnMediaSignedUrl)',
);
assert(
  /RETURNS_MEDIA_BUCKET/.test(envFile) && /RETURNS_MEDIA_BUCKET/.test(supa),
  'a configurable RETURNS_MEDIA_BUCKET backs the storage helpers',
);
assert(
  /createSignedUrl\(/.test(supa) && /\.upload\(/.test(supa),
  'the storage helper uploads objects and mints signed URLs (private bucket — never public)',
);
assert(
  /PHOTO_MAX_BYTES\s*=\s*15\s*\*\s*1024\s*\*\s*1024/.test(routeCode) &&
    /VIDEO_MAX_BYTES\s*=\s*25\s*\*\s*1024\s*\*\s*1024/.test(routeCode) &&
    /mediaType\s*===\s*'photo'\s*\?\s*PHOTO_MAX_BYTES\s*:\s*VIDEO_MAX_BYTES/.test(routeCode),
  'the backend enforces 15 MB photos and 25 MB videos independently',
);
// The frontend uploads the real File and never persists a blob: object URL.
assert(
  /uploadInspectionMedia\(/.test(stripLineComments(receivingUi)),
  'the shared receiving editor uploads captured files via uploadInspectionMedia (durable), not preview-only',
);
assert(
  !/createObjectURL/.test(receivingUi),
  'the receiving UI creates no blob: object URL for media (no createObjectURL)',
);
assert(
  !/Photos not saved yet/.test(receivingUi),
  'the preview-only "Photos not saved yet" stub is gone (media is durably uploaded)',
);
// The client return detail renders the inspection media (signed URL) so the
// client can view what the 3PL captured.
assert(
  /ReturnAttachmentGallery/.test(page) && /item\.url/.test(page),
  'the client return detail renders inspection media via its (signed) url',
);
assert(
  /insert\(returnInspections\)/.test(routeCode) && !/update\(returnInspections\)/.test(routeCode),
  'inspection writes are append-only so prior receiving notes remain history',
);
assert(
  /originalFileName:\s*safeName/.test(routeCode) && /uploadedByEmail:\s*scope\.email/.test(routeCode),
  'attachment metadata records its safe file name and server-derived uploader',
);

// ── 4. The condition enum is exactly the agreed 6-value set ──
const CONDITIONS = ['sealed_new', 'opened_good', 'damaged', 'missing_item', 'wrong_item', 'other'];
for (const cond of CONDITIONS) {
  assert(new RegExp(`'${cond}'`).test(routeCode), `the condition enum includes '${cond}'`);
}
assert(
  /INSPECTION_CONDITIONS\s*=\s*new Set\(/.test(routeCode) &&
    /INSPECTION_CONDITIONS\.has\(/.test(routeCode),
  'the inspection endpoint validates condition against the agreed enum set (rejects anything else)',
);

// ── 5. Out of scope: no refund issuance, no marketplace calls ──
// Literal substring checks (not RegExp) so tokens like 'refund(' don't blow up.
for (const bad of ['issueRefund', 'refund(', 'marketplace', 'notifyMarketplace']) {
  assert(!routeCode.includes(bad), `the receiving route never issues refunds / calls a marketplace (no ${bad})`);
}

// ── 6. Frontend: api + hook wiring ──
assert(
  /returnsReceiving:/.test(api) && /recordInspection:/.test(api) && /uploadInspectionMedia:/.test(api),
  'portalApi exposes returnsReceiving + recordInspection + uploadInspectionMedia',
);
assert(
  /\/api\/client-portal\/returns\/receiving/.test(api) &&
    /\/inspection`/.test(api) &&
    /\/inspection\/\$\{inspectionId\}\/media`/.test(api),
  'the api methods hit the receiving / inspection / media endpoints',
);
assert(
  /useReturnsReceiving/.test(hooks),
  'the frontend exposes a useReturnsReceiving hook',
);

// ── 7. Frontend: the mobile receiving UI exists + is operator-gated ──
assert(receiving.length > 0, 'the ReturnReceivingModal component exists');
const pageCode = stripLineComments(page);
// The page must import + mount the receiving modal AND gate it on the operator
// role (isAdmin || isGlobal from useMe).
assert(
  /ReturnReceivingModal/.test(pageCode),
  'the Returns page uses the ReturnReceivingModal',
);
assert(
  /useMe\(\)/.test(pageCode) && /(isAdmin|isGlobal)/.test(pageCode),
  'the Returns page reads the operator role from useMe (isAdmin / isGlobal)',
);
assert(
  /isOperator\s*&&/.test(pageCode),
  'the receiving entry point + modal are gated on the operator role (isOperator &&)',
);

// ── 8. Mobile-capture inspection form (photo/video), phone-first ──
const receivingCode = stripLineComments(receiving);
const receivingUiCode = stripLineComments(receivingUi);
assert(
  /type="file"/.test(receivingUiCode) &&
    /accept="image\/\*,video\/\*"/.test(receivingUiCode) &&
    /capture=/.test(receivingUiCode),
  'the inspection form uses a mobile-capture file input (accept image/video + capture)',
);
assert(
  /PHOTO_MAX_BYTES\s*=\s*15\s*\*\s*1024\s*\*\s*1024/.test(receivingUiCode) &&
    /VIDEO_MAX_BYTES\s*=\s*25\s*\*\s*1024\s*\*\s*1024/.test(receivingUiCode),
  'the client validates 15 MB photos and 25 MB videos before upload',
);
assert(
  /onDragOver=\{allowFileDrop\}/.test(receivingUiCode) &&
    /onDrop=\{dropFiles\}/.test(receivingUiCode) &&
    /captureFiles\(event\.dataTransfer\.files\)/.test(receivingUiCode),
  'the inspection media picker supports drag-and-drop through the validated captureFiles path',
);
// The 6 condition values are offered in the form.
for (const cond of CONDITIONS) {
  assert(new RegExp(`'${cond}'`).test(receivingUiCode), `the inspection form offers the '${cond}' condition`);
}
// A received date/time field + a scan/search box are present (phone receiving).
assert(
  /datetime-local/.test(receivingUiCode),
  'the inspection form captures a received date/time',
);
assert(
  /Scan or|scan|Scan/.test(receiving) && /useReturnsReceiving/.test(receivingCode),
  'the receiving flow has a scan/search box backed by the receiving queue',
);
// The receiving flow must not compute rates/carrier or issue refunds.
for (const bad of ['getRates', 'carrierCode', 'issueRefund', 'cheapest', 'bestRate']) {
  assert(!new RegExp(bad).test(receivingUiCode), `the receiving flow never computes rates/carrier or refunds (no ${bad})`);
}

assert(
  /ReturnInspectionEditor/.test(receiving) && /ReturnInspectionEditor/.test(page),
  'the same inspection editor is available from the receiving flow and clicked return drawer',
);
assert(
  /<ReturnInspectionEditor\s+returnId=\{detail\.id\}\s*\/>/.test(pageCode) && !/canInspect/.test(pageCode),
  'the clicked return drawer exposes inspection notes and attachments to scoped client users',
);
assert(
  /ReturnDrawerTabs/.test(page) && /ReturnHistoryTimeline/.test(page) && /ReturnInspectionHistory/.test(page),
  'the clicked return drawer contains Overview, Inspection, and History views',
);
assert(
  /listReturnActivity/.test(activityService) && /listOriginalOrderActivity/.test(activityService) && /orderActivity/.test(api),
  'the side-panel history combines persisted return events with canonical original-order milestones',
);
const activityType = api.slice(api.indexOf('export type PortalReturnActivity'), api.indexOf('export interface PortalReturnDetail'));
for (const forbidden of ['actorEmail', 'shipmentId', 'carrierCode', 'serviceCode', 'selectedRate']) {
  assert(!activityType.includes(forbidden), `return activity DTO redacts ${forbidden}`);
}
assert(
  /Retry failed uploads/.test(inspectionEditor) && /status:\s*'failed'/.test(inspectionEditor),
  'failed attachment uploads remain retryable without creating another inspection',
);

// ── package.json wiring ──
assert(
  pkg.scripts?.['test:client-portal-returns-receiving'] ===
    'node scripts/client-portal-returns-receiving-guard.mjs',
  'package.json exposes test:client-portal-returns-receiving',
);

if (failed) process.exit(1);
console.log('\nCP-030 client-portal Returns receiving guard passed.');
