// The weekend-downtime watcher (Trello YKvYo22G) is a schedule around the
// existing production-watchdog script. These pins keep the schedule alive and
// correctly wired — the original outage cause was exactly this scheduler
// being disabled ("Render owns uptime now") with nothing replacing it.
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

const workflow = read('.github/workflows/render-watchdog.yml');
const packageJson = JSON.parse(read('package.json'));

assert(
  workflow.includes("- cron: '*/15 * * * 6,0'"),
  'watchdog runs every 15 minutes across the whole weekend (the reported outage window)',
);
assert(
  workflow.includes("- cron: '0 * * * 1-5'"),
  'watchdog keeps an hourly weekday safety net',
);
assert(
  workflow.includes('run: node scripts/production-watchdog.mjs'),
  'workflow schedules the canonical watchdog script (no duplicate checker authority)',
);
assert(
  workflow.includes("WATCHDOG_ALLOW_RESTARTS: 'true'") &&
    workflow.includes('RENDER_DEPLOY_HOOK_URL: ${{ secrets.RENDER_DEPLOY_HOOK_URL }}'),
  'restarts are enabled and the deploy hook comes from a repo secret, never from source',
);
assert(
  !/https:\/\/api\.render\.com\/deploy\//.test(workflow),
  'no literal deploy-hook URL is committed to the workflow',
);
assert(
  workflow.includes('client-portal-prepship.onrender.com') &&
    workflow.includes('client-portal-prepship.vercel.app'),
  'watchdog probes THIS repo services (portal API + portal shell), not the admin app',
);
assert(
  workflow.includes('actions/cache/restore@v4') && workflow.includes('actions/cache/save@v4'),
  'cooldown/rate-limit state persists across runs via the actions cache',
);
assert(
  fs.existsSync(path.join(root, 'scripts/production-watchdog.mjs')),
  'canonical watchdog script exists',
);
assert(
  packageJson.scripts?.['test:render-watchdog-workflow'] ===
    'node scripts/render-watchdog-workflow-guard.mjs',
  'package exposes test:render-watchdog-workflow',
);

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log('\nrender watchdog workflow guard passed.');
