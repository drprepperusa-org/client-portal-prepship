// CP #1193 — "fill rates should NOT be shown in client portal" guard.
//
// The best-rate "Fill Rates" / rate-backfill controls were removed from the
// customer portal. This pins that the Client Portal frontend has NO rate-backfill
// surface: no backfillRates / backfillStatus API client method and no BackfillJob
// type in the bundle, so nothing in the portal can trigger, poll, or display a
// rate backfill. The backend /api/client-portal/backfill route stays
// (admin/ops, server-side) — this guard is scoped to portal-client only.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) =>
  fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '';

let failed = false;
function assert(cond, msg) {
  if (cond) console.log(`PASS ${msg}`);
  else {
    console.error(`FAIL ${msg}`);
    failed = true;
  }
}

function walk(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = path.join(rel, ent.name);
    if (ent.isDirectory()) out.push(...walk(child));
    else if (ent.isFile() && /\.(ts|tsx)$/.test(ent.name)) out.push(child);
  }
  return out;
}

const files = walk('portal-client/src');
assert(files.length > 0, 'portal-client/src sources are present');
const src = files.map(read).join('\n');

// The rate-backfill client surface (the identifiers the removed "Fill Rates"
// controls used) must be entirely absent from the customer portal.
for (const token of ['backfillRates', 'backfillStatus', 'BackfillJob']) {
  assert(
    !new RegExp(`\\b${token}\\b`).test(src),
    `portal-client has no ${token} (rate-backfill client surface removed — CP #1193)`,
  );
}

// package.json wiring (also auto-discovered by scripts/run-guards.mjs).
const pkg = JSON.parse(read('package.json'));
assert(
  pkg.scripts?.['test:client-portal-no-fill-rates'] === 'node scripts/client-portal-no-fill-rates-guard.mjs',
  'package.json exposes test:client-portal-no-fill-rates',
);

if (failed) process.exit(1);
console.log('\nCP #1193 no-fill-rates guard passed.');
