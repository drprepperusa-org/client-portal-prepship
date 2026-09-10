/**
 * CP-070 — Client Portal acceptance gate. Runs every required proof, records machine-readable
 * results per AC, and exits nonzero unless all of them executed and passed. A DB-backed suite
 * without TEST_DATABASE_URL, or a cross-repo check without PREPSHIP_CONTRACT_TOKEN, is NOT_RUN,
 * and NOT_RUN fails the gate: a skip is never a pass.
 */
import { spawnSync, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const hasDb = Boolean(process.env.TEST_DATABASE_URL);
const hasToken = Boolean(process.env.PREPSHIP_CONTRACT_TOKEN);
const steps = [
  { id: 'typecheck', command: 'npm run -s typecheck', acs: ['AC-6'] },
  { id: 'build-web', command: 'npm run -s build:web', acs: ['AC-6'] },
  { id: 'billing-client-scope', command: 'npm run -s test:billing-client-scope', acs: ['AC-5'] },
  { id: 'contract-drift', command: 'npm run -s test:client-portal-contract-drift', acs: ['AC-5'] },
  { id: 'failure-states', command: 'npm run -s test:client-portal-failure-states', acs: ['AC-3'] },
  { id: 'ci-db-suite-wiring', command: 'npm run -s test:client-portal-ci-db-suite-wiring', acs: ['AC-6'] },
  { id: 'cp070-integration', command: 'npm run -s test:client-portal-billing-cp070:integration', acs: ['AC-3', 'AC-5'], needs: 'db' },
  { id: 'cp059-integration', command: 'npm run -s test:client-portal-billing-cp059:integration', acs: ['AC-6'], needs: 'db' },
  { id: 'cp070-browser', command: 'npm run -s test:cp-070:browser', acs: ['AC-1', 'AC-3', 'AC-4', 'AC-5'] },
  { id: 'cross-repo-parity', command: 'npm run -s test:cp-070:parity', acs: ['AC-5', 'AC-6'], needs: 'token' },
  { id: 'mutations', command: 'npm run -s test:cp-070:mutations', acs: ['AC-6'] },
];

const results = [];
for (const step of steps) {
  if ((step.needs === 'db' && !hasDb) || (step.needs === 'token' && !hasToken)) {
    const reason = step.needs === 'db'
      ? 'TEST_DATABASE_URL (throwaway Postgres) is not set'
      : 'PREPSHIP_CONTRACT_TOKEN is not set, so the upstream producer file cannot be checked';
    results.push({ ...step, status: 'NOT_RUN', reason });
    console.log(`NOT_RUN ${step.id}`);
    continue;
  }
  const started = Date.now();
  const run = spawnSync(step.command, { shell: true, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, windowsHide: true });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  process.stdout.write(output);
  results.push({
    ...step,
    status: run.status === 0 ? 'PASS' : 'FAIL',
    exit: run.status,
    durationMs: Date.now() - started,
    okLines: (output.match(/^ok\s/gm) ?? []).length,
    passedTests: Number(/(\d+) passed/.exec(output)?.[1] ?? 0),
    failedTests: Number(/(\d+) failed/.exec(output)?.[1] ?? 0),
  });
  console.log(`${run.status === 0 ? 'PASS' : 'FAIL'} ${step.id}`);
}

const acceptance = Object.fromEntries(['AC-1', 'AC-3', 'AC-4', 'AC-5', 'AC-6'].map((ac) => {
  const evidence = results.filter((r) => r.acs.includes(ac));
  return [ac, { status: evidence.every((r) => r.status === 'PASS') ? 'PASS' : 'FAIL', evidence: evidence.map((r) => `${r.id}:${r.status}`) }];
}));
acceptance['AC-2'] = { status: 'OUT_OF_REPO', evidence: ['prepship-v4 test:cp-070:acceptance (owner + PG17 coverage fixtures)'] };

const report = {
  task: 'CP-070',
  repo: 'client-portal-prepship',
  sha: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
  trackedChangesUncommitted: Boolean(execSync('git status --porcelain --untracked-files=no', { encoding: 'utf8' }).trim()),
  hasDb,
  commands: steps.map((s) => s.command),
  steps: results,
  acceptance,
  testCounts: Object.fromEntries(results.map((r) => [r.id, r.okLines || r.passedTests || 0])),
  result: results.every((r) => r.status === 'PASS') ? 'PASS' : 'FAIL',
};
const out = path.join('test-results', 'cp-070');
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'cp-acceptance.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.result === 'PASS' ? 0 : 1);
