// CP-064 — every real-Postgres suite under scripts/integration/ runs in the hosted lane.
//
// The failure this guards: a per-card *.integration.ts is added with its package.json script,
// passes locally and in the Hermes audit against a throwaway Postgres, and never runs in CI
// because nobody added the workflow step (CP-063 at 5a39701). A runtime regression then passes
// the static source-pin guard in CI and is caught only on a workstation.
//
// The ratchet, executed against the real files:
//   1. every scripts/integration/*.integration.ts is the target of exactly one package.json
//      script (tsx scripts/integration/<file>);
//   2. every such script is invoked as `run: npm run <script>` in the client-portal-integration
//      job of .github/workflows/integration-tests.yml;
//   3. that job provides the throwaway database (a postgres service + TEST_DATABASE_URL) and
//      applies the schema (test:client-portal-integration:setup) BEFORE the first suite;
//   4. the CP-061 replacements suite stays the LAST suite: its fail-soft scenario drops the
//      replacement tables, so nothing that needs them may follow it;
//   5. any OTHER .ts under scripts/integration (today: the CP-061 cross-repo reason-parity test,
//      which needs a token and runs in its own workflow) has a package.json script that some
//      workflow under .github/workflows runs — nothing in that directory is dead.
// Then the same checks run against in-memory negative fixtures — an orphan suite file, a script
// with no step, setup after a suite, a suite after CP-061 — to prove each rule bites.
//
// This guard's script name deliberately avoids the substring "integration": run-guards.mjs
// denies it (those suites need a database), and a guard the runner never runs protects nothing.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const WORKFLOW = '.github/workflows/integration-tests.yml';
const JOB = 'client-portal-integration';
const SETUP_SCRIPT = 'test:client-portal-integration:setup';
const LAST_SUITE = 'test:client-portal-replacements-cp061:integration';
const HARNESS_FILES = new Set(['guard.ts', 'setup.ts']);

