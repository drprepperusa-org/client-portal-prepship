import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractShipstationLabelUrl } from '../src/lib/shipstation/labels.ts';

assert.equal(
  extractShipstationLabelUrl({ pdf: 'https://example.com/label.pdf' }),
  'https://example.com/label.pdf',
  'plain ShipStation PDF URLs must still pass through',
);

assert.equal(
  extractShipstationLabelUrl({ pdf: { href: 'https://example.com/walmart.pdf' } }),
  'https://example.com/walmart.pdf',
  'object-shaped Walmart/ShipStation label downloads must resolve to href',
);

assert.equal(
  extractShipstationLabelUrl({ href: { url: 'https://example.com/fallback.pdf' } }),
  'https://example.com/fallback.pdf',
  'fallback href objects must resolve to url',
);

assert.equal(
  extractShipstationLabelUrl({ pdf: { unexpected: true } }),
  null,
  'unrecognized label download objects must not leak into text columns',
);

// The live label-purchase path (createLabelV2 → carrierConnectors.shipstation
// .createLabel → ssCreateLabel) normalizes label_download inside the ShipStation
// lib; the service then persists that already-plain URL. Pin both halves so
// neither side regresses to writing raw label_download objects into shipments.
const shipstationLib = readFileSync('src/lib/shipstation/labels.ts', 'utf8');
assert(
  shipstationLib.includes('const labelUrl = extractShipstationLabelUrl(labelDownload)') &&
    shipstationLib.includes('labelUrl: extractShipstationLabelUrl(labelDownload)'),
  'ssCreateLabel and the return/list/v1-details mappers must normalize ShipStation label_download into a plain URL',
);

const labelsService = readFileSync('src/services/labels.ts', 'utf8');
assert(
  labelsService.includes('labelUrl: created.labelUrl'),
  'persistCreatedLabel must persist the connector-normalized label URL on the live path',
);

console.log('PASS shipstation label URL guard');
