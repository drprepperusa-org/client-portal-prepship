/* Applies the Drizzle schema to the throwaway TEST_DATABASE_URL via
 * `drizzle-kit push`. Guarded by setupTestEnv() so it can never push to
 * production. Run once before the integration suite (and in CI). */
import { spawnSync } from 'node:child_process';
import { setupTestEnv } from './guard';

const url = setupTestEnv(); // validates + binds DATABASE_URL to the test DB
console.log(`Applying schema to ${url.replace(/:[^:@/]+@/, ':****@')} …`);

// drizzle-kit reads process.env.DATABASE_URL (set above) via drizzle.config.ts.
const result = spawnSync('npx drizzle-kit push --force', {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});
if (result.status !== 0) process.exit(result.status ?? 1);

// Credential-account tables intentionally live outside the Drizzle schema.
// Apply their idempotent migrations here so every integration suite sees the
// same complete throwaway schema, regardless of test execution order.
const { sql } = await import('../../src/db/client');
for (const file of [
  'drizzle/0027_credential_accounts_source_of_truth.sql',
  'drizzle/0037_store_account_sync_state.sql',
]) {
  await sql.file(file);
}
await sql.end({ timeout: 5 });
