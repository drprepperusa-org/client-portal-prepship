import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
import { readSourceTree } from './lib/source-tree.mjs';
// CP-043 - return-label rate policy, diagnostics, and recovery guard.
// Static only: this script never calls carriers, buys postage, or mutates data.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => {
  const file = path.join(root, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};

let failed = false;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    console.error(`FAIL ${message}`);
    failed = true;
  }
}

function declarationBlock(source, startPattern, maxLength = 5000) {
  const match = source.match(startPattern);
  if (!match) return '';
  const start = match.index ?? 0;
  return source.slice(start, start + maxLength);
}

function braceBlock(source, startPattern) {
  const match = source.match(startPattern);
  if (!match) return '';
  const start = match.index ?? 0;
  const open = source.indexOf('{', start);
  if (open === -1) return '';
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return '';
}

const service = read('src/services/returns.ts');
const rates = read('src/services/rates.ts');
const route = readSourceTree([
  'src/routes/client-portal/returns.ts',
  'src/routes/client-portal/returns',
]);
const page = [
  read('portal-client/src/pages/Returns.tsx'),
  read('portal-client/src/components/returns/ReturnDetailDrawer.tsx'),
  read('portal-client/src/components/returns/returnPresentation.ts'),
].join('\n');
const createModal = read('portal-client/src/components/returns/ReturnCreateModal.tsx');
const api = readActiveClientPortalApiSource();
const sotMatrix = read('docs/source-of-truth-matrix.md');
const integration = read('scripts/integration/client-portal-returns-cp043.integration.ts');
const integrationWorkflow = read('.github/workflows/integration-tests.yml');
const pkg = JSON.parse(read('package.json'));

assert(service.length > 0, 'return-label service exists');
assert(rates.length > 0, 'rate service exists');

