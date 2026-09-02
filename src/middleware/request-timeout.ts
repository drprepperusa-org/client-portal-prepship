import { createMiddleware } from 'hono/factory';
import { env } from '../lib/env';

// Whole-request budget, added after the 2026-08-12 outage. When the request
// pool was starved, postgres.js queued connection acquisition with no timeout,
// so requests hung until the browser aborted at 30s. react-query never saw an
// error — the queries just stayed pending — and the dashboard rendered loading
// skeletons indefinitely. A silent hang is the worst failure mode available:
// it looks like "no data" rather than "something is broken".
//
// IMPORTANT: losing this race does NOT cancel the handler. The handler keeps
// running and keeps whatever pooled connection it already holds, so this does
// not by itself relieve pool pressure — it bounds what the CALLER waits for.
// Reclaiming connections is the job of statement_timeout /
// idle_in_transaction_session_timeout in db/client.ts.

const TIMED_OUT = Symbol('request-timed-out');

// Routes that legitimately outrun the normal budget and own their own limits:
// invoice rendering across a billing range, bulk inbound import, and the
// return-label / inspection-media uploads (the browser allows 120s for those).
const EXEMPT_PREFIXES = [
  '/api/client-portal/invoice',
  // CP-068: the invoice exports are PrepShip's files across a billing range; the proxy owns
  // its own 60s ceiling. Exact-path entries — the prefix rule above needs a trailing slash.
  '/api/client-portal/invoice.xlsx',
  '/api/client-portal/invoice.csv',
  '/api/client-portal/inbound/import',
];
const EXEMPT_SUFFIXES = ['/external-label-pdf', '/media'];

export function isTimeoutExempt(path: string): boolean {
  return (
    EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`)) ||
    EXEMPT_SUFFIXES.some((s) => path.endsWith(s))
  );
}

export const requestTimeout = createMiddleware(async (c, next) => {
  if (isTimeoutExempt(c.req.path)) {
    await next();
    return;
  }

  const budgetMs = env.REQUEST_TIMEOUT_MS;
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;

  // Swallow a late rejection only once the response has already gone out;
  // otherwise rethrow so Hono's normal error handling still applies.
  const pending = next().catch((err: unknown) => {
    if (timedOut) {
      console.warn('[request-timeout] handler rejected after the budget elapsed', {
        path: c.req.path,
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    throw err;
  });

  const expiry = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve(TIMED_OUT);
    }, budgetMs);
  });

  try {
    const outcome = await Promise.race([pending.then(() => 'settled' as const), expiry]);
    if (outcome !== TIMED_OUT) return;
  } finally {
    if (timer) clearTimeout(timer);
  }

  console.warn('[request-timeout] request exceeded its budget', {
    method: c.req.method,
    path: c.req.path,
    budgetMs,
  });

  return c.json(
    { error: 'The server took too long to respond. Please retry.' },
    503,
    { 'Retry-After': '5' }
  );
});
