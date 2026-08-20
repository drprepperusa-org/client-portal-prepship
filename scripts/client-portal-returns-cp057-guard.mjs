// CP-057 static duplicate-postage and production-readiness guard.
// No database, network, carrier, or postage operation is performed here.
import fs from 'node:fs';
import path from 'node:path';
import { readSourceTree } from './lib/source-tree.mjs';

const read = (relative) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');
let failed = false;
const assert = (condition, message) => {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${message}`);
  if (!condition) failed = true;
};

const migration = read('drizzle/0041_return_label_purchase_intents.sql');
const rlsMigration = read('drizzle/0045_return_label_purchase_intents_rls.sql');
const fencingMigration = read('drizzle/0047_return_label_operation_fencing.sql');
const voidMigration = read('drizzle/0049_return_label_purchase_intent_voided.sql');
const intentSchema = read('src/db/schema/return-label-purchase-intents.ts');
const intents = read('src/services/return-label-purchase-intents.ts');
const slot = read('src/services/return-label-slot.ts');
const returnsService = read('src/services/returns.ts');
const labels = read('src/lib/shipstation/labels.ts');
const admin = read('src/routes/admin.ts');
const route = readSourceTree([
  'src/routes/client-portal/returns.ts',
  'src/routes/client-portal/returns',
]);
const returnActions = read('src/routes/client-portal/returns/actions.ts');
const integration = read('scripts/integration/client-portal-returns-cp057.integration.ts');
const workflow = read('.github/workflows/integration-tests.yml');
const runbook = read('docs/client-portal-return-label-live-runbook.md');
const voidMigrationRunner = read('scripts/apply-cp-057-return-label-voided-migration.ts');
const matrix = read('docs/source-of-truth-matrix.md');
const pkg = JSON.parse(read('package.json'));

assert(
  /UNIQUE INDEX[\s\S]*return_label_purchase_intents_return_idx/i.test(migration) &&
    /shipments_return_provider_key_idx/.test(migration) &&
    /unknown_outcome/.test(migration),
  'migration enforces one intent per return and one return shipment per provider key',
);
assert(
  /ALTER TABLE public\.return_label_purchase_intents ENABLE ROW LEVEL SECURITY/i.test(rlsMigration) &&
    /REVOKE ALL PRIVILEGES ON TABLE public\.return_label_purchase_intents[\s\S]*anon[\s\S]*authenticated/i.test(
      rlsMigration,
    ) &&
    !/CREATE POLICY/i.test(rlsMigration),
  'purchase intents are backend-only: RLS deny-all plus revoked public API grants',
);
assert(
  /recovery-only[\s\S]{0,50}snapshots/.test(intentSchema) &&
    /selectedRateJson/.test(intentSchema) &&
    /providerReceiptJson/.test(intentSchema) &&
    /generation/.test(intentSchema) &&
    /leaseToken/.test(intentSchema),
  'intent schema documents transient recovery data outside canonical label truth',
);
assert(
  /ADD COLUMN IF NOT EXISTS generation/.test(fencingMigration) &&
    /lease_token/.test(fencingMigration) &&
    /state_lease_idx/.test(fencingMigration),
  'PS-423 adds generation fencing and renewable lease ownership additively',
);
assert(
  /onConflictDoNothing\(\{ target: returnLabelPurchaseIntents\.returnId \}\)/.test(intents) &&
    /eq\(returnLabelPurchaseIntents\.state, 'purchasing'\)/.test(intents) &&
    /attemptCount: sql/.test(intents) &&
    /eq\(returnLabelPurchaseIntents\.generation, lease\.generation\)/.test(intents) &&
    /runReturnLabelPurchaseAttempt/.test(intents),
  'purchase ownership is acquired with a conditional durable state transition',
);
assert(
  /db\.transaction\(async \(tx\)/.test(intents) &&
    /lockReturnLabelSlot\(tx, returnId\)/.test(intents) &&
    /\.for\('update'\)/.test(slot) &&
    /ReturnLabelAssignmentConflictError/.test(intents),
  'purchase intent ownership locks and rechecks the shared return label slot',
);
assert(
  /external_shipment_id: input\.externalShipmentId/.test(labels) &&
    /ssGetLabelByExternalShipmentId/.test(labels) &&
    /labels\/external_shipment_id/.test(labels) &&
    /signal: input\.signal/.test(labels),
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
    /currently returns no row is not strong[\s\S]*Keep the operation held/.test(returnsService) &&
    !/reclaimReturnLabelPurchaseAfterAbsence/.test(returnsService),
  'ambiguous outcomes stay held; provider absence never authorizes an automatic repurchase',
);
assert(
  /resolveReturnLabelPurchaseNoEffect/.test(admin) &&
    /resolutionNote/.test(intents) &&
    /resolvedBy/.test(intents),
  'only an authenticated admin resolution can release a verified no-effect hold',
);
assert(
  /ReturnLabelPurchasePendingError/.test(route) && /isPurchasePending/.test(route),
  'the API exposes a redaction-safe pending response instead of blind retry behavior',
);
assert(
  /existingReturn\.source === 'external_return_label'[\s\S]{0,220}ReturnLabelAssignmentConflictError/.test(
    returnsService,
  ),
  'a committed external winner remains a typed conflict before intent acquisition',
);
assert(
  /RETURN_LABEL_ASSIGNMENT_CONFLICT_CODE/.test(returnActions) &&
    /isAssignmentConflict/.test(returnActions) &&
    /code: RETURN_LABEL_ASSIGNMENT_CONFLICT_CODE/.test(returnActions) &&
    /isDuplicate \|\| isInvalidState \|\| isAssignmentConflict[\s\S]{0,80}?409/.test(returnActions),
  'the live-label endpoint returns 409 label_assignment_in_progress for a slot loser',
);

for (const fixture of [
  'concurrent purchase ownership',
  'concurrent external assignments',
  'purchase intent wins the external race',
  'external assignment wins the purchase race',
  'voided label releases the canonical slot',
  'provider success then shipment insert failure',
  'recovery blocks shipment persistence when customer pricing is unavailable',
  'blocked recovery never repurchases postage',
  'shipment success then return-row update failure',
  'timeout after submission',
  'provider absence remains held',
  'operator no-effect resolution permits one new attempt',
  'stale generation cannot record a receipt',
  'completed retry returns the existing label',
  'live flag OFF never calls the provider',
  'live flag OFF fails closed for a real client',
  'live flag OFF creates no mock shipment',
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
  /--apply/.test(voidMigrationRunner) &&
    /--confirm=/.test(voidMigrationRunner) &&
    /--host=/.test(voidMigrationRunner) &&
    /--database=/.test(voidMigrationRunner) &&
    /DRY RUN/.test(voidMigrationRunner) &&
    /EXPECTED_MIGRATION_SHA256/.test(voidMigrationRunner) &&
    /createHash\('sha256'\)/.test(voidMigrationRunner) &&
    /row_fingerprint/.test(voidMigrationRunner) &&
    /access exclusive mode/.test(voidMigrationRunner) &&
    /assertPostconditions\(lockedBefore, lockedAfter\)/.test(voidMigrationRunner) &&
    /rls_enabled/.test(voidMigrationRunner) &&
    /return_unique_index/.test(voidMigrationRunner) &&
    /provider_ref_unique_index/.test(voidMigrationRunner) &&
    /state_index/.test(voidMigrationRunner) &&
    /state_lease_index/.test(voidMigrationRunner) &&
    /lease_expires_column/.test(voidMigrationRunner) &&
    /resolution_note_column/.test(voidMigrationRunner) &&
    pkg.scripts?.['migrate:cp-057-return-label-voided'] ===
      'tsx scripts/apply-cp-057-return-label-voided-migration.ts',
  'migration 0049 has a dry-run-default, explicit-apply, readback-verified operator lane',
);
assert(
  /0047_return_label_operation_fencing/.test(runbook) &&
    /migrate:cp-057-return-label-voided/.test(runbook) &&
    /RETURN_BILLING_ENABLED=false/.test(runbook) &&
    /\$2\.50/.test(runbook),
  'runbook covers 0047/0049, bounded billing proof, and both flag shutdowns',
);
assert(
  /return_label_purchase_intents/.test(matrix) &&
    /never replaces[\s\S]*shipments/.test(matrix),
  'source-of-truth matrix keeps purchased label truth on shipments',
);

// ── A voided label must leave the return able to buy postage again ──
assert(
  /'voided'/.test(voidMigration) && /state_check/.test(voidMigration),
  'migration admits the voided state on the intent check constraint',
);
assert(
  /'voided'/.test(intentSchema),
  'drizzle check constraint matches the migration state model',
);
assert(
  /export async function markReturnLabelPurchaseVoided/.test(intents) &&
    /eq\(returnLabelPurchaseIntents\.state, 'completed'\)/.test(intents),
  'only a completed intent can be voided, so voiding cannot race a live attempt',
);
assert(
  /eq\(returnLabelPurchaseIntents\.state, 'voided'\)/.test(intents),
  'a voided intent is claimable again so a replacement label can be purchased',
);
// The idempotency key must not survive the void. Replaying it would let the
// provider hand back the voided label instead of selling a replacement.
{
  const start = intents.indexOf('export async function markReturnLabelPurchaseVoided');
  const body = start === -1 ? '' : intents.slice(start, start + 1200);
  assert(
    /providerReferenceKey:\s*`cp-return-\$\{randomUUID\(\)\}`/.test(body),
    'voiding rotates the provider idempotency key so the replacement is a new purchase',
  );
}

// CP-057 correction: every assertion above proves the void TRANSITION is correct, and all of
// them passed while `markReturnLabelPurchaseVoided` had no production caller anywhere. The
// state machine was right and nothing drove it, so a real void left the intent stranded at
// `completed`, where UNIQUE (return_id) forbids buying a replacement label. A guard that only
// reads the helper cannot see that. These assert the WIRING.
{
  const labelsService = read('src/services/labels.ts');
  assert(
    /markReturnLabelPurchaseVoidedForShipment/.test(labelsService),
    'the canonical void path advances the return purchase intent (not merely defines the helper)',
  );
  assert(
    /export async function markReturnLabelPurchaseVoidedForShipment/.test(intents),
    'the by-shipment lookup lives in the intents module, which owns the state machine',
  );
  const voidFn = labelsService.indexOf('export async function voidLabelV2');
  const body = voidFn === -1 ? '' : labelsService.slice(voidFn, voidFn + 5000);
  const setVoided = body.indexOf('.set({ voided: true');
  const advance = body.indexOf('markReturnLabelPurchaseVoidedForShipment');
  assert(
    setVoided !== -1 && advance !== -1 && advance > setVoided,
    'the intent advances only AFTER the canonical shipments.voided write, never before it',
  );
  // A stranded intent is recoverable; a void reported failed after the provider already
  // voided is not. So this must never throw back into the void path.
  assert(
    /CP-057 return purchase intent could not be advanced/.test(body),
    'a failure advancing the intent cannot fail a void that already happened at the provider',
  );
}

if (failed) process.exit(1);
console.log('PASS CP-057 static guard passed.');
