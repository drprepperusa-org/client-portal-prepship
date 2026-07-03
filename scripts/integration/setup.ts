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
process.exit(result.status ?? 1);
