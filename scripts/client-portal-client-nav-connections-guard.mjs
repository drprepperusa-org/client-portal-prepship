import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${message}`);
}

const nav = read('portal-client/src/nav.ts');
const app = read('portal-client/src/App.tsx');
const prefetch = read('portal-client/src/lib/routePrefetch.ts');
const rates = read('portal-client/src/pages/Rates.tsx');
const connections = read('portal-client/src/pages/Connections.tsx');
const packageJson = JSON.parse(read('package.json'));

assert(!/to:\s*['"]\/finance['"]/.test(nav), 'client portal NAV does not expose the Finance route');
assert(!/label:\s*['"]Finance['"]/.test(nav), 'client portal NAV does not show a Finance label');
assert(!/\bWallet\b/.test(nav), 'client portal NAV does not keep the unused Finance wallet icon import');
assert(!/path=\s*['"]\/finance['"]/.test(app), 'client portal routes do not expose /finance');
assert(!/pages\/Finance/.test(app), 'client portal App does not load the Finance page');
assert(!/['"]\/finance['"]/.test(prefetch), 'route prefetch does not warm a Finance route');
assert(!/Open Finance/.test(rates) && !/to=\s*['"]\/finance['"]/.test(rates), 'Rate Sheet does not link to Finance');

assert(
  /r\.type\s*!==\s*['"]carrier['"]/.test(connections),
  'Connections page excludes carrier integrations from the client-visible live card list',
);
assert(
  /isEmpty=\{visibleRows\.length\s*===\s*0\}/.test(connections),
  'Connections empty state is based on visible client rows, not hidden backend carrier rows',
);
assert(
  !/Sales channels\s*&\s*carriers linked/.test(connections),
  'Connections header does not tell clients that carrier connections are client-visible',
);

assert(
  packageJson.scripts?.['test:client-portal-client-nav-connections'] ===
    'node scripts/client-portal-client-nav-connections-guard.mjs',
  'package exposes test:client-portal-client-nav-connections',
);

if (process.exitCode) process.exit(process.exitCode);
console.log('\nclient portal nav/connections guard passed.');
