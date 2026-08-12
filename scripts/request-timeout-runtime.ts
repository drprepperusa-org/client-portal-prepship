import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://user:pass@localhost:5432/timeout';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'test';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test';
process.env.SUPABASE_JWT_SECRET ||= 'test';
// Keep the budget tiny so the suite stays fast.
process.env.REQUEST_TIMEOUT_MS = '120';

const { Hono } = await import('hono');
const { requestTimeout, isTimeoutExempt } = await import('../src/middleware/request-timeout');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const app = new Hono();
app.use('*', requestTimeout);
app.get('/fast', (c) => c.json({ ok: true }));
app.get('/slow', async (c) => {
  await sleep(600);
  return c.json({ ok: true });
});
app.get('/boom', () => {
  throw new Error('handler exploded');
});
// An exempt route that outruns the budget must still be allowed to finish.
app.get('/api/client-portal/invoice', async (c) => {
  await sleep(400);
  return c.text('<html>invoice</html>');
});

const fast = await app.request('/fast');
assert.equal(fast.status, 200, 'a fast request passes straight through');
console.log('ok: a fast request is untouched');

const slow = await app.request('/slow');
assert.equal(slow.status, 503, 'a request over budget must fail fast with 503');
assert.equal(slow.headers.get('Retry-After'), '5', 'a timed-out response must tell the client when to retry');
assert.match(
  ((await slow.json()) as { error: string }).error,
  /took too long/i,
  'the timeout response must carry an actionable message the UI can render',
);
console.log('ok: a request over budget returns 503 instead of hanging');

const exempt = await app.request('/api/client-portal/invoice');
assert.equal(exempt.status, 200, 'an exempt long-running route must not be cut off');
console.log('ok: an exempt route outruns the budget without being cut off');

// A handler failure before the budget elapses must not be masked as a timeout.
const boom = await app.request('/boom');
assert.equal(boom.status, 500, 'a handler error must propagate rather than be swallowed');
console.log('ok: a handler error still propagates');

assert.equal(isTimeoutExempt('/api/client-portal/orders'), false, 'ordinary routes are bounded');
assert.equal(isTimeoutExempt('/api/client-portal/inbound/import'), true, 'bulk import is exempt');
assert.equal(
  isTimeoutExempt('/api/client-portal/returns/42/external-label-pdf'),
  true,
  'return-label upload is exempt',
);
assert.equal(
  isTimeoutExempt('/api/client-portal/returns/42/inspection/7/media'),
  true,
  'inspection media upload is exempt',
);
console.log('ok: the exemption list covers the upload and export routes only');

console.log('\nrequest timeout runtime fixtures passed.');
