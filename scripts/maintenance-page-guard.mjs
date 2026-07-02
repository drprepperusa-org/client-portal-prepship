import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
// The maintenance page ships with the ACTIVE portal (portal-client/), the
// app vercel.json actually deploys.
const publicMaintenancePath = path.join(root, 'portal-client/public/maintenance.html');
const rootMaintenancePath = path.join(root, 'maintenance.html');
const vercelPath = path.join(root, 'vercel.json');
const packagePath = path.join(root, 'package.json');

const maintenance = fs.existsSync(publicMaintenancePath)
  ? fs.readFileSync(publicMaintenancePath, 'utf8')
  : '';
const vercel = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${message}`);
  }
}

assert(
  pkg.scripts?.['test:maintenance-page'] === 'node scripts/maintenance-page-guard.mjs',
  'package.json exposes test:maintenance-page',
);

assert(
  fs.existsSync(publicMaintenancePath) && !fs.existsSync(rootMaintenancePath),
  'maintenance.html lives in portal-client/public so Vite copies it into portal-client/dist',
);

assert(
  vercel.outputDirectory === 'portal-client/dist',
  'Vercel deploys the Vite portal-client/dist output directory',
);

const rewrites = Array.isArray(vercel.rewrites) ? vercel.rewrites : [];
const maintenanceIdx = rewrites.findIndex(
  (rewrite) => rewrite.source === '/maintenance' && rewrite.destination === '/maintenance.html',
);
const spaCatchAllIdx = rewrites.findIndex((rewrite) => rewrite.destination === '/index.html');
assert(maintenanceIdx !== -1, 'Vercel exposes maintenance page at /maintenance');
assert(
  spaCatchAllIdx === -1 || (maintenanceIdx !== -1 && maintenanceIdx < spaCatchAllIdx),
  'maintenance rewrite must come before the SPA catch-all or it never matches',
);

assert(
  maintenance.includes('https://cdn.tailwindcss.com') &&
    maintenance.includes('We&apos;ll be back soon') &&
    maintenance.includes('RETURN_AT_ISO') &&
    maintenance.includes('<svg') &&
    maintenance.includes('min-h-screen'),
  'maintenance.html is a complete standalone Tailwind maintenance page',
);

if (process.exitCode) {
  process.exit(process.exitCode);
}
