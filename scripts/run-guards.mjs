// Runs the full STATIC guard suite (the `test:*` / `guard:*` scripts that only
// read source or exercise pure functions). New guards are picked up
// automatically, so they gate by default. Anything needing a browser, live
// network, real credentials, or a database is excluded here — those run in the
// integration workflow, the playwright e2e job, or manual smoke.
//
//   node scripts/run-guards.mjs          # run them, non-zero exit on any failure
//   node scripts/run-guards.mjs --list   # just print what would run
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const scripts = Object.keys(pkg.scripts ?? {});

// Resolve locally-installed bins (tsx, etc.) exactly as `npm run` does, so the
// raw command strings work both here and in CI.
const binDir = path.join(process.cwd(), 'node_modules', '.bin');
const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` };

// Needs a browser / live network / credentials / a database / a built bundle → runs
// elsewhere. `^test:guards` excludes THIS runner's own entries so it never recurses.
// `bundle-redaction` (CP-038) needs portal-client/dist → runs in test:full-site-certification.
const DENY = /(^test:guards|:browser|smoke|integration|web-bundle-budget|bundle-redaction|^test:status:|:live$|-live$|direct-carrier-labels|shipstation-label-url|marketplace-reconciliation|shipstation-awaiting-parity)/;

const guards = scripts
  .filter((s) => /^(test|guard):/.test(s))
  .filter((s) => !DENY.test(s))
  .sort();

if (process.argv.includes('--list')) {
  console.log(guards.join('\n'));
  console.log(`\n${guards.length} static guards`);
  process.exit(0);
}

console.log(`Running ${guards.length} static guards…\n`);
const failures = [];
for (const name of guards) {
  const res = spawnSync(pkg.scripts[name], { shell: true, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const ok = res.status === 0;
  process.stdout.write(`${ok ? '✓' : '✗'} ${name}\n`);
  if (!ok) failures.push({ name, out: `${res.stdout ?? ''}${res.stderr ?? ''}` });
}

if (failures.length) {
  console.error(`\n${failures.length}/${guards.length} guard(s) failed:\n`);
  for (const f of failures) {
    console.error(`──────── ${f.name} ────────`);
    console.error(f.out.split('\n').filter(Boolean).slice(-12).join('\n'));
    console.error('');
  }
  process.exit(1);
}
console.log(`\n✓ all ${guards.length} static guards passed.`);
