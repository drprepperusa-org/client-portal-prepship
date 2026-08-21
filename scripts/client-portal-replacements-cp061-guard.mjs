// CP-061 guard — the Replace portal surface stays a shadow renderer.
//
// Pins:
//   1. portal-client NEVER derives the badge: no replacement-status filtering
//      or cancelled-comparison in TSX; badge renders reference
//      hasActiveReplacement only.
//   2. The replacements route file has NO local write path (no db.insert /
//      db.update / db.delete) — create only FORWARDS to PREPSHIP_API_URL.
//   3. The contract exposes no operator/internal fields.
//   4. The capability canRequestReplacements exists and gates the POST.
//   5. Both replacement read paths are readiness-gated (schema absent in prod).
//   6. The schema mirror carries none of the operator/internal columns.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function check(condition, message) {
  if (condition) console.log(`  PASS ${message}`);
  else {
    console.error(`  FAIL ${message}`);
    failures += 1;
  }
}
const read = (path) => readFileSync(path, 'utf8');
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

// 1. No local badge derivation in the frontend.
const clientFiles = walk('portal-client/src');
const offenders = clientFiles.filter((path) => {
  const text = stripComments(read(path));
  // Only replacement-aware files can offend: deriving activeness from status
  // comparisons or filtering replacement rows client-side.
  if (!/replacement/i.test(text)) return false;
  return (
    /status\s*!==?\s*'cancelled'/.test(text) ||
    /replacements?\.(filter|some|find)\(/.test(text)
  );
});
check(
  offenders.length === 0,
  `portal-client never derives the badge locally (offenders: ${offenders.join(', ') || 'none'})`,
);
const ordersPage = stripComments(read('portal-client/src/pages/Orders.tsx'));
const detailPanel = stripComments(read('portal-client/src/components/OrderDetailPanel.tsx'));
check(
  ordersPage.includes('o.hasActiveReplacement') && ordersPage.includes('REPLACE'),
  'Orders list badge renders from hasActiveReplacement',
);
check(
  detailPanel.includes('o.hasActiveReplacement') && detailPanel.includes('REPLACE'),
  'Order detail badge renders from hasActiveReplacement',
);

// 2. Forward-only mutation proxy.
const route = stripComments(read('src/routes/client-portal/replacements.ts'));
check(
  !/db\.(insert|update|delete)/.test(route) && !route.includes("from '../../db/client'"),
  'replacements route has no local write path (forward-only proxy)',
);
check(
  route.includes('PREPSHIP_API_URL') && route.includes('upstream.status'),
  'create forwards to PREPSHIP_API_URL and passes the upstream status verbatim',
);
check(
  route.includes('canRequestReplacements'),
  'POST is gated on the canRequestReplacements capability',
);

// 3. Contract redaction.
const contract = stripComments(read('src/lib/client-portal/contracts/replacements.ts'));
const forbiddenContract = [
  'reviewReason', 'adminOverride', 'approvedBy', 'idempotency', 'signature',
  'fingerprint', 'liabilityOwner', 'billable', 'stateVersion', 'carrierCode', 'serviceCode',
];
check(
  forbiddenContract.every((key) => !contract.includes(key)),
  'replacement contract exposes no operator/internal fields',
);
check(
  ['hasActiveReplacement', 'replacementStatus', 'replacementCount', 'replacementReference'].every(
    (key) => contract.includes(key),
  ),
  'contract defines the four backend-derived badge fields',
);

// 4. Capability minted.
const capabilities = stripComments(read('src/lib/client-portal/capabilities.ts'));
check(
  capabilities.includes('canRequestReplacements') && capabilities.includes("'replacements:request'"),
  'canRequestReplacements capability minted on the replacements:request permission',
);

// 5. Readiness gating.
const readModel = stripComments(read('src/lib/client-portal/read-models/replacements.ts'));
const ordersReadModel = stripComments(read('src/lib/client-portal/read-models/orders.ts'));
check(
  (readModel.match(/replacementsSchemaReady\(\)/g) || []).length >= 2,
  'list and detail reads are schema-readiness gated',
);
check(
  ordersReadModel.includes('replacementsSchemaReady') &&
    ordersReadModel.includes('orderReplacementBadgeSelects'),
  'order read model gates the badge selects on schema readiness',
);

// 6. Schema mirror redaction.
const mirror = stripComments(read('src/db/schema/replacements.ts'));
const forbiddenColumns = [
  'review_reason', 'admin_override', 'request_idempotency_key', 'request_signature',
  'source_line_fingerprint', 'liability_owner', 'billable', 'state_version',
];
check(
  forbiddenColumns.every((column) => !mirror.includes(column)),
  'schema mirror omits every operator/internal column',
);

// package.json wiring.
const pkg = JSON.parse(read('package.json'));
check(
  pkg.scripts?.['test:client-portal-replacements-cp061'] ===
    'node scripts/client-portal-replacements-cp061-guard.mjs',
  'package.json exposes test:client-portal-replacements-cp061',
);

if (failures > 0) {
  console.error(`\n✖ CP-061 guard: ${failures} failing check(s).`);
  process.exit(1);
}
console.log('\nPASS CP-061 Replace shadow-renderer guard');
