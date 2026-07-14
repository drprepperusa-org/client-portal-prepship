import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { activeClientPortalApiFiles } from './lib/client-portal-active-api-source.mjs';

const read = (file) => readFileSync(file, 'utf8');
const apiRoot = 'portal-client/src/lib/api';
const domainRoot = `${apiRoot}/domains`;
const facade = read('portal-client/src/lib/api.ts');
const scope = read(`${apiRoot}/scope.ts`);
const client = read(`${apiRoot}/client.ts`);
const activeGuardSources = [
  read('scripts/backend-connectivity-guard.mjs'),
  read('scripts/client-portal-api-guard.mjs'),
];

assert.ok(!existsSync('portal-client/src/lib/portalScope.ts'), 'retired frontend JWT scope owner stays deleted');
assert.doesNotMatch(facade, /\bexport\s+interface\s+/, 'compatibility facade cannot reintroduce DTO ownership');
assert.match(facade, /export type \* from '@client-portal-contracts\/index'/, 'compatibility facade delegates DTO ownership to backend contracts');

const frontendApiFiles = [
  `${apiRoot}/scope.ts`,
  `${apiRoot}/client.ts`,
  ...readdirSync(domainRoot).filter((file) => file.endsWith('.ts')).map((file) => path.join(domainRoot, file)),
];
for (const file of frontendApiFiles) {
  const source = read(file);
  assert.doesNotMatch(source, /\bexport\s+interface\s+/, `${file} cannot own a parallel DTO interface`);
}

assert.doesNotMatch(scope, /atob|JSON\.parse|portalScopeFromToken|Promise\.all|\.reduce\(/, 'frontend scope helper cannot parse token scope or aggregate business truth');
assert.match(scope, /backend owns JWT scope and whole-set pagination/i, 'frontend scope helper documents backend ownership');
assert.doesNotMatch(client, /Promise\.all|\.reduce\(/, 'API composition cannot aggregate business truth');

for (const domain of readdirSync(domainRoot).filter((file) => file.endsWith('.ts'))) {
  assert.match(
    read(path.join(domainRoot, domain)),
    /import type [\s\S]*?from '@client-portal-contracts\//,
    `${domain} consumes backend-owned contract types`,
  );
}

const producerPins = [
  ['src/lib/client-portal/dto.ts', /\): Portal(Order|Shipment|Inventory|Integration)\s*\{/],
  ['src/routes/client-portal/analysis.ts', /satisfies AnalysisBreakdown/],
  ['src/routes/client-portal/returns.ts', /Promise<PortalReturnRow>/],
  ['src/lib/client-portal/read-models/dashboard.ts', /Promise<DashboardSummary>/],
  ['src/lib/client-portal/read-models/access.ts', /PortalAccessUser/],
  ['src/lib/client-portal/read-models/billing-status.ts', /Promise<BillingLastGenerated \| null>/],
];
for (const [file, pattern] of producerPins) {
  assert.match(read(file), pattern, `${file} is compile-time pinned to its shared contract`);
}

assert.ok(activeClientPortalApiFiles.every((file) => !file.startsWith('web/')), 'active API source inventory excludes the legacy admin frontend');
assert.ok(activeGuardSources.every((source) => !source.includes('web/src')), 'active API guards cannot be satisfied by legacy admin source');
assert.ok(existsSync('scripts/legacy-admin-api-guard.mjs'), 'legacy admin API guard is explicitly quarantined');
assert.ok(existsSync('scripts/legacy-admin-backend-connectivity-guard.mjs'), 'legacy admin connectivity guard is explicitly quarantined');

console.log('PASS Client Portal contract drift guard');
