import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const healthSource = readFileSync('src/routes/health.ts', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

function routeBody(routePath) {
  const marker = `app.get('${routePath}'`;
  const start = healthSource.indexOf(marker);
  assert.notEqual(start, -1, `health route defines ${routePath}`);
  const next = healthSource.indexOf('\napp.get(', start + marker.length);
  return healthSource.slice(start, next === -1 ? undefined : next);
}

const lightHealth = routeBody('/');
const readyHealth = routeBody('/ready');
const deepHealth = routeBody('/deep');

assert.equal(
  packageJson.scripts?.['test:health-deep-readiness'],
  'node scripts/health-deep-readiness-guard.mjs',
  'package exposes health deep-readiness guard'
);

assert(
  !lightHealth.includes('checkDbHealth') &&
    !lightHealth.includes('checkDeepReadiness') &&
    !lightHealth.includes('healthSql'),
  '/health remains lightweight and does not perform DB/deep dependency checks'
);

for (const body of [readyHealth, deepHealth]) {
  assert(
    body.includes('checkDeepReadiness'),
    'readiness endpoints use the shared deep readiness checker'
  );
}

for (const expected of [
  "checkComponent('db'",
  "checkComponent('orders'",
  "checkComponent('printQueue'",
  "checkComponent('eventLoop'",
  "checkComponent('requestPool'",
]) {
  assert(healthSource.includes(expected), `deep readiness reports ${expected}`);
}

// 2026-08-12: readiness reported "ready" with 22ms latency through a total
// outage. Every check ran on healthSql — a pool private to this route — while
// the pool that actually serves requests was fully starved, so the watchdog
// stayed green while the portal served nothing. Readiness MUST exercise the
// same pool the request path uses, or it only proves Postgres is reachable.
assert(
  /import\s*\{[^}]*\bsql\b[^}]*\}\s*from\s*'\.\.\/db\/client'/.test(healthSource),
  'deep readiness must probe the shared request pool, not only its private health pool',
);

const poolCheckStart = healthSource.indexOf("checkComponent('requestPool'");
const poolCheckBody = healthSource.slice(poolCheckStart, poolCheckStart + 400);
assert(
  poolCheckBody.includes('sql`') && !poolCheckBody.includes('healthSql`'),
  'the requestPool component must run its probe through the shared pool, not healthSql',
);
assert(
  poolCheckBody.includes('withTimeout'),
  'the requestPool probe must be bounded, so a starved pool fails instead of hanging readiness',
);

assert(healthSource.includes('select 1'), 'deep readiness verifies DB select 1');
assert(
  /from\s+orders/i.test(healthSource),
  'deep readiness verifies minimal orders dependency'
);
assert(
  /from\s+print_queue_orders/i.test(healthSource),
  'deep readiness verifies print queue summary dependency'
);
assert(
  healthSource.includes('queuedCount') && healthSource.includes('totalCount'),
  'print queue readiness returns sanitized queue counts only'
);
assert(
  healthSource.includes('Promise.race') && healthSource.includes('timeoutMs'),
  'deep readiness checks run under explicit timeouts'
);
assert(
  healthSource.includes('503'),
  'deep readiness returns HTTP 503 when any required component fails'
);
assert(
  !readyHealth.includes('error:') &&
    !readyHealth.includes('warning:') &&
    !deepHealth.includes('error:') &&
    !deepHealth.includes('warning:'),
  'readiness responses do not expose raw errors'
);

console.log('PASS health deep-readiness guard');
