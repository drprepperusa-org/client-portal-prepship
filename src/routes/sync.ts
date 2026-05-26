import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getSyncStatus, syncOrders } from '../services/order-sync';
import { getShipmentSyncStatus, syncShipments } from '../services/shipment-sync';
import { startBackfillBestRates } from '../services/rates-backfill';
import { importSkusFromOrders, syncShipStationProducts } from '../services/inventory-enrichment';
import { requirePermission } from '../middleware/auth';
import {
  getApiRuntimeStatus,
  getPersistedWorkerStatus,
} from '../services/worker-status';
import { getSyncJobQueueStatus } from '../services/sync-job-queue';

const app = new Hono();

const backfillTargetSchema = z.enum([
  'orders',
  'shipments',
  'inventory-from-orders',
  'products',
  'all',
]);

const backfillBody = z.object({
  target: backfillTargetSchema,
  mode: z.enum(['incremental', 'full']).optional().default('incremental'),
  pageSize: z.number().int().min(1).max(500).optional(),
});

type BackfillTarget = z.infer<typeof backfillTargetSchema>;
type BackfillMode = z.infer<typeof backfillBody>['mode'];

type BackfillResult = {
  target: Exclude<BackfillTarget, 'all'>;
  ok: boolean;
  data?: unknown;
  error?: string;
};

const triggerBody = z
  .object({
    sinceIso: z.string().datetime().optional(),
    sinceMs: z.number().int().nonnegative().optional(),
    pageSize: z.number().int().min(1).max(500).optional(),
    fullResync: z.boolean().optional(),
    // v2's button sends { full: true } for legacy sync. Keep accepting it,
    // but reserve full historical order backfills for explicit fullResync.
    full: z.boolean().optional(),
  })
  .optional()
  .default({});

app.post('/orders', zValidator('json', triggerBody), async (c) => {
  const body = c.req.valid('json') ?? {};
  const fullResync = body.fullResync === true;
  const legacyFull = body.full === true;
  const sinceMs = fullResync
    ? 0
    : body.sinceMs !== undefined
      ? body.sinceMs
    : body.sinceIso
      ? Date.parse(body.sinceIso)
      : undefined;
  const result = await syncOrders({
    sinceMs,
    awaitingSinceMs: fullResync ? 0 : sinceMs,
    pageSize: body.pageSize,
  });
  const shouldBackfillRates = fullResync || legacyFull || result.synced > 0;
  const rateBackfillJob = shouldBackfillRates
    ? (() => {
        const job = startBackfillBestRates({ limit: 1000 });
        return { jobId: job.jobId, status: job.status };
      })()
    : null;

  return c.json({ ...result, rateBackfillJob });
});

async function runBackfillTarget(
  target: Exclude<BackfillTarget, 'all'>,
  mode: BackfillMode,
  pageSize?: number
): Promise<BackfillResult> {
  try {
    if (target === 'orders') {
      const fullResync = mode === 'full';
      const result = await syncOrders({
        sinceMs: fullResync ? 0 : undefined,
        awaitingSinceMs: fullResync ? 0 : undefined,
        pageSize,
      });
      const shouldBackfillRates = fullResync || result.synced > 0;
      const rateBackfillJob = shouldBackfillRates
        ? (() => {
            const job = startBackfillBestRates({ limit: 1000 });
            return { jobId: job.jobId, status: job.status };
          })()
        : null;
      return { target, ok: true, data: { ...result, rateBackfillJob } };
    }

    if (target === 'shipments') {
      const result = await syncShipments({ sinceMs: mode === 'full' ? 0 : undefined });
      return { target, ok: true, data: result };
    }

    if (target === 'inventory-from-orders') {
      const result = await importSkusFromOrders();
      return { target, ok: true, data: result };
    }

    const result = await syncShipStationProducts();
    return { target, ok: true, data: result };
  } catch (error) {
    return {
      target,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

app.post('/backfill', requirePermission('settings:write'), zValidator('json', backfillBody), async (c) => {
  const body = c.req.valid('json');
  const startedAt = new Date().toISOString();
  const targets: Array<Exclude<BackfillTarget, 'all'>> =
    body.target === 'all'
      ? ['orders', 'shipments', 'inventory-from-orders', 'products']
      : [body.target];

  const results: BackfillResult[] = [];
  for (const target of targets) {
    results.push(await runBackfillTarget(target, body.mode, body.pageSize));
  }

  const ok = results.every((result) => result.ok);
  return c.json({
    ok,
    target: body.target,
    mode: body.mode,
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
  });
});

app.get('/status', async (c) => {
  const [orders, shipments, worker, queue] = await Promise.all([
    getSyncStatus({ includeOrderCount: false }),
    getShipmentSyncStatus({ includeShipmentCount: false }),
    getPersistedWorkerStatus(),
    getSyncJobQueueStatus(),
  ]);
  const workerSchedulerActive = Boolean(
    worker.status?.schedulerEnabled && !worker.stale
  );
  const queueStatus = {
    ...queue,
    enabled: queue.enabled || workerSchedulerActive,
    started: queue.started || workerSchedulerActive,
  };
  return c.json({
    // Legacy top-level fields kept for existing frontend callers.
    ...orders,
    status: orders.lastSyncedAt ? 'done' : 'idle',
    mode: orders.lastSyncedAt ? 'incremental' : 'idle',
    error: null as string | null,
    page: 0,
    total: 0,
    count: 0,
    lastSync:
      orders.lastSyncedAt && Number.isFinite(Date.parse(orders.lastSyncedAt))
        ? Date.parse(orders.lastSyncedAt)
        : null,
    lastSyncAt: orders.lastSyncedAt,
    cadenceMinutes: {
      orders: 3,
      shipments: 3,
      rateBackfill: 10,
      inventoryFromOrders: 30,
      productCatalog: 60,
      reportingMetrics: 30,
    },
    ratePrefetchRunning: false,
    ratePrefetchJob: null,
    orders,
    shipments,
    worker,
    queue: queueStatus,
    api: getApiRuntimeStatus(),
  });
});

export default app;
