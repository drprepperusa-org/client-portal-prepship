/** Existing return-eligibility integration against its own local disposable DB. */
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const adminUrl = process.env.SHARED_DB_TEST_ADMIN_URL;
assert(adminUrl, 'SHARED_DB_TEST_ADMIN_URL is required');
const url = new URL(adminUrl);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'loopback only');
const name = `shared_db_portal_${randomUUID().replaceAll('-', '')}`;
const admin = postgres(adminUrl, { max: 1 });
let created = false;
try {
  await admin.unsafe(`create database ${name}`);
  created = true;
  url.pathname = '/' + name;
  for (const script of ['scripts/integration/setup.ts', 'scripts/integration/ps486-return-eligibility.integration.ts']) {
    const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', script], {
      env: { ...process.env, TEST_DATABASE_URL: url.href }, stdio: 'inherit', timeout: 120000,
    });
    assert.equal(result.status, 0, script);
  }
} finally {
  if (created) await admin.unsafe(`drop database ${name} with (force)`);
  await admin.end({ timeout: 5 });
}
