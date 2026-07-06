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
const returns = read('portal-client/src/pages/Returns.tsx');
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
const pkg = JSON.parse(read('package.json'));
assert(
  pkg.scripts?.['test:client-portal-failure-states'] === 'node scripts/client-portal-failure-states-guard.mjs',
  'package.json exposes test:client-portal-failure-states',
);

if (failed) process.exit(1);
console.log('\nClient portal failure-states guard passed.');
