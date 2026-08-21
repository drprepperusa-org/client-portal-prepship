import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const watchdogPath = 'scripts/production-watchdog.mjs';
const operationalRunbookPath = 'OPERATIONAL_RUNBOOKS_AND_DR_PLAN.md';
const observabilityPlanPath = 'OBSERVABILITY_ALERTING_PLAN.md';
const healthRoutePath = 'src/routes/health.ts';

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const operationalRunbook = fs.readFileSync(path.join(root, operationalRunbookPath), 'utf8');
const observabilityPlan = fs.readFileSync(path.join(root, observabilityPlanPath), 'utf8');
const watchdog = fs.existsSync(path.join(root, watchdogPath))
  ? fs.readFileSync(path.join(root, watchdogPath), 'utf8')
  : '';
const healthRoute = fs.existsSync(path.join(root, healthRoutePath))
  ? fs.readFileSync(path.join(root, healthRoutePath), 'utf8')
  : '';

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${message}`);
}

assert(watchdog.length > 0, `${watchdogPath} exists`);
assert(healthRoute.length > 0, `${healthRoutePath} exists`);

const requiredWatchdogTokens = [
  'VERCEL_SHELL_URL',
  'RENDER_BASE_URL',
  '/health',
  '/health/ready',
  'WATCHDOG_ALERT_WEBHOOK_URL',
  'WATCHDOG_FAILURE_THRESHOLD',
  'WATCHDOG_RESTART_COOLDOWN_MS',
  'WATCHDOG_MAX_RESTARTS_PER_HOUR',
  'WATCHDOG_STATE_FILE',
  'RENDER_DEPLOY_HOOK_URL',
  'RENDER_API_KEY',
  'RENDER_SERVICE_ID',
  'alert-only',
  'consecutiveFailures',
  'cooldown',
  'maxRestartsPerHour',
  'redact',
];

for (const token of requiredWatchdogTokens) {
  assert(watchdog.includes(token), `${watchdogPath} includes ${token}`);
}

assert(
  watchdog.includes('WATCHDOG_ALLOW_RESTARTS') || watchdog.includes('WATCHDOG_RESTART_MODE'),
  `${watchdogPath} requires an explicit restart/redeploy env gate`
);

assert(
  /const DEFAULT_TIMEOUT_MS = 15_000/.test(watchdog),
  `${watchdogPath} default timeout must exceed the 12s deep-health component timeout`
);

assert(
  /max:\s*[3-9]/.test(healthRoute),
  `${healthRoutePath} health SQL pool must allow concurrent db/orders/printQueue checks`
);

// 2026-08-21: /health/ready returned 503 for hours while the watchdog reported
// healthy, because it raced /health/ready against /health/deep and accepted
// either passing. /health/ready is the canonical verdict; it is probed once and
// a 503 is unhealthy on its own. The executable proof lives in
// scripts/production-watchdog-runtime.mjs; these pin the source shape.
assert(
  !/checkHttp\([^)]*\/health\/deep/.test(watchdog),
  `${watchdogPath} must not probe /health/deep (duplicate load on the private health pool)`
);
assert(
  !/detailChecks|\.some\(\s*\(?\s*check|or \/health\/deep/.test(watchdog),
  `${watchdogPath} must not accept an either/or readiness verdict`
);
assert(
  /checkHttp\(\s*'Render \/health\/ready'/.test(watchdog),
  `${watchdogPath} probes /health/ready as a named check`
);
assert(
  /const failures = checks\.filter\(\(check\) => !check\.ok\)/.test(watchdog),
  `${watchdogPath} treats every failed check, including /health/ready, as unhealthy`
);
assert(
  packageJson.scripts?.['test:production-watchdog-runtime'] === 'node scripts/production-watchdog-runtime.mjs',
  'package exposes the executable watchdog verdict fixture'
);

// The health pool must be evictable: a probe that times out leaves a connection
// postgres.js would otherwise keep busy forever and pipeline later probes onto.
assert(
  /let healthSql = createHealthPool\(\)/.test(healthRoute) && /function resetHealthPool\(/.test(healthRoute),
  `${healthRoutePath} health pool is replaceable and reset on probe timeout`
);
assert(
  /retired\.end\(\{ timeout: 0 \}\)/.test(healthRoute),
  `${healthRoutePath} resetHealthPool destroys the retired pool's connections`
);
assert(
  packageJson.scripts?.['test:health-wedged-pool'] === 'tsx scripts/health-wedged-pool-runtime.ts',
  'package exposes the wedged-pool readiness fixture'
);

assert(
  watchdog.includes('process.env') && !watchdog.includes('console.log(process.env'),
  `${watchdogPath} does not dump process.env`
);

assert(
  packageJson.scripts?.['watchdog:production'] === 'node scripts/production-watchdog.mjs',
  'package exposes production watchdog runner'
);

assert(
  packageJson.scripts?.['test:production-watchdog'] === 'node scripts/production-watchdog-guard.mjs',
  'package exposes production watchdog guard'
);

const requiredDocTokens = [
  'Production Watchdog',
  'Render dashboard restart',
  'deploy hook',
  'Render API',
  'alert-only',
  'consecutive failure',
  'cooldown',
  'max restarts per hour',
  'manual fallback',
  'no secrets',
];

for (const token of requiredDocTokens) {
  assert(
    operationalRunbook.toLowerCase().includes(token.toLowerCase()) ||
      observabilityPlan.toLowerCase().includes(token.toLowerCase()),
    `docs cover ${token}`
  );
}
