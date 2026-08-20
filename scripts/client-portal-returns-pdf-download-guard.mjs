// Guard: Returns must make the return-label PDF state obvious from the list,
// and the detail drawer must explain when a PDF is not ready yet.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failed = false;
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed = true;
  } else {
    console.log(`PASS ${message}`);
  }
}

const page = [
  read('portal-client/src/pages/Returns.tsx'),
  read('portal-client/src/components/returns/ReturnDetailDrawer.tsx'),
  read('portal-client/src/components/returns/returnPresentation.ts'),
].join('\n');
const main = read('src/main.ts');
const mockLabelsRoute = read('src/routes/mock-labels.ts');
const mockLabelAccess = read('src/lib/mock-label-access.ts');
const returnReads = read('src/routes/client-portal/returns/reads.ts');
const returnDto = read('src/routes/client-portal/returns/dto.ts');
const returnDelivery = read('src/services/return-delivery.ts');
const returnPdfAccess = read('src/lib/client-portal/return-label-pdf.ts');
const pkg = JSON.parse(read('package.json'));

assert(
  pkg.scripts?.['test:client-portal-returns-pdf-download'] ===
    'node scripts/client-portal-returns-pdf-download-guard.mjs',
  'package exposes test:client-portal-returns-pdf-download',
);
assert(/header:\s*'Label PDF'/.test(page), 'Returns table has a Label PDF column');
assert(/row\.pdfAvailable/.test(page), 'Returns table renders the backend pdfAvailable flag');
assert(/Download/.test(page) && /setSelectedId\(row\.id\)/.test(page), 'Returns table has an obvious Download entry that opens the return detail');
assert(/Label pending/.test(page), 'Returns table explains when the label PDF is pending');
assert(/Return label PDF is not ready yet/.test(page), 'Return detail explains why no PDF button is shown yet');
assert(/Create return label/.test(page), 'Return detail lets a pending return retry PrepShip label creation');
assert(/portalApi\.createReturnLabel/.test(page), 'Return detail retry delegates to the backend return-label endpoint');
assert(/Download return label/.test(page) && /pdfHref/.test(page), 'Return detail still exposes the actual PDF download link when ready');
assert(
  main.includes("app.route('/labels/mock', mockLabelsRoute)") &&
    main.indexOf("app.route('/labels/mock', mockLabelsRoute)") < main.lastIndexOf('if (!clientPortalOnly) {'),
  'portal-only API mounts the narrow signed mock-label download route',
);
assert(
  mockLabelsRoute.includes('verifyMockLabelSignature') &&
    mockLabelsRoute.includes("app.get('/:shipmentId'") &&
    !mockLabelsRoute.includes('createLabelV2'),
  'public mock-label route verifies signatures and exposes no label-purchase operations',
);
assert(
  mockLabelAccess.includes("parsed.searchParams.delete('exp')") &&
    returnPdfAccess.includes('refreshMockLabelSignature(labelUrl)'),
  'return details replace persisted mock-label expiry data with a fresh signed URL',
);
assert(
  returnPdfAccess.includes("shipmentSource !== EXTERNAL_RETURN_LABEL_SOURCE") &&
    returnPdfAccess.includes('input.shipmentVoided !== false') &&
    returnPdfAccess.includes('getReturnMediaSignedUrl(labelUrl)') &&
    returnPdfAccess.includes('`returns/${input.returnId}/external-label/`'),
  'external return PDFs are validated against their owner and served through private signed URLs',
);
assert(
  returnReads.includes('resolveClientSafeReturnPdfUrl({') &&
    returnReads.includes('shipmentVoided: row.returnShipmentVoided') &&
    returnDelivery.includes('resolveClientSafeReturnPdfUrl({') &&
    returnDelivery.includes('shipmentVoided: ctx.returnShipment.voided') &&
    !returnReads.includes('pdfUrl: refreshMockLabelSignature(row.returnLabelUrl)') &&
    !returnDelivery.includes('returnShipment.labelUrl ?? null'),
  'detail and delivery DTOs share the safe PDF resolver instead of exposing persisted object paths',
);
assert(
  returnDto.includes('isClientSafeReturnPdfReference({') &&
    returnDto.includes('shipmentSource: row.returnShipmentSource') &&
    returnDto.includes('shipmentVoided: row.returnShipmentVoided') &&
    !returnDto.includes('pdfAvailable: Boolean(row.returnLabelUrl)'),
  'return list availability uses the same non-voided, source-bound PDF eligibility contract',
);

if (failed) process.exit(1);
console.log('\nclient portal returns PDF download guard passed.');
