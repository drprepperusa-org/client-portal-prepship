import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (file) => readFileSync(file, 'utf8');
const app = read('portal-client/src/App.tsx');
const nav = read('portal-client/src/nav.ts');
const billing = read('portal-client/src/pages/Billing.tsx');
const inventory = read('docs/client-portal-active-surface-inventory.md');

const routedPages = new Map([
  ['Dashboard', '/'],
  ['Orders', '/orders'],
  ['Inbound', '/inbound'],
  ['Shipments', '/shipments'],
  ['Returns', '/returns'],
  ['Inventory', '/inventory'],
  ['Analysis', '/analysis'],
  ['Billing', '/billing'],
  ['Rates', '/rates'],
  ['Connections', '/connections'],
  ['AuditLog', '/audit-log'],
  ['Settings', '/settings'],
  ['Components', '/components'],
]);

for (const [page, route] of routedPages) {
  assert.match(app, new RegExp(`import\\('./pages/${page}'\\)`), `App lazy-loads active ${page} page`);
  const pathPattern = route === '/' ? /path="\/"/ : new RegExp(`path="${route}"`);
  assert.match(app, pathPattern, `App routes ${route}`);
  assert.ok(inventory.includes(`\`${route}\``), `active surface inventory documents ${route}`);
}

for (const route of ['/orders', '/inbound', '/shipments', '/returns', '/inventory', '/analysis', '/billing', '/rates', '/connections', '/audit-log', '/settings']) {
  assert.ok(nav.includes(`to: '${route}'`), `navigation exposes ${route}`);
}

assert.match(billing, /import BillingClients from '\.\/Invoices'/, 'Billing owns the reachable invoice surface');
assert.ok(existsSync('portal-client/src/pages/Invoices.tsx'), 'Billing invoice implementation exists');
assert.ok(!existsSync('portal-client/src/pages/Finance.tsx'), 'unreachable Finance page stays retired');
assert.doesNotMatch(app + nav, /Finance|\/finance/i, 'active routes and navigation cannot revive the retired Finance page');
assert.match(inventory, /legacy-admin-api-guard\.mjs/, 'inventory documents the quarantined legacy API guard');
assert.match(inventory, /legacy-admin-backend-connectivity-guard\.mjs/, 'inventory documents the quarantined legacy connectivity guard');

console.log('PASS Client Portal active surface inventory guard');
