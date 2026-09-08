import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const fixture = mkdtempSync(join(tmpdir(), 'prepship-driver-patch-'));
const files = ['src/connection.js', 'cjs/src/connection.js', 'cf/src/connection.js'];
const before = `      return write(toBuffer(q))
        && !q.describeFirst
        && !q.cursorFn
        && sent.length < max_pipeline
        && (!q.options.onexecute || q.options.onexecute(connection))`;
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(manifest.dependencies.postgres, '3.4.9');
assert.equal(manifest.scripts.postinstall, 'node scripts/apply-postgres-transaction-compat.mjs');
try {
  mkdirSync(join(fixture, 'scripts'), { recursive: true });
  copyFileSync('scripts/apply-postgres-transaction-compat.mjs', join(fixture, 'scripts/apply-postgres-transaction-compat.mjs'));
  for (const file of files) {
    const path = join(fixture, 'node_modules/postgres', file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, before);
  }
  const pkg = join(fixture, 'node_modules/postgres/package.json');
  writeFileSync(pkg, JSON.stringify({ version: '3.4.9' }));
  const run = () => spawnSync(process.execPath, ['scripts/apply-postgres-transaction-compat.mjs'], { cwd: fixture, encoding: 'utf8' });
  assert.equal(run().status, 0);
  const read = () => files.map(file => readFileSync(join(fixture, 'node_modules/postgres', file), 'utf8'));
  const patched = read();
  for (const source of patched) {
    assert.ok(source.indexOf('q.options.onexecute(connection)') < source.indexOf('sent.length < max_pipeline'));
  }
  assert.equal(run().status, 0); assert.deepEqual(read(), patched, 'repeat install is idempotent');
  writeFileSync(pkg, JSON.stringify({ version: '3.4.10' }));
  assert.notEqual(run().status, 0); assert.deepEqual(read(), patched);
  writeFileSync(pkg, JSON.stringify({ version: '3.4.9' }));
  writeFileSync(join(fixture, 'node_modules/postgres', files[0]), before);
  writeFileSync(join(fixture, 'node_modules/postgres', files[2]), 'unexpected implementation');
  const drifted = read();
  assert.notEqual(run().status, 0); assert.deepEqual(read(), drifted, 'drift validation happens before any patch writes');
  console.log('PASS pinned driver install, three entry points, idempotence, version/source drift rejection');
} finally {
  // mkdtemp returned this exact directory; never follow a computed dependency path.
  rmSync(fixture, { recursive: true, force: true });
}
