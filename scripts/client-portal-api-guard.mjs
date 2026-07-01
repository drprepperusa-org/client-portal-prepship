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
const predicatesPath = 'src/lib/client-portal/predicates.ts';
const invoiceDetailsPath = 'src/lib/client-portal/read-models/invoice-details.ts';
const apiPath = 'web/src/lib/api.ts';
const queriesPath = 'web/src/lib/portalQueries.ts';
const apiContractsPath = 'scripts/api-contracts-guard.mjs';
const billingRoutePath = 'src/routes/billing.ts';

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
const billingRoute = read(billingRoutePath);

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

// M7 — portal store-connection submissions: the POST route must exist, be
// admin-gated, create pending accounts (source='portal' + inactive), and never
// echo credential values back in the response.
assert(route.includes("app.post('/integrations'"), "client portal route missing app.post('/integrations'");
{
  const start = route.indexOf("app.post('/integrations'");
  const end = route.indexOf("app.get('/activity'");
  const postIntegrations = start >= 0 && end > start ? route.slice(start, end) : '';
  assert(postIntegrations.includes("'admin required'"), 'POST /integrations must be admin-gated');
  assert(
    postIntegrations.includes("'portal',") && postIntegrations.includes('false'),
    "POST /integrations must insert source='portal' with active=false (pending until operator promotion)",
  );
  assert(!/returning[^`]*credentials/i.test(postIntegrations), 'POST /integrations must not return credential values');
  assert(postIntegrations.includes('do nothing'), 'POST /integrations must not overwrite existing accounts on conflict');
  assert(postIntegrations.includes('maskAccountIdentifier'), 'POST /integrations audit must mask the account identifier');
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
// The scope/search predicates were extracted to lib/client-portal/predicates.ts;
// the route file must still COMPOSE them per endpoint.
const predicates = existsSync(predicatesPath) ? read(predicatesPath) : '';
assert(
  predicates.includes('function activeClientPredicate') &&
    predicates.includes('where coalesce(active_client.active, true) = true') &&
    route.includes('activeClientPredicate('),
  'client portal order/count routes must filter inactive clients the same way /clients does',
);
assert(api.includes('clientPortal:'), 'portalApi must expose clientPortal namespace');
assert(
  api.includes("'/dashboard/summary'") &&
    api.includes("'/orders'") &&
    api.includes("'/inventory'") &&
    api.includes("'/carrier-accounts'"),
  'portalApi.clientPortal must use currently deployed backend-compatible paths while Render lacks /api/client-portal routes',
);
assert(
  /billingSummary\(token: string, range = defaultRange\(\)\)[\s\S]*dateFrom[\s\S]*dateTo[\s\S]*'\/billing\/summary'/.test(api),
  'portalApi.clientPortal.billingSummary must send dateFrom/dateTo required by /billing/summary',
);
// portalInvoiceDetails now lives in the invoice-details read-model; the route
// must still call it, and the read-model must keep Qty on canonical order_items.
const invoiceDetails = existsSync(invoiceDetailsPath) ? read(invoiceDetailsPath) : '';
assert(route.includes('portalInvoiceDetails('), 'client portal routes must use the portalInvoiceDetails read-model');
assert(
  /portalInvoiceDetails[\s\S]*select sum\(greatest\(0, coalesce\(oi\.quantity, 0\)\)[\s\S]*from \$\{orderItems\} oi[\s\S]*as qty/.test(invoiceDetails) &&
    !/portalInvoiceDetails[\s\S]*coalesce\(sum\(b\.qty\), 0\)::text as qty/.test(invoiceDetails),
  'client portal invoice details must use canonical order_items.quantity for Qty, not summed billing line quantities',
);
assert(
  billingRoute.includes("app.patch('/details/:orderId{[0-9]+'") ||
    billingRoute.includes("app.patch('/details/:orderId{[0-9]+}'"),
  'billing route must expose PATCH /billing/details/:orderId for shared invoice detail edits',
);
assert(
  /updateInvoiceDetail[\s\S]*apiSend[\s\S]*`\/billing\/details\/\$\{orderId\}`/.test(api),
  'portalApi.clientPortal must expose updateInvoiceDetail using the shared /billing/details endpoint',
);
assert(
  queries.includes('useSaveInvoiceDetailMutation') &&
    queries.includes('portalApi.clientPortal.updateInvoiceDetail'),
  'Invoices page must save row edits through the shared billing endpoint, not browser-only state',
);
assert(queries.includes('portalApi.clientPortal.'), 'portal queries must use portalApi.clientPortal reads');
assert(!queries.includes('portalApi.orders(token!') && !queries.includes('portalApi.inventory(token!'), 'portal queries must not use broad order/inventory reads');
assert(apiContracts.includes('site-actions.spec.js'), 'api-contracts guard must target existing site actions workflow spec');

if (process.exitCode) process.exit(process.exitCode);
console.log('PASS client portal API guard');
