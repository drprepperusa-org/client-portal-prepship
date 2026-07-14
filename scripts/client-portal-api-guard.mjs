import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { activeClientPortalApiFiles, readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';

const read = (file) => readFileSync(file, 'utf8');
const facade = read('portal-client/src/lib/api.ts');
const client = read('portal-client/src/lib/api/client.ts');
const aggregator = read('src/routes/client-portal.ts');
const contractsIndex = read('src/lib/client-portal/contracts/index.ts');
const activeSource = readActiveClientPortalApiSource();

const contractDomains = [
  'common',
  'orders',
  'shipments',
  'returns',
  'inventory',
  'connections',
  'dashboard',
  'access',
  'billing',
  'analysis',
  'inbound',
];
const frontendDomains = [
  'access',
  'analysis',
  'billing',
  'connections',
  'dashboard',
  'inbound',
  'inventory',
  'orders',
  'returns',
  'shipments',
];
const routeDomains = [
  'dashboard',
  'orders',
  'shipments',
  'inventory',
  'analysis',
  'billing',
  'invoices',
  'access',
  'integrations',
  'inbound',
  'returns',
  'sync',
  'audit-log',
];

for (const file of activeClientPortalApiFiles) {
  assert.ok(existsSync(file), `active API source exists: ${file}`);
}

assert.match(
  read('src/lib/client-portal/contracts/common.ts'),
  /CLIENT_PORTAL_CONTRACT_VERSION\s*=\s*'1'/,
  'Client Portal contracts declare version 1',
);
for (const domain of contractDomains) {
  assert.match(contractsIndex, new RegExp(`export \\* from './${domain}'`), `contract index exports ${domain}`);
}

assert.ok(facade.split(/\r?\n/).length <= 30, 'public API facade stays thin');
assert.doesNotMatch(facade, /\bexport\s+interface\s+\w+/, 'public API facade does not own DTO interfaces');
assert.doesNotMatch(facade, /Promise\.all|\.reduce\(|portalScopeFromToken/, 'public API facade does not own business aggregation or JWT scope');
assert.match(facade, /export type \* from '@client-portal-contracts\/index'/, 'public API facade re-exports backend-owned contracts');

for (const domain of frontendDomains) {
  const binding = `${domain}Api`;
  assert.match(client, new RegExp(`import \\{ ${binding} \\} from './domains/${domain}'`), `API client imports ${domain}`);
  assert.match(client, new RegExp(`\\.\\.\\.${binding}`), `API client mounts ${domain}`);

  const source = read(`portal-client/src/lib/api/domains/${domain}.ts`);
  assert.match(source, /@client-portal-contracts\//, `${domain} API imports backend-owned contract types`);
}

for (const domain of routeDomains) {
  const binding = domain.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) + 'Route';
  assert.match(aggregator, new RegExp(`from './client-portal/${domain}'`), `route aggregator imports ${domain}`);
  assert.match(aggregator, new RegExp(`app\\.route\\('\\/', ${binding}\\)`), `route aggregator mounts ${domain}`);
}

const backendContractOwners = [
  ['src/lib/client-portal/dto.ts', 'contracts/'],
  ['src/lib/client-portal/shipment-status.ts', 'contracts/shipments'],
  ['src/lib/client-portal/read-models/access.ts', 'contracts/access'],
  ['src/lib/client-portal/read-models/billing-status.ts', 'contracts/billing'],
  ['src/lib/client-portal/read-models/dashboard.ts', 'contracts/dashboard'],
  ['src/routes/client-portal/analysis.ts', 'contracts/analysis'],
  ['src/routes/client-portal/returns/dto.ts', 'contracts/returns'],
];
for (const [file, contractImport] of backendContractOwners) {
  assert.ok(read(file).includes(contractImport), `${file} consumes the shared contract owner`);
}

for (const endpoint of [
  '/api/client-portal/dashboard',
  '/api/client-portal/orders',
  '/api/client-portal/analysis/sku-orders',
  '/api/client-portal/returns',
  '/api/client-portal/invoice-details',
  '/api/client-portal/integrations',
]) {
  assert.ok(activeSource.includes(endpoint), `active API exposes ${endpoint}`);
}

console.log('PASS active Client Portal API architecture guard');
