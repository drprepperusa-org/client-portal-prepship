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
  CRON_SECRET: z.string().optional(),
  DB_HEALTH_TIMEOUT_MS: z.coerce.number().int().positive().default(12_000),
  DB_POOL_MAX: z.coerce.number().int().positive().max(20).default(4),
  DB_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(10),
  DB_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(8),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(12_000),
  STRICT_JWT_CLAIMS: booleanFlag(false),
  CLIENT_PORTAL_ONLY_API: booleanFlag(false),
  // CP-027 — return-label live-postage approval flag. OFF by default: the
  // return-label service takes an offline-mock path (fake tracking, cost 0.00,
  // source 'test_offline', no carrier call) unless this is explicitly truthy.
  // The live ShipStation purchase path may ONLY run when this is true AND the
  // client is not a test client.
  RETURNS_LIVE_LABELS: booleanFlag(false),
  // Runtime split controls. Default RUN_SYNC_SCHEDULER=true keeps legacy API
  // deploys working until Render envs are explicitly flipped during rollout.
  RUN_SYNC_SCHEDULER: booleanFlag(true),
  WORKER_PLACEHOLDER: booleanFlag(false),
  RUN_ORDERS_PERFORMANCE_MAINTENANCE: optionalBooleanFlag,
  USE_PG_BOSS_SCHEDULER: booleanFlag(true),
  PG_BOSS_SCHEMA: z.string().min(1).default('pgboss'),
  PG_BOSS_POOL_MAX: z.coerce.number().int().positive().max(5).default(1),
  SHIPSTATION_API_KEY: z.string().optional(),
  SHIPSTATION_API_SECRET: z.string().optional(),
  SHIPSTATION_API_KEY_V2: z.string().optional(),
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
