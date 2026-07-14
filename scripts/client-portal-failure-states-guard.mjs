// Active Client Portal failure-state guard (CP-003 follow-up).
//
// The legacy web/ "frontend-failure-states" guard validated the old app's
// v2-apiClient / vercelFunction / OrdersView label-queue paths — code that no
// longer exists (web/src/components/Views was removed). The active portal
// (portal-client/) has a simpler, real failure-state model that this guard
// pins instead:
//   1. API layer: fetch bounded by an AbortController timeout; non-OK responses
//      are THROWN (never swallowed behind empty fallbacks).
//   2. Shared QueryState UI renders an explicit error state with a recoverable
//      Retry action.
//   3. The live Orders + Returns pages wire their query error/refetch into that
//      UI. Returns also flips out of skeletons once a fetch has failed and React
//      Query is retrying, so the page never looks frozen on a retrying request.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failed = false;
function assert(condition, message) {
  if (condition) console.log(`ok: ${message}`);
  else {
    console.error(`FAIL: ${message}`);
    failed = true;
  }
}

// ── API layer: bounded timeouts + failures surfaced, never swallowed ──
const api = read('portal-client/src/lib/api.ts');
assert(api.includes('const TIMEOUT_MS = 30000'), 'api.ts defines a bounded request timeout (30s — long enough to ride out a Render cold-start)');
assert(api.includes('new AbortController()'), 'api.ts uses AbortController to bound requests');
assert(
  api.includes('controller.abort()') && api.includes('clearTimeout('),
  'api.ts aborts timed-out requests and clears the timer',
);
assert(
  api.includes('Promise<never>') && api.includes('throw err') && api.includes('err.status = res.status'),
  'api.ts fail() throws an ApiError carrying the HTTP status — errors surfaced, not hidden',
);
assert(
  api.includes('if (!res.ok) await fail(res)'),
  'apiGet/apiSend rethrow non-OK responses instead of returning empty data',
);

// ── Cold-start resilience: transient failures retry + a "reconnecting" banner;
//    expected client errors (4xx) do NOT retry ──
const main = read('portal-client/src/main.tsx');
assert(
  /status >= 400 && status < 500\) return false/.test(main),
  'main.tsx does not retry expected client errors (4xx won\'t change / aren\'t a connection problem)',
);
assert(
  main.includes('return failureCount < 2'),
  'main.tsx retries transient failures (network / timeout / 5xx) up to twice',
);
const connectionStatus = read('portal-client/src/components/ConnectionStatus.tsx');
assert(
  connectionStatus.includes("fetchStatus === 'fetching'") && connectionStatus.includes('fetchFailureCount > 0'),
  'ConnectionStatus detects a query actively retrying after a failure (the reconnecting signal)',
);
assert(
  connectionStatus.includes('Reconnecting to the server'),
  'ConnectionStatus renders a reconnecting banner so a waking API reads as "waking", not frozen',
);
const layout = read('portal-client/src/components/layout/Layout.tsx');
assert(layout.includes('<ConnectionStatus'), 'Layout mounts ConnectionStatus so the banner is portal-wide');

// ── Shared error UI: explicit error state with a recoverable Retry ──
const queryState = read('portal-client/src/components/ui/QueryState.tsx');
assert(
  queryState.includes('isError') && queryState.includes("Couldn't load data"),
  'QueryState renders an explicit error state',
);
assert(
  queryState.includes('onClick={onRetry}') && queryState.includes('>Retry</Button>'),
  'QueryState shows a Retry button wired to onRetry',
);

// ── Orders page wires the live query into the recoverable error UI ──
const orders = read('portal-client/src/pages/Orders.tsx');
assert(orders.includes('isError={query.isError}'), 'Orders passes the live query error state into QueryState');
assert(
  orders.includes('onRetry={() => query.refetch()}'),
  'Orders offers a recoverable Retry that refetches the orders query',
);
const returns = [
  read('portal-client/src/pages/Returns.tsx'),
  read('portal-client/src/components/returns/ReturnDetailDrawer.tsx'),
  read('portal-client/src/components/returns/returnPresentation.ts'),
].join('\n');
assert(returns.includes('returnsFetchFailed'), 'Returns derives a retry/failure signal from the live returns query');
assert(
  returns.includes('isLoading={query.isLoading && !returnsFetchFailed}'),
  'Returns stops showing skeleton rows after the first failed returns fetch',
);
assert(
  returns.includes('isError={query.isError || returnsFetchFailed}'),
  'Returns shows the recoverable error state while a failed returns request is retrying',
);
assert(
  returns.includes('onRetry={() => query.refetch()}'),
  'Returns offers a recoverable Retry that refetches the returns query',
);

