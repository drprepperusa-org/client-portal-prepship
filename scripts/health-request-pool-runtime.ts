import assert from 'node:assert/strict';

// Point every pool at an unroutable TEST-NET-1 address (RFC 5737) so nothing
// can connect. This reproduces the shape of the 2026-08-12 outage: the request
// pool cannot serve, and readiness must say so instead of reporting green.
process.env.DATABASE_URL = 'postgres://user:pass@192.0.2.1:5432/unreachable';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'test';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test';
process.env.SUPABASE_JWT_SECRET ||= 'test';
// Keep the suite fast; the budgets are what we assert against, not their size.
process.env.DB_HEALTH_TIMEOUT_MS = '1000';
process.env.DB_POOL_HEALTH_TIMEOUT_MS = '500';
process.env.DB_CONNECT_TIMEOUT_SECONDS = '1';

const { checkDeepReadiness } = await import('../src/routes/health');

// Capture the readiness failure log lines. A component that fails must say WHY
// on the server side — the public JSON stays reason-free, so without this line
// a production probe failure is undiagnosable (the 2026-08 db/orders/printQueue
// 503s ran for days with the underlying error swallowed).
const failureLogLines: string[] = [];
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const line = args.map(String).join(' ');
  if (line.startsWith('[health:ready]')) failureLogLines.push(line);
  originalConsoleError(...args);
};

const startedAt = Date.now();
const readiness = await checkDeepReadiness();
const elapsedMs = Date.now() - startedAt;
console.error = originalConsoleError;

// The whole point: an unusable pool must resolve to a verdict, not hang. If
// this ever hangs, readiness hangs, and the watchdog reads a timeout instead of
// a clean 503.
assert.ok(elapsedMs < 10_000, `readiness must resolve promptly, took ${elapsedMs}ms`);
console.log(`ok: readiness resolved in ${elapsedMs}ms instead of hanging`);

const names = readiness.components.map((component) => component.name);
assert.ok(names.includes('requestPool'), 'readiness must report the shared request pool');
console.log('ok: readiness reports a requestPool component');

const requestPool = readiness.components.find((component) => component.name === 'requestPool');
assert.equal(
  requestPool?.status,
  'fail',
  'an unusable request pool must be reported as failed, not ok',
);
console.log('ok: an unusable request pool is reported as failed');

assert.equal(
  readiness.ok,
  false,
  'readiness must be not-ok when the request pool cannot serve, so /health/deep returns 503',
);
console.log('ok: readiness is not-ok, so the endpoint answers 503 and the watchdog goes red');

assert.ok(
  (requestPool?.latencyMs ?? 0) < 5_000,
  'the request pool probe must fail within its own budget rather than the DB budget',
);
console.log(`ok: the probe failed inside its budget (${requestPool?.latencyMs}ms)`);

const failedComponents = readiness.components.filter((component) => component.status === 'fail');
for (const component of failedComponents) {
  assert.ok(
    failureLogLines.some((line) => line.includes(`component=${component.name}`) && line.includes('code=')),
    `a failed ${component.name} probe must log a [health:ready] line naming its error code`,
  );
}
console.log(
  `ok: every failed component logged a diagnosable reason (${failureLogLines.length} lines)`,
);

console.log('\nhealth request-pool runtime fixtures passed.');
process.exit(0);