const read = (file) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n  ${error.message}`);
  }
}

/** The slice of the workflow that belongs to one job (from its key to the next job key or EOF). */
function jobBody(workflow, job) {
  const start = workflow.indexOf(`\n  ${job}:\n`);
  assert.ok(start >= 0, `job ${job} present in the workflow`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** The `npm run <script>` steps of a job body, in order. */
function runSteps(body) {
  return [...body.matchAll(/^\s+(?:- )?run: npm run (\S+)\s*$/gm)].map((m) => m[1]);
}

/**
 * The rules, as a pure function of the three inputs, so the negative fixtures below execute the
 * same code the real files do.
 */
function verify({ suiteFiles, scripts, workflow }) {
  const problems = [];
  const suiteScripts = new Map(); // file → script name
  for (const [name, command] of Object.entries(scripts)) {
    const m = /^tsx scripts\/integration\/([^\s]+\.integration\.ts)$/.exec(command);
    if (!m) continue;
    if (suiteScripts.has(m[1])) problems.push(`${m[1]} is targeted by two scripts (${suiteScripts.get(m[1])}, ${name})`);
    suiteScripts.set(m[1], name);
  }
  for (const file of suiteFiles) {
    if (!suiteScripts.has(file)) problems.push(`scripts/integration/${file} has no package.json script (tsx scripts/integration/${file})`);
  }
  const body = jobBody(workflow, JOB);
  const steps = runSteps(body);
  const stepSet = new Set(steps);
  for (const [file, name] of suiteScripts) {
    if (!stepSet.has(name)) problems.push(`${name} (scripts/integration/${file}) is not a "run: npm run" step of the ${JOB} job`);
  }
  if (!/^\s+services:\n\s+postgres:\n/m.test(body) || !/image: postgres:/.test(body)) problems.push('the job has no postgres service');
  if (!/^\s+TEST_DATABASE_URL: postgres:\/\//m.test(body)) problems.push('the job does not set TEST_DATABASE_URL');
  const setupAt = steps.indexOf(SETUP_SCRIPT);
  if (setupAt === -1) problems.push(`the job never runs ${SETUP_SCRIPT}`);
  const suiteSteps = steps.filter((s) => [...suiteScripts.values()].includes(s));
  const firstSuiteAt = steps.findIndex((s) => suiteSteps.includes(s));
  if (setupAt !== -1 && firstSuiteAt !== -1 && firstSuiteAt < setupAt) problems.push(`${steps[firstSuiteAt]} runs before the schema setup`);
  if (suiteSteps.length && suiteSteps[suiteSteps.length - 1] !== LAST_SUITE) problems.push(`${LAST_SUITE} must be the last suite (it drops the replacement tables); last is ${suiteSteps[suiteSteps.length - 1]}`);
  return { problems, suiteScripts, steps };
}

/** Rule 5: every non-suite .ts under scripts/integration is run by some workflow via its script. */
function verifyOthers({ otherFiles, scripts, workflows }) {
  const problems = [];
  const allRuns = workflows.map((w) => [...w.matchAll(/^\s+(?:- )?run: npm run (\S+)\s*$/gm)].map((m) => m[1])).flat();
  for (const file of otherFiles) {
    const entry = Object.entries(scripts).find(([, command]) => command.includes(`scripts/integration/${file}`));
    if (!entry) {
      problems.push(`scripts/integration/${file} has no package.json script`);
      continue;
    }
    if (!allRuns.includes(entry[0])) problems.push(`${entry[0]} (scripts/integration/${file}) is not run by any workflow`);
  }
  return problems;
}

// ── The real files ──────────────────────────────────────────────────────────
const allFiles = readdirSync(path.join(root, 'scripts/integration'))
  .filter((f) => f.endsWith('.ts') && !HARNESS_FILES.has(f))
  .sort();
const suiteFiles = allFiles.filter((f) => f.endsWith('.integration.ts'));
const otherFiles = allFiles.filter((f) => !f.endsWith('.integration.ts'));
const pkg = JSON.parse(read('package.json'));
const workflow = read(WORKFLOW);
const workflows = readdirSync(path.join(root, '.github/workflows'))
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => read(`.github/workflows/${f}`));
const real = verify({ suiteFiles, scripts: pkg.scripts, workflow });
const realOthers = verifyOthers({ otherFiles, scripts: pkg.scripts, workflows });

check('every scripts/integration suite file has exactly one package.json script', () => {
  const orphans = real.problems.filter((p) => p.includes('has no package.json script') || p.includes('two scripts'));
  assert.deepEqual(orphans, [], orphans.join('; '));
});
check('every other .ts under scripts/integration is run by some workflow through its script', () => {
  assert.deepEqual(realOthers, [], realOthers.join('; '));
  console.log(`  ${otherFiles.length} non-suite file(s): ${otherFiles.join(', ') || '(none)'}`);
});
check(`every suite script is a named "run: npm run" step of the ${JOB} job`, () => {
  const missing = real.problems.filter((p) => p.includes('is not a "run: npm run" step'));
  assert.deepEqual(missing, [], missing.join('; '));
  console.log(`  ${real.suiteScripts.size} suites wired: ${[...real.suiteScripts.values()].join(', ')}`);
});
check('the job provides a throwaway database and applies the schema before the first suite', () => {
  const infra = real.problems.filter((p) => /postgres service|TEST_DATABASE_URL|never runs|before the schema setup/.test(p));
  assert.deepEqual(infra, [], infra.join('; '));
});
check('the CP-061 replacements suite is the last suite in the job', () => {
  const order = real.problems.filter((p) => p.includes('must be the last suite'));
  assert.deepEqual(order, [], order.join('; '));
});
check('no other problem is reported for the real files', () => {
  assert.deepEqual(real.problems, [], real.problems.join('; '));
});
check('the CP-063 suite the card was raised for is wired', () => {
  assert.ok(real.steps.includes('test:client-portal-returns-cp063:integration'), 'cp063 step present');
});
check('this guard is itself a runnable test: script (name outside the run-guards deny list)', () => {
  assert.equal(pkg.scripts['test:client-portal-ci-db-suite-wiring'], 'node scripts/client-portal-ci-db-suite-wiring-guard.mjs');
  assert.doesNotMatch('test:client-portal-ci-db-suite-wiring', /integration/, 'name would be denied by run-guards');
});

// ── Negative fixtures: the same verify() must reject each break ─────────────
const stepOf = (name) => `      - name: ${name}\n        run: npm run ${name}\n`;
function fixtureWorkflow(order) {
  return [
    'name: integration-tests\n',
    'jobs:\n',
    `  ${JOB}:\n`,
    '    runs-on: ubuntu-latest\n',
    '    services:\n      postgres:\n        image: postgres:16\n',
    '    env:\n      TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/pptest\n',
    '    steps:\n      - uses: actions/checkout@v4\n',
    ...order.map(stepOf),
    '  other-job:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run test:something-else\n',
  ].join('');
}
const fixtureScripts = {
  [SETUP_SCRIPT]: 'tsx scripts/integration/setup.ts',
  'test:a:integration': 'tsx scripts/integration/a.integration.ts',
  'test:b:integration': 'tsx scripts/integration/b.integration.ts',
  [LAST_SUITE]: 'tsx scripts/integration/client-portal-replacements-cp061.integration.ts',
};
const fixtureFiles = ['a.integration.ts', 'b.integration.ts', 'client-portal-replacements-cp061.integration.ts'];
const goodOrder = [SETUP_SCRIPT, 'test:a:integration', 'test:b:integration', LAST_SUITE];

check('fixture: a correctly wired lane reports no problem', () => {
  const r = verify({ suiteFiles: fixtureFiles, scripts: fixtureScripts, workflow: fixtureWorkflow(goodOrder) });
  assert.deepEqual(r.problems, []);
});
check('fixture: a suite file with no script is rejected', () => {
  const r = verify({ suiteFiles: [...fixtureFiles, 'orphan.integration.ts'], scripts: fixtureScripts, workflow: fixtureWorkflow(goodOrder) });
  assert.ok(r.problems.some((p) => p.includes('orphan.integration.ts has no package.json script')), r.problems.join('; '));
});
check('fixture: a suite script with no workflow step is rejected (the CP-063 case)', () => {
  const r = verify({ suiteFiles: fixtureFiles, scripts: fixtureScripts, workflow: fixtureWorkflow([SETUP_SCRIPT, 'test:a:integration', LAST_SUITE]) });
  assert.ok(r.problems.some((p) => p.startsWith('test:b:integration (scripts/integration/b.integration.ts) is not a "run: npm run" step')), r.problems.join('; '));
});
check('fixture: a step in another job does not count', () => {
  const wf = fixtureWorkflow([SETUP_SCRIPT, 'test:a:integration', LAST_SUITE]).replace('npm run test:something-else', 'npm run test:b:integration');
  const r = verify({ suiteFiles: fixtureFiles, scripts: fixtureScripts, workflow: wf });
  assert.ok(r.problems.some((p) => p.includes('test:b:integration') && p.includes('is not a "run: npm run" step')), r.problems.join('; '));
});
check('fixture: schema setup after a suite is rejected', () => {
  const r = verify({ suiteFiles: fixtureFiles, scripts: fixtureScripts, workflow: fixtureWorkflow(['test:a:integration', SETUP_SCRIPT, 'test:b:integration', LAST_SUITE]) });
  assert.ok(r.problems.some((p) => p === 'test:a:integration runs before the schema setup'), r.problems.join('; '));
});
check('fixture: a suite after CP-061 is rejected', () => {
  const r = verify({ suiteFiles: fixtureFiles, scripts: fixtureScripts, workflow: fixtureWorkflow([SETUP_SCRIPT, 'test:a:integration', LAST_SUITE, 'test:b:integration']) });
  assert.ok(r.problems.some((p) => p.includes('must be the last suite')), r.problems.join('; '));
});
check('fixture: a non-suite file with no script, or a script no workflow runs, is rejected', () => {
  const scripts = { 'test:parity': 'tsx scripts/integration/parity.ts' };
  const runsIt = 'jobs:\n  parity:\n    steps:\n      - run: npm run test:parity\n';
  assert.deepEqual(verifyOthers({ otherFiles: ['parity.ts'], scripts, workflows: [runsIt] }), []);
  assert.deepEqual(verifyOthers({ otherFiles: ['parity.ts', 'dead.ts'], scripts, workflows: [runsIt] }), ['scripts/integration/dead.ts has no package.json script']);
  assert.deepEqual(verifyOthers({ otherFiles: ['parity.ts'], scripts, workflows: ['jobs:\n  x:\n    steps:\n      - run: npm run test:other\n'] }), ['test:parity (scripts/integration/parity.ts) is not run by any workflow']);
});
check('fixture: a job without the postgres service or TEST_DATABASE_URL is rejected', () => {
  const wf = fixtureWorkflow(goodOrder).replace('        image: postgres:16\n', '').replace(/      TEST_DATABASE_URL: .*\n/, '');
  const r = verify({ suiteFiles: fixtureFiles, scripts: fixtureScripts, workflow: wf });
  assert.ok(r.problems.includes('the job has no postgres service'), r.problems.join('; '));
  assert.ok(r.problems.includes('the job does not set TEST_DATABASE_URL'), r.problems.join('; '));
});

console.log(`\nCP-064 CI wiring guard: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
