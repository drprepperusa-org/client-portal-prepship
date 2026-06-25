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
//   3. The live Orders page wires its query error/refetch into that UI.
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
assert(api.includes('const TIMEOUT_MS = 15000'), 'api.ts defines a bounded request timeout (15s)');
assert(api.includes('new AbortController()'), 'api.ts uses AbortController to bound requests');
assert(
  api.includes('controller.abort()') && api.includes('clearTimeout('),
  'api.ts aborts timed-out requests and clears the timer',
);
assert(
  api.includes('Promise<never>') && api.includes('throw new Error(message)'),
  'api.ts fail() throws — HTTP errors are surfaced, not hidden behind empty fallbacks',
);
assert(
  api.includes('if (!res.ok) await fail(res)'),
  'apiGet/apiSend rethrow non-OK responses instead of returning empty data',
);

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

// ── package.json wiring ──
const pkg = JSON.parse(read('package.json'));
assert(
  pkg.scripts?.['test:client-portal-failure-states'] === 'node scripts/client-portal-failure-states-guard.mjs',
  'package.json exposes test:client-portal-failure-states',
);

if (failed) process.exit(1);
console.log('\nClient portal failure-states guard passed.');
