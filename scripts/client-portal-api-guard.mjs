import { existsSync, readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`client-portal API guard failed: ${message}`);
    process.exitCode = 1;
  }
}

const routePath = 'src/routes/client-portal.ts';
const dtoPath = 'src/lib/client-portal/dto.ts';
const scopePath = 'src/lib/client-portal/scope.ts';
const auditPath = 'src/lib/client-portal/audit.ts';
const apiPath = 'web/src/lib/api.ts';
const queriesPath = 'web/src/lib/portalQueries.ts';
const apiContractsPath = 'scripts/api-contracts-guard.mjs';

for (const path of [routePath, dtoPath, scopePath, auditPath]) {
  assert(existsSync(path), `${path} must exist`);
}

const route = existsSync(routePath) ? read(routePath) : '';
const dto = existsSync(dtoPath) ? read(dtoPath) : '';
const scope = existsSync(scopePath) ? read(scopePath) : '';
const audit = existsSync(auditPath) ? read(auditPath) : '';
const api = read(apiPath);
const queries = read(queriesPath);
const apiContracts = read(apiContractsPath);

for (const routeToken of [
  "app.get('/me'",
  "app.get('/dashboard'",
  "app.get('/orders'",
  "app.get('/orders/:id",
  "app.get('/shipments'",
  "app.get('/inventory'",
  "app.get('/analysis'",
  "app.get('/reports'",
  "app.get('/integrations'",
  "app.get('/activity'",
]) {
  assert(route.includes(routeToken), `client portal route missing ${routeToken}`);
}

for (const fn of [
  'resolveClientPortalScope',
  'assertClientPortalScope',
  'toPortalOrderDto',
  'toPortalShipmentDto',
  'toPortalInventoryDto',
  'toPortalIntegrationDto',
  'sanitizePortalAuditMetadata',
  'recordPortalAudit',
]) {
  assert((route + dto + scope + audit).includes(fn), `missing ${fn}`);
}

for (const forbidden of [
  'credentials:',
  'ssApiSecret',
  'ssApiKey',
  'rawSourcePayload',
  'internalNotes',
  'labelUrl:',
]) {
  assert(!dto.includes(forbidden), `DTO layer must not expose ${forbidden}`);
}

assert(scope.includes('client_user') && scope.includes('read_only_support'), 'scope must treat external roles explicitly');
assert(scope.includes('client portal scope required'), 'scope must deny unscoped external users');
assert(audit.includes('password') && audit.includes('token') && audit.includes('credentials'), 'audit sanitizer must strip sensitive keys');
assert(api.includes('clientPortal:'), 'portalApi must expose clientPortal namespace');
assert(queries.includes('portalApi.clientPortal.'), 'portal queries must use portalApi.clientPortal reads');
assert(!queries.includes('portalApi.orders(token!') && !queries.includes('portalApi.inventory(token!'), 'portal queries must not use broad order/inventory reads');
assert(apiContracts.includes('site-actions.spec.js'), 'api-contracts guard must target existing site actions workflow spec');

if (process.exitCode) process.exit(process.exitCode);
console.log('PASS client portal API guard');
