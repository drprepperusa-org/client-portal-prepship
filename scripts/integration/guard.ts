/* Prod-safety gate for the client-portal integration harness.
 *
 * This suite SEEDS and TRUNCATES tables, so it must NEVER touch the production
 * database. Call setupTestEnv() FIRST — before importing any db-bound module —
 * so the app's db client binds to the throwaway TEST_DATABASE_URL, not prod. */

// Production Supabase project ref — hard-blocked, belt-and-suspenders.
const PROD_PROJECT_REF = 'fdkseckgfuvdczzqmnac';

/**
 * Validates TEST_DATABASE_URL, points the app at it, and supplies dummy non-DB
 * secrets so env validation passes without any production credentials. Returns
 * the resolved test URL. Exits (code 2) — without connecting anywhere — if the
 * target looks like production or isn't set.
 */
export function setupTestEnv(): string {
  const url = (process.env.TEST_DATABASE_URL ?? '').trim();
  const appUrl = (process.env.DATABASE_URL ?? '').trim();

  const refuse = (why: string): never => {
    console.error(`\n✖ integration harness refused to run: ${why}\n`);
    console.error('This suite seeds + truncates tables, so it only runs against a THROWAWAY Postgres:');
    console.error('  docker run -d --name pptest -e POSTGRES_PASSWORD=pw -p 5433:5432 postgres:16');
    console.error('  export TEST_DATABASE_URL="postgres://postgres:pw@localhost:5433/postgres"');
    console.error('  npm run test:client-portal-integration:setup   # apply the schema');
    console.error('  npm run test:client-portal-integration');
    process.exit(2);
  };

  if (!url) refuse('TEST_DATABASE_URL is not set');
  if (url.includes(PROD_PROJECT_REF)) refuse('TEST_DATABASE_URL points at the production project');
  if (appUrl && url === appUrl) refuse('TEST_DATABASE_URL is identical to the app DATABASE_URL');

  // Bind the db client to the test DB. dotenv (loaded inside src/lib/env) never
  // overrides an already-set var, so this wins. The Supabase secrets are only
  // needed to satisfy env validation — the read-models never call Supabase.
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL ||= 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
  process.env.SUPABASE_JWT_SECRET ||= 'test-jwt-secret-unused';

  return url;
}