// ── package.json wiring ──
// CP-055 backend truth: failed canonical reads cannot become normal nulls.
const billingStatusReadModel = read('src/lib/client-portal/read-models/billing-status.ts');
const billingRoute = read('src/routes/client-portal/billing.ts');
assert(
  billingStatusReadModel.includes('return at ? { at } : null') &&
    !billingStatusReadModel.includes('catch'),
  'Billing status reserves null for a successful empty table and propagates query failures',
);
assert(
  billingRoute.includes('await getBillingLastGenerated()') &&
    billingRoute.includes("return c.json({ error: 'billing_status_unavailable' }, 503)") &&
    !/catch\s*\{[\s\S]{0,120}lastGenerated\s*=\s*null/.test(billingRoute),
  'Billing status converts an operational failure to an explicit retriable 503, never a never-generated value',
);
const mainRoute = read('src/main.ts');
assert(
  mainRoute.includes("isSafeClientError && err.message ? err.message : 'Internal server error'") &&
    mainRoute.includes('app.onError'),
  'uncaught portal query failures use the shared redacted 500 response',
);
const connectionsReadModel = read('src/lib/client-portal/read-models/integrations.ts');
assert(
  connectionsReadModel.includes('if (!isMissingConnectionFreshnessColumnError(error)) throw error') &&
    !connectionsReadModel.includes('return [];'),
  'Connections retains only its documented schema-compatibility fallback and rethrows operational failures',
);

// CP-055 frontend truth: primary surfaces never render failed data as empty.
const dashboard = read('portal-client/src/pages/Dashboard.tsx');
const analysis = read('portal-client/src/pages/Analysis.tsx');
const billing = read('portal-client/src/pages/Billing.tsx');
assert(
  dashboard.includes('if (dash.isError)') && dashboard.includes('onRetry={() => dash.refetch()}'),
  'Dashboard replaces failed zero/empty projections with an explicit retry state',
);
assert(
  analysis.includes('if (analysis.isError)') && analysis.includes('onRetry={() => analysis.refetch()}'),
  'Analysis replaces failed zero/empty projections with an explicit retry state',
);
assert(
  billing.includes('billingStatus.isError') &&
    billing.includes("? 'unavailable'") &&
    billing.includes('onClick={() => billingStatus.refetch()}'),
  'Billing never presents a failed status read as never and exposes Retry',
);

const primaryListPages = [
  'Orders.tsx',
  'Shipments.tsx',
  'Returns.tsx',
  'Inventory.tsx',
  'Inbound.tsx',
  'Connections.tsx',
  'Invoices.tsx',
];
for (const file of primaryListPages) {
  const source = read(`portal-client/src/pages/${file}`);
  assert(
    source.includes('QueryState') && source.includes('isError='),
    `${file} distinguishes primary-query failure from a legitimate empty dataset`,
  );
}

const app = read('portal-client/src/App.tsx');
assert(
  app.includes('if (me.isError)') && app.includes('onRetry={() => me.refetch()}'),
  'capability lookup failure renders unavailable/retry instead of a false authorization redirect',
);
const topbar = read('portal-client/src/components/layout/Topbar.tsx');
assert(
  topbar.includes('clientsQuery.isError') &&
    topbar.includes('Client list unavailable. Retry.') &&
    topbar.includes('sync.isError') &&
    topbar.includes('Connection freshness is unavailable.'),
  'shell client and connection reads expose explicit unavailable/retry states',
);
const sidebar = read('portal-client/src/components/layout/Sidebar.tsx');
const bottomNav = read('portal-client/src/components/layout/BottomNav.tsx');
assert(
  sidebar.includes('badgeUnavailable') &&
    bottomNav.includes('badgeUnavailable') &&
    !sidebar.includes('useAwaitingCount().data?.count ?? 0') &&
    !bottomNav.includes('useAwaitingCount().data?.count ?? 0'),
  'an unavailable awaiting-order count is never rendered as a believable zero badge',
);

const access = read('portal-client/src/components/settings/AccessTab.tsx');
const billingSettings = read('portal-client/src/components/settings/BillingTab.tsx');
assert(
  access.includes('accessList.isError || clientsQuery.isError') &&
    access.includes('Promise.all([accessList.refetch(), clientsQuery.refetch()])'),
  'Access distinguishes roster/client lookup failure from no matching logins',
);
assert(
  billingSettings.includes('query.isLoading || query.isError') &&
    billingSettings.includes('onRetry={() => query.refetch()}'),
  'Settings Billing distinguishes client lookup failure from no billed accounts',
);
const openOrdersPeek = read('portal-client/src/components/dashboard/peek/OpenOrdersPeek.tsx');
const orderDetail = read('portal-client/src/components/OrderDetailLoader.tsx');
const returnDetail = read('portal-client/src/components/returns/ReturnDetailDrawer.tsx');
assert(
  openOrdersPeek.includes('if (q.isError)') && openOrdersPeek.includes('onRetry={() => q.refetch()}'),
  'Dashboard open-orders drill-down distinguishes failure from no awaiting orders',
);
assert(
  orderDetail.includes('onRetry={() => q.refetch()}') &&
    returnDetail.includes('onClick={() => query.refetch()}'),
  'order and return detail failures expose retry actions',
);

assert(
  !queryState.includes('error instanceof Error ? error.message') &&
    queryState.includes('This information is temporarily unavailable. Please retry.'),
  'shared read failures render redaction-safe copy instead of raw backend error detail',
);
const auditLog = read('portal-client/src/pages/AuditLog.tsx');
assert(
  !auditLog.includes('audit.error instanceof Error ? audit.error.message') &&
    auditLog.includes('Portal audit events are temporarily unavailable.'),
  'Audit Log failure copy does not expose backend error detail',
);
const rates = read('portal-client/src/pages/Rates.tsx');
assert(
  rates.includes('does not (yet) expose as a live endpoint') &&
    rates.includes('aren’t published to the') &&
    !rates.includes('useQuery'),
  'Rate Sheet labels its intentional non-live state instead of fabricating backend truth',
);

const runtimeFixture = read('scripts/client-portal-failure-states-runtime.ts');
assert(
  runtimeFixture.includes('assert.rejects') &&
    runtimeFixture.includes('a successful empty billing table returns null'),
  'runtime fixtures distinguish a legitimate empty Billing result from an injected DB failure',
);

const pkg = JSON.parse(read('package.json'));
assert(
  pkg.scripts?.['test:client-portal-failure-states'] ===
    'node scripts/client-portal-failure-states-guard.mjs && tsx scripts/client-portal-failure-states-runtime.ts',
  'package.json exposes the static guard and injected runtime fixtures',
);

if (failed) process.exit(1);
console.log('\nClient portal failure-states guard passed.');
