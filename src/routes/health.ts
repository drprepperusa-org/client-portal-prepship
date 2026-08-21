import { Hono } from 'hono';
import postgres from 'postgres';
import { performance } from 'node:perf_hooks';
import { env } from '../lib/env';
import { sql } from '../db/client';

const app = new Hono();
const DB_HEALTH_TIMEOUT_MS = env.DB_HEALTH_TIMEOUT_MS;
const DB_POOL_HEALTH_TIMEOUT_MS = env.DB_POOL_HEALTH_TIMEOUT_MS;
const DB_HEALTH_STATEMENT_TIMEOUT_MS = Math.max(1_000, DB_HEALTH_TIMEOUT_MS - 1_000);
const DB_HEALTH_CONNECT_TIMEOUT_SECONDS = Math.max(1, Math.ceil(DB_HEALTH_TIMEOUT_MS / 1_000));
const EVENT_LOOP_HEALTH_TIMEOUT_MS = 500;
const EVENT_LOOP_DELAY_BUDGET_MS = 250;
const DEPLOYED_COMMIT = env.RENDER_GIT_COMMIT?.trim() || env.GIT_SHA?.trim() || 'unknown';

function createHealthPool() {
  return postgres(env.DATABASE_URL, {
    prepare: false,
    max: 3,
    idle_timeout: 10,
    connect_timeout: DB_HEALTH_CONNECT_TIMEOUT_SECONDS,
    connection: { statement_timeout: DB_HEALTH_STATEMENT_TIMEOUT_MS },
  });
}

// Private to this route. Replaceable on purpose: a probe that times out has a
// connection that stopped answering, and postgres.js keeps that connection in
// its busy list forever (no socket-level timeout exists for an in-flight query)
// while pipelining later probes onto it. Retaining it turned one stall into a
// permanently poisoned slot — the 2026-08 db/orders/printQueue 503s that only a
// restart cleared. See scripts/health-wedged-pool-runtime.ts.
let healthSql = createHealthPool();

class ProbeTimeoutError extends Error {}

function resetHealthPool(reason: string) {
  const retired = healthSql;
  healthSql = createHealthPool();
  console.error(`[health:ready] health pool reset reason=${reason}`);
  // end({ timeout: 0 }) destroys every connection of the retired pool,
  // including the wedged one, and rejects anything still queued on it.
  void retired.end({ timeout: 0 }).catch(() => undefined);
}

type CancelableQuery<T> = Promise<T> & { cancel?: () => void };

type ReadinessComponentName =
  | 'db'
  | 'orders'
  | 'printQueue'
  | 'eventLoop'
  | 'requestPool';

type ReadinessComponent = {
  name: ReadinessComponentName;
  status: 'ok' | 'fail';
  latencyMs: number;
  details?: Record<string, number | string>;
};

