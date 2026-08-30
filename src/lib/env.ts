import 'dotenv/config';
import { z } from 'zod';

const booleanFlag = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) return defaultValue;
      const normalized = value.trim().toLowerCase();
      return normalized === 'true' || normalized === '1' || normalized === 'yes';
    });

const optionalBooleanFlag = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  });

const schema = z.object({
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Deployed commit SHA surfaced by /health. Render injects RENDER_GIT_COMMIT
  // on every deploy; GIT_SHA is the manual fallback for other environments.
  RENDER_GIT_COMMIT: z.string().optional(),
  GIT_SHA: z.string().optional(),
  WEB_ORIGIN: z.string().optional(),
  // Public base URL of this API. Used when we need to emit an absolute link
  // back to the frontend (e.g. mock label PDFs opened via window.open).
  PUBLIC_API_URL: z.string().url().optional(),
  // Canonical PrepShip API used for admin-owned mutations that the Client
  // Portal may request but must never implement as a second source of truth.
  PREPSHIP_API_URL: z.string().url().optional(),
  CRON_SECRET: z.string().optional(),
  DB_HEALTH_TIMEOUT_MS: z.coerce.number().int().positive().default(12_000),
  // Budget for the readiness probe that runs on the SHARED request pool. Kept
  // well under DB_HEALTH_TIMEOUT_MS: a healthy pool answers `select 1` in tens
  // of milliseconds, so anything approaching seconds already means requests are
  // queueing for a connection. Failing fast here is the signal we want.
  DB_POOL_HEALTH_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  // Connections the REQUEST pool may open. Raised from 4 to 10 on 2026-08-30.
  //
  // With 4, a cold start after deploy 503'd the portal for ~4 minutes: real requests
  // (/inventory, /billing/status, /invoice-summary) each exhausted the 15s budget while
  // queueing for a connection, and the readiness probe's `select 1` was cancelled at 5002ms.
  // Production never set this variable, so it ran on the default while local dev used 8.
  //
  // 10 is chosen against a Supabase TRANSACTION pooler (`prepare: false` in db/client.ts is
  // that pooler's requirement), where client connections are cheap and multiplexed — the
  // constraint is the pooler's own capacity, not Postgres max_connections. It stays well under
  // the 20 cap, and the route's private health pool (max 3) is deliberately separate so a
  // starved request pool still reports rather than going dark.
  //
  // This is HEADROOM, not a guarantee. The pool fills lazily, so a cold start still pays
  // connection setup on its first requests; ten slots establish in parallel where four
  // serialised behind each other. If a burst can saturate ten, the honest fix is a warmed
  // pool at boot, not a larger number.
  DB_POOL_MAX: z.coerce.number().int().positive().max(20).default(10),
  DB_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(10),
  DB_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(8),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(12_000),
  // Backstop for a connection that opens a transaction and then stalls waiting
  // on the client. statement_timeout cannot cover this: the backend is idle in
  // transaction, not executing, so Postgres never applies it. Without this a
  // stalled peer holds a pooled connection until the pooler hard-kills it.
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  // Whole-request budget. Sits above DB_STATEMENT_TIMEOUT_MS (a single slow
  // query fails on its own first) and below the browser's 30s abort, so a
  // starved pool returns an actionable 503 instead of a socket that hangs
  // until the client gives up and the UI renders skeletons forever.
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  STRICT_JWT_CLAIMS: booleanFlag(false),
  CLIENT_PORTAL_ONLY_API: booleanFlag(true),
  // CP-027 — return-label live-postage approval flag. OFF by default: the
  // return-label service takes an offline-mock path (fake tracking, cost 0.00,
  // source 'test_offline', no carrier call) unless this is explicitly truthy.
  // The live ShipStation purchase path may ONLY run when this is true AND the
  // client is not a test client.
  RETURNS_LIVE_LABELS: booleanFlag(false),
  // CP-028 — Shopify return-delivery approval flag. OFF by default: the return
  // delivery resolver always resolves to 'manual_pdf' (PDF-download only) unless
  // this is explicitly truthy. The shopify_native delivery attempt may ONLY run
  // when this is true AND the store is genuinely Shopify-capable (a live store
  // connector for 'shipment.confirm'). When off, no live Shopify/customer
  // notification can ever fire.
  RETURNS_SHOPIFY_DELIVERY: booleanFlag(false),
  // Shopify direct client store connect — master switch for the order-sync
  // poller. Off by default so deploy != activate.
  SHOPIFY_SYNC_ENABLED: booleanFlag(false),
  // CP-030 — durable inspection media (Supabase Storage). The 3PL receiving
  // flow relays captured photos/video to this PRIVATE bucket via the service
  // client; the DB stores only the object path, and the client reads media
  // through short-lived signed URLs (never public). The bucket must exist with
  // private access (owner/service-role read+write only).
  RETURNS_MEDIA_BUCKET: z.string().min(1).default('returns-inspection-media'),
  RETURNS_MEDIA_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  // Runtime split controls. Default RUN_SYNC_SCHEDULER=true keeps legacy API
  // deploys working until Render envs are explicitly flipped during rollout.
  RUN_SYNC_SCHEDULER: booleanFlag(true),
  // Carrier-status reconciliation is independent from marketplace/order sync.
  // Keep it opt-in so local/test API processes never mutate shipment history.
  RUN_SHIPMENT_TRACKING_SWEEP: booleanFlag(false),
  WORKER_PLACEHOLDER: booleanFlag(false),
  RUN_ORDERS_PERFORMANCE_MAINTENANCE: optionalBooleanFlag,
  USE_PG_BOSS_SCHEDULER: booleanFlag(true),
  PG_BOSS_SCHEMA: z.string().min(1).default('pgboss'),
  PG_BOSS_POOL_MAX: z.coerce.number().int().positive().max(5).default(1),
  SHIPSTATION_API_KEY: z.string().optional(),
  SHIPSTATION_API_SECRET: z.string().optional(),
  SHIPSTATION_API_KEY_V2: z.string().optional(),
  // CP-042 — optional official USPS tracking API credentials. When unset, the
  // backend keeps using ShipStation label tracking as the fallback source.
  USPS_TRACKING_CLIENT_ID: z.string().optional(),
  USPS_TRACKING_CLIENT_SECRET: z.string().optional(),
  USPS_TRACKING_BASE_URL: z.string().url().default('https://apis.usps.com'),
  SHIP_FROM_NAME: z.string().optional(),
  SHIP_FROM_COMPANY: z.string().optional(),
  SHIP_FROM_STREET1: z.string().optional(),
  SHIP_FROM_STREET2: z.string().optional(),
  SHIP_FROM_CITY: z.string().optional(),
  SHIP_FROM_STATE: z.string().optional(),
  SHIP_FROM_POSTAL_CODE: z.string().optional(),
  SHIP_FROM_COUNTRY: z.string().default('US'),
  SHIP_FROM_PHONE: z.string().optional(),
  ENABLE_RATE_BACKFILL_SCHEDULER: z
    .string()
    .optional()
    .transform((value) => value === 'true' || value === '1'),
  DISABLE_RATE_BACKFILL_SCHEDULER: z
    .string()
    .optional()
    .transform((value) => value === 'true' || value === '1'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
