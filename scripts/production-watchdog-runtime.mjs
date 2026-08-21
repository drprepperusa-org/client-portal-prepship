import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// Executable proof for the production watchdog's verdict logic.
//
// 2026-08-21 (Hermes re-audit of CP-057): /health/ready returned 503 for hours
// while the hourly watchdog reported "healthy", because it probed /health/ready
// and /health/deep concurrently and accepted the service as healthy when EITHER
// passed. /health/ready is the canonical readiness endpoint; a 503 there must
// never be hidden by a sibling probe, and the watchdog must not double the
// probe load on the constrained private health pool.
//
// This runs the real script as a child process against a local HTTP fixture.

const requests = [];
const fixture = http.createServer((req, res) => {
  requests.push(req.url);
  if (req.url === '/shell') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html></html>');
    return;
  }
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (req.url === '/health/ready') {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'degraded' }));
    return;
  }
  if (req.url === '/health/deep') {
    // The masking case: a sibling probe that happens to pass.
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ready' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${fixture.address().port}`;
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-runtime-'));

function runWatchdog() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/production-watchdog.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VERCEL_SHELL_URL: `${base}/shell`,
        RENDER_BASE_URL: base,
        WATCHDOG_STATE_FILE: path.join(stateDir, 'state.json'),
        WATCHDOG_ALERT_WEBHOOK_URL: '',
        WATCHDOG_ALLOW_RESTARTS: 'false',
        WATCHDOG_TIMEOUT_MS: '5000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

try {
  const result = await runWatchdog();

  assert.equal(
    result.code,
    1,
    `watchdog must exit unhealthy when /health/ready is 503 (exit ${result.code}; stdout=${result.stdout.slice(0, 300)})`,
  );
  console.log('ok: /health/ready 503 produces an unhealthy watchdog verdict');

  // stderr carries operator notices (e.g. "alert webhook not configured")
  // ahead of the JSON alert payload; the payload is the last JSON object.
  const payloadStart = result.stderr.indexOf('{');
  const payloadEnd = result.stderr.lastIndexOf('}');
  assert.ok(payloadStart !== -1 && payloadEnd > payloadStart, `stderr must carry the alert payload: ${result.stderr.slice(0, 300)}`);
  const payload = JSON.parse(result.stderr.slice(payloadStart, payloadEnd + 1));
  assert.equal(payload.status, 'unhealthy', 'alert payload reports unhealthy');
  assert.ok(
    payload.failingChecks.includes('Render /health/ready'),
    `failing checks must name /health/ready explicitly (got ${JSON.stringify(payload.failingChecks)})`,
  );
  console.log('ok: the failing check is named as /health/ready, not an either/or');

  assert.ok(requests.includes('/health/ready'), 'watchdog probes /health/ready');
  assert.ok(
    !requests.includes('/health/deep'),
    `watchdog must not issue a duplicate /health/deep probe against the private health pool (requests: ${requests.join(', ')})`,
  );
  console.log('ok: no duplicate /health/deep probe was issued');

  const readyProbes = requests.filter((url) => url === '/health/ready').length;
  assert.equal(readyProbes, 1, `exactly one /health/ready probe per run (got ${readyProbes})`);
  console.log('ok: exactly one readiness probe per run');

  console.log('\nproduction watchdog runtime fixtures passed.');
} finally {
  fixture.close();
  fs.rmSync(stateDir, { recursive: true, force: true });
}
