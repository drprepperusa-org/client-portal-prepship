// CP-057 static duplicate-postage and production-readiness guard.
// No database, network, carrier, or postage operation is performed here.
import fs from 'node:fs';
import path from 'node:path';

const read = (relative) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');
let failed = false;
const assert = (condition, message) => {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${message}`);
  if (!condition) failed = true;
};

const migration = read('drizzle/0041_return_label_purchase_intents.sql');
const intentSchema = read('src/db/schema/return-label-purchase-intents.ts');
const intents = read('src/services/return-label-purchase-intents.ts');
const returnsService = read('src/services/returns.ts');
const labels = read('src/lib/shipstation/labels.ts');
const route = read('src/routes/client-portal/returns.ts');
const integration = read('scripts/integration/client-portal-returns-cp057.integration.ts');
const workflow = read('.github/workflows/integration-tests.yml');
const runbook = read('docs/client-portal-return-label-live-runbook.md');
const matrix = read('docs/source-of-truth-matrix.md');
const pkg = JSON.parse(read('package.json'));

assert(
  /UNIQUE INDEX[\s\S]*return_label_purchase_intents_return_idx/i.test(migration) &&
    /shipments_return_provider_key_idx/.test(migration) &&
    /unknown_outcome/.test(migration),
  'migration enforces one intent per return and one return shipment per provider key',
);
assert(
  /recovery-only[\s\S]{0,50}snapshots/.test(intentSchema) &&
    /selectedRateJson/.test(intentSchema) &&
    /providerReceiptJson/.test(intentSchema),
  'intent schema documents transient recovery data outside canonical label truth',
);
assert(
  /onConflictDoNothing\(\{ target: returnLabelPurchaseIntents\.returnId \}\)/.test(intents) &&
    /eq\(returnLabelPurchaseIntents\.state, 'purchasing'\)/.test(intents) &&
    /attemptCount: sql/.test(intents),
  'purchase ownership is acquired with a conditional durable state transition',
);
assert(
  /external_shipment_id: input\.externalShipmentId/.test(labels) &&
    /ssGetLabelByExternalShipmentId/.test(labels) &&
    /labels\/external_shipment_id/.test(labels),
  'ShipStation create and lookup share the stable external shipment id',
);
assert(
  /is_return_label: input\.isReturnLabel \?\? false/.test(labels) &&
    /isReturnLabel: true/.test(returnsService),
  'return-label purchases explicitly mark the provider request as a return label',
);
assert(
  /saveReturnLabelSelectedRate\([\s\S]*createLabel\(/.test(returnsService) &&
    /recordReturnLabelProviderReceipt\([\s\S]*finalizeLivePurchase/.test(returnsService),
  'selected rate and provider receipt are persisted around the external side effect',
);
assert(
  /completeReturnLabelPurchase\([\s\S]*markReturnLabelCreated/.test(returnsService) &&
    /findReturnShipmentByProviderKey/.test(returnsService),
  'reconciliation completes canonical shipment persistence before workflow repair',
);
assert(
  /providerOutcomeIsAmbiguous/.test(returnsService) &&
    /markReturnLabelPurchaseUnknown/.test(returnsService) &&
    /reclaimReturnLabelPurchaseAfterAbsence/.test(returnsService),
  'ambiguous outcomes reconcile before a provider-absence retry is reclaimed',
);
assert(
  /ReturnLabelPurchasePendingError/.test(route) && /isPurchasePending/.test(route),
  'the API exposes a redaction-safe pending response instead of blind retry behavior',
);

for (const fixture of [
  'concurrent purchase ownership',
  'provider success then shipment insert failure',
  'shipment success then return-row update failure',
  'timeout after submission',
  'completed retry returns the existing label',
  'live flag OFF never calls the provider',
  'clients.is_test=true never calls the provider',
  'client result redacts',
]) {
  assert(integration.includes(fixture), `integration suite covers ${fixture}`);
}

assert(
  workflow.includes('test:client-portal-returns-cp057:integration') &&
    pkg.scripts?.['test:client-portal-returns-cp057:integration'] ===
      'tsx scripts/integration/client-portal-returns-cp057.integration.ts',
  'CI runs the DB-backed CP-057 suite',
);
assert(
  /DJ's explicit approval/.test(runbook) &&
    /RETURNS_LIVE_LABELS=false/.test(runbook) &&
    /Never[\s\S]*blindly retry/i.test(runbook) &&
    /three concurrent probes/.test(runbook),
  'runbook gates real postage on approval, readiness, and reconciliation safety',
);
assert(
  /return_label_purchase_intents/.test(matrix) &&
    /never replaces[\s\S]*shipments/.test(matrix),
  'source-of-truth matrix keeps purchased label truth on shipments',
);

if (failed) process.exit(1);
console.log('PASS CP-057 static guard passed.');