async function withTimeout<T>(
  query: CancelableQuery<T>,
  timeoutMs: number,
  name?: ReadinessComponentName
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const startedAt = Date.now();
  try {
    return await Promise.race([
      query,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          query.cancel?.();
          // The race discards the query's eventual outcome, which is the only
          // place the real failure (e.g. postgres.js CONNECT_TIMEOUT) surfaces.
          // Log how it finally settles so a probe that loses the race still
          // tells us WHY instead of just "timed out".
          if (name) {
            query.then(
              () => {
                console.error(
                  `[health:ready] component=${name} late-settle=ok afterMs=${Date.now() - startedAt}`
                );
              },
              (error: unknown) => {
                const code =
                  error && typeof error === 'object' && 'code' in error
                    ? String((error as { code: unknown }).code)
                    : 'unknown';
                // Self-inflicted by resetHealthPool(); nothing to diagnose.
                if (code === 'CONNECTION_DESTROYED') return;
                const firstLine = (error instanceof Error ? error.message : String(error))
                  .split('\n', 1)[0]
                  ?.slice(0, 120);
                console.error(
                  `[health:ready] component=${name} late-settle=fail code=${code} reason=${firstLine} afterMs=${Date.now() - startedAt}`
                );
              }
            );
          }
          reject(new ProbeTimeoutError(`DB health check timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// One safe line per component failure. The readiness JSON is public, so the
// reason stays server-side; without this log the underlying postgres.js error
// (CONNECT_TIMEOUT vs auth vs protocol) is unobservable in production — the
// 2026-08 db/orders/printQueue 503s ran for days with no way to tell which.
function logComponentFailure(name: ReadinessComponentName, error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'unknown';
  const firstLine = (error instanceof Error ? error.message : String(error))
    .split('\n', 1)[0]
    ?.slice(0, 120);
  console.error(`[health:ready] component=${name} fail code=${code} reason=${firstLine}`);
}

type ProbeOutcome = { component: ReadinessComponent; timedOut: boolean };

async function checkComponent(
  name: ReadinessComponentName,
  action: () => Promise<{ details?: Record<string, number | string> } | void>
): Promise<ProbeOutcome> {
  const startedAt = Date.now();
  try {
    const result = await action();
    return {
      component: {
        name,
        status: 'ok',
        latencyMs: Date.now() - startedAt,
        ...(result?.details ? { details: result.details } : {}),
      },
      timedOut: false,
    };
  } catch (error) {
    logComponentFailure(name, error);
    return {
      component: {
        name,
        status: 'fail',
        latencyMs: Date.now() - startedAt,
      },
      timedOut: error instanceof ProbeTimeoutError,
    };
  }
}

// Probes that run on the private health pool. A timeout on any of them means a
// health-pool connection stopped answering and must be evicted.
const HEALTH_POOL_PROBES: ReadonlySet<ReadinessComponentName> = new Set([
  'db',
  'orders',
  'printQueue',
]);

export async function checkDeepReadiness() {
  const outcomes = await Promise.all([
    checkComponent('db', async () => {
      await withTimeout(healthSql`select 1`, DB_HEALTH_TIMEOUT_MS, 'db');
    }),
    checkComponent('orders', async () => {
      await withTimeout(healthSql`select 1 from orders limit 1`, DB_HEALTH_TIMEOUT_MS, 'orders');
    }),
    checkComponent('printQueue', async () => {
      const [summary] = await withTimeout(
        healthSql`
          select
            count(*)::int as total_count,
            count(*) filter (where status = 'queued')::int as queued_count
          from print_queue_orders
        `,
        DB_HEALTH_TIMEOUT_MS,
        'printQueue'
      );

      return {
        details: {
          totalCount: Number(summary?.total_count ?? 0),
          queuedCount: Number(summary?.queued_count ?? 0),
        },
      };
    }),
    checkComponent('eventLoop', async () => {
      const startedAt = performance.now();
      await withTimeout(
        new Promise<void>((resolve) => setTimeout(resolve, 0)) as CancelableQuery<void>,
        EVENT_LOOP_HEALTH_TIMEOUT_MS
      );
      const delayMs = Math.round(performance.now() - startedAt);
      if (delayMs > EVENT_LOOP_DELAY_BUDGET_MS) {
        throw new Error('event loop delay budget exceeded');
      }
      return { details: { delayMs, budgetMs: EVENT_LOOP_DELAY_BUDGET_MS } };
    }),
    // The pool that actually serves requests. Every check above runs on
    // healthSql, a pool private to this route, so they only prove Postgres is
    // reachable. On 2026-08-12 they all reported ok in ~22ms while the request
    // pool was fully starved and the portal served nothing — readiness stayed
    // green through a total outage. This probe is the one that goes red.
    checkComponent('requestPool', async () => {
      await withTimeout(sql`select 1`, DB_POOL_HEALTH_TIMEOUT_MS, 'requestPool');
      return {
        details: { poolMax: env.DB_POOL_MAX, budgetMs: DB_POOL_HEALTH_TIMEOUT_MS },
      };
    }),
  ]);

  const components = outcomes.map((outcome) => outcome.component);
  const wedged = outcomes
    .filter((outcome) => outcome.timedOut && HEALTH_POOL_PROBES.has(outcome.component.name))
    .map((outcome) => outcome.component.name);
  // After every probe has settled, so the reset cannot fail a sibling probe
  // that was still in flight on the retired pool.
  if (wedged.length > 0) resetHealthPool(`timeout component=${wedged.join(',')}`);

  return {
    ok: components.every((component) => component.status === 'ok'),
    components,
  };
}

function readinessResponseBody(readiness: Awaited<ReturnType<typeof checkDeepReadiness>>) {
  return {
    status: readiness.ok ? 'ready' : 'degraded',
    commit: DEPLOYED_COMMIT,
    components: readiness.components,
    ts: new Date().toISOString(),
  };
}

app.get('/', (c) =>
  c.json({
    status: 'ok',
    commit: DEPLOYED_COMMIT,
    ts: new Date().toISOString(),
  })
);

app.get('/ready', async (c) => {
  const readiness = await checkDeepReadiness();
  return c.json(readinessResponseBody(readiness), readiness.ok ? 200 : 503);
});

app.get('/deep', async (c) => {
  const readiness = await checkDeepReadiness();
  return c.json(readinessResponseBody(readiness), readiness.ok ? 200 : 503);
});

export default app;