const policy = declarationBlock(service, /function resolveReturnRatePolicy\s*\(/, 1400);
assert(
  /prepship_default_return_context/.test(policy) &&
    /rateClientId:\s*null/.test(policy) &&
    /rateStoreId:\s*null/.test(policy) &&
    /sourceClientId:\s*null/.test(policy) &&
    /apiKeyV2:\s*null/.test(policy),
  'return labels use the explicit DR PREPPER default account context',
);
assert(
  !/client_explicit_return_context/.test(service) && !/loadClientCredentials/.test(service),
  'return labels do not silently inherit generic client or rate-source credentials',
);
assert(
  /clientId:\s*returnRatePolicy\.rateClientId/.test(service) &&
    /storeId:\s*returnRatePolicy\.rateStoreId/.test(service) &&
    /apiKeyV2:\s*returnRatePolicy\.apiKeyV2/.test(service),
  'rating and purchase share the same resolved return-account policy',
);

assert(
  /getRates\s*\(\s*rateInput\s*,\s*\{\s*forceRefresh:\s*true,\s*applyMarkups:\s*false\s*\}\s*\)/.test(service),
  'purchase action bypasses the negative cache and display markups',
);
assert(
  /applyMarkups\?:\s*boolean/.test(rates) &&
    /opts\.applyMarkups\s*===\s*false\s*\?\s*rawRates/.test(rates),
  'rate service supports raw provider rates for purchase selection',
);
assert(
  /const rawRates = dedupeRates\(lifted, 'live'\)/.test(rates) &&
    /blockedRateCount = Math\.max\(0, rawRates\.length - filtered\.length\)/.test(rates),
  'fresh rate diagnostics distinguish pre-filter and blocked counts',
);
assert(
  /rawRateCount:\s*liveResult\.rawRateCount/.test(rates) &&
    /blockedRateCount:\s*liveResult\.blockedRateCount/.test(rates),
  'fresh count diagnostics reach the return-label orchestrator',
);

for (const field of [
  'returnId',
  'orderId',
  'clientId',
  'storeId',
  'weightOz',
  'hasDims',
  'fromZip',
  'toZip',
  'rawRateCount',
  'eligibleRateCount',
  'blockedRateCount',
  'carrierDiagnostics',
]) {
  assert(new RegExp(field).test(service), `safe operator diagnostics include ${field}`);
}
const safeCarrierDiagnostic = declarationBlock(service, /type SafeCarrierDiagnostic\s*=/, 500);
assert(
  !/error\??:|providerAccountId|apiKey|secret|payload|labelUrl/.test(safeCarrierDiagnostic),
  'stored/logged carrier diagnostics omit provider errors, credentials, and label artifacts',
);
assert(
  /failureKind:\s*'no_rates'\s*\|\s*'all_rates_blocked'\s*\|\s*'rate_lookup_failed'/.test(service) &&
    /No return rates were returned/.test(service) &&
    /No eligible return rate available/.test(service) &&
    /Return rates are temporarily unavailable/.test(service),
  'no-rate, all-blocked, and lookup failures remain distinguishable',
);
assert(
  /markReturnLabelFailed/.test(service) &&
    /status:\s*'label_failed'/.test(service) &&
    /deliveryError:\s*message/.test(service),
  'rate failures persist a recoverable client-safe workflow state',
);
assert(
  /\['requested', 'label_failed', 'label_created'\]\.includes\(returnRow\.status\)/.test(service) &&
    /returnRow\?\.returnShipmentId != null/.test(service) &&
    /ReturnLabelStateError/.test(service),
  'label creation rejects terminal states while completed retries read the existing label',
);

assert(
  /portal\.returns\.label\.rate_unavailable/.test(route) &&
    /quotedRateCount:\s*rawRateCount/.test(route) &&
    /ratePolicy:\s*returnLabelRatePolicy/.test(route),
  'rate-unavailable attempts write sanitized operator audit metadata',
);
assert(
  /isRateUnavailable\s*\?\s*422/.test(route) &&
    /Could not create return label\. Please try again or contact PrepShip support\./.test(route),
  'the API returns retryable 422 rate errors and a generic unknown 500 message',
);

assert(
  /label_failed:\s*\{\s*label:\s*'Label needs attention'/.test(page) &&
    /Needs retry/.test(page) &&
    /Retry return label/.test(page),
  'Returns list and drawer render the recoverable label failure state',
);
assert(
  /catch\s*\(error\)[\s\S]{0,500}?invalidateQueries[\s\S]{0,500}?query\.refetch\(\)/.test(page),
  'the open drawer refreshes canonical state after a failed label attempt',
);
assert(
  /detail\.deliveryError\s*\?\?/.test(page) &&
    /canCreateLabel/.test(page) &&
    /detail\??\.status === 'requested' \|\| labelFailed/.test(page),
  'the drawer shows the safe failure reason and limits retry to valid states',
);
assert(
  /Return created - label needs attention/.test(createModal) &&
    /labelFailed = true/.test(createModal),
  'the initial return flow reports a label failure instead of false pending progress',
);

assert(
  /isReturn:\s*true/.test(service) &&
    /markReturnLabelCreated\(/.test(service) &&
    /selectedRate,/.test(service),
  'successful creation persists the canonical return shipment, link, and chosen quote',
);
assert(
  /resolveReturnPostageRate/.test(service) &&
    /returnCustomerShippingRate:\s*await resolveReturnCustomerPrice/.test(service),
  'client return postage remains derived from the backend billing policy',
);
assert(
  /Label needs attention[\s\S]*returns\.status = 'label_failed'/.test(sotMatrix) &&
    /Return postage[\s\S]*returnCustomerShippingRate/.test(sotMatrix) &&
    /client-portal-returns-cp043-guard\.mjs/.test(sotMatrix),
  'the SOT matrix documents CP-043 failure state, customer price, and enforcement',
);

const resultType = braceBlock(service, /export type ClientSafeReturnResult\s*=/);
const portalType = braceBlock(api, /export interface PortalReturnRow\s*\{/);
for (const forbidden of [
  'carrierCode',
  'serviceCode',
  'carrierProvider',
  'providerAccountId',
  'selectedRateJson',
  'apiKey',
]) {
  assert(
    !new RegExp(`\\b${forbidden}\\??\\s*:`).test(resultType) &&
      !new RegExp(`\\b${forbidden}\\??\\s*:`).test(portalType),
    `client return contracts do not expose ${forbidden}`,
  );
}

assert(
  pkg.scripts?.['test:client-portal-returns-cp043'] ===
    'node scripts/client-portal-returns-cp043-guard.mjs',
  'package.json exposes test:client-portal-returns-cp043',
);
assert(
  pkg.scripts?.['test:client-portal-returns-cp043:integration'] ===
    'tsx scripts/integration/client-portal-returns-cp043.integration.ts' &&
    /ReturnLabelRateUnavailableError/.test(integration) &&
    /selectedRateJson/.test(integration) &&
    /providerCalls/.test(integration),
  'CP-043 has DB-backed failure, persistence, quote, and provider-call proof',
);
assert(
  /npm run test:client-portal-returns-cp043:integration/.test(integrationWorkflow),
  'hosted Postgres runs the CP-043 behavioral suite',
);

if (failed) process.exit(1);
console.log('\nCP-043 return-rate recovery guard passed.');
