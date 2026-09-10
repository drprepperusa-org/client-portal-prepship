/**
 * CP-070 — Client Portal mutation matrix for the finalization verdict route, proxy and banner.
 *
 * Each mutation is applied in a disposable detached worktree at the COMMITTED sha, never in the
 * working tree. A control run with no mutation must pass first: a batch where every mutation
 * "dies" looks identical to a runner that never ran anything. Every `find` must match exactly
 * once or the run fails loudly — a stale mutation proves nothing. Patterns are single-line, so a
 * CRLF checkout applies them the same as LF. Port 5177 must be free before each browser run, or
 * Playwright's reuseExistingServer would test some other checkout's portal.
 */
import { spawnSync, execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = process.cwd();
const git = (args, cwd = repo) => execSync(`git ${args}`, { cwd, encoding: 'utf8' }).trim();
const sha = git('rev-parse HEAD');
if (git('status --porcelain --untracked-files=no')) {
  console.error('FAIL: tracked changes are uncommitted; mutations must run against the committed sha');
  process.exit(1);
}

const BANNER = 'portal-client/src/components/billing/BillingFinalizationBanner.tsx';
const PROXY = 'src/lib/client-portal/prepship-billing-finalization-proxy.ts';
const INVOICES = 'portal-client/src/pages/Invoices.tsx';
const HOOKS = 'portal-client/src/lib/hooks.ts';

const mutations = [
  { id: 'C1-stale-closed-retained', description: 'a cached closed verdict is presented as current while a refetch is pending',
    file: BANNER, find: "  if (input.isFetching && status !== 'open' && status !== 'mixed') return 'checking';", replace: '' },
  { id: 'C2-error-reuses-cached-verdict', description: 'a failed refresh keeps showing the previous verdict',
    file: BANNER, find: "  if (input.isError) return 'unavailable';", replace: '' },
  { id: 'C3-parser-accepts-extra-fields', description: 'the proxy passes fields beyond the frozen DTO',
    file: PROXY, find: "  if (Object.keys(record).sort().join(',') !== DTO_KEYS) return null;", replace: '' },
  { id: 'C4-denial-detail-leaked', description: 'an upstream denial message reaches the caller',
    file: PROXY, find: "    return { ok: false, status: upstream.status, code: 'forbidden', error: 'Not found' };",
    replace: "    return { ok: false, status: upstream.status, code: 'forbidden', error: String(((await upstream.json().catch(() => ({}))) as { error?: unknown }).error ?? 'Not found') };" },
  { id: 'C5-requested-before-denial-known', description: 'the verdict is requested before the billing denial can arrive',
    file: INVOICES, find: '    billingVisible && !summaryQuery.isPending,', replace: '    billingVisible,' },
  { id: 'C6-key-drops-client', description: 'the verdict cache key ignores the client filter',
    file: HOOKS, find: "    ['billing-finalization-coverage', from, to, clientId ?? 'scope', authGeneration],",
    replace: "    ['billing-finalization-coverage', from, to, authGeneration]," },
];

const suites = [
  { id: 'integration', command: 'npx tsx scripts/integration/client-portal-billing-cp070.integration.ts',
    env: { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://offline:offline@127.0.0.1:1/offline' } },
  { id: 'parity-local', command: 'npx tsx scripts/prepship-billing-finalization-parity.ts --allow-unarmed', env: { PREPSHIP_CONTRACT_TOKEN: '' } },
  { id: 'browser', command: 'npx playwright test web/e2e/client-portal-cp070-finalization.spec.js --workers=1 --reporter=line', browser: true },
];

const portFree = () => new Promise((resolve) => {
  const socket = createConnection({ host: '127.0.0.1', port: 5177 });
  socket.once('connect', () => { socket.destroy(); resolve(false); });
  socket.once('error', () => resolve(true));
});

const work = path.join(tmpdir(), `cp070-cp-mutations-${process.pid}`);
git(`worktree add --detach "${work}" ${sha}`);
symlinkSync(path.join(repo, 'node_modules'), path.join(work, 'node_modules'), 'junction');
symlinkSync(path.join(repo, 'portal-client', 'node_modules'), path.join(work, 'portal-client', 'node_modules'), 'junction');

async function runSuites() {
  const results = [];
  for (const suite of suites) {
    if (suite.browser && !(await portFree())) throw new Error('port 5177 is in use; refusing to let Playwright reuse another server');
    const run = spawnSync(suite.command, {
      cwd: work, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, ...(suite.env ?? {}) },
    });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    results.push({ suite: suite.id, status: run.status === 0 ? 'PASS' : 'FAIL', exit: run.status,
      evidence: (output.match(/^ok\s/gm) ?? []).length + (output.match(/^PASS /gm) ?? []).length + Number(/(\d+) passed/.exec(output)?.[1] ?? 0),
      tail: output.trim().split(/\r?\n/).slice(-2).join(' | ') });
  }
  return results;
}

const report = { task: 'CP-070', repo: 'client-portal-prepship', sha, control: null, mutations: [], result: 'FAIL' };
try {
  report.control = await runSuites();
  console.log(`control: ${JSON.stringify(report.control.map(({ suite, status, evidence }) => ({ suite, status, evidence })))}`);
  if (!report.control.every((r) => r.status === 'PASS' && r.evidence > 0)) {
    throw new Error('control run did not pass with evidence; the runner or the suites are broken, so no mutation result means anything');
  }
  for (const mutation of mutations) {
    const file = path.join(work, mutation.file);
    const source = readFileSync(file, 'utf8');
    const found = source.split(mutation.find).length - 1;
    if (found !== 1) throw new Error(`${mutation.id}: expected 1 match in ${mutation.file}, found ${found}. Fix the stale mutation.`);
    writeFileSync(file, source.replace(mutation.find, mutation.replace));
    const results = await runSuites();
    git('checkout -- .', work);
    const killedBy = results.filter((r) => r.status === 'FAIL').map((r) => r.suite);
    report.mutations.push({ id: mutation.id, description: mutation.description, status: killedBy.length ? 'KILLED' : 'SURVIVED', killedBy, results });
    console.log(`${killedBy.length ? 'KILLED  ' : 'SURVIVED'} ${mutation.id}${killedBy.length ? ` (killed by ${killedBy.join(', ')})` : ''}`);
  }
  report.result = report.mutations.every((m) => m.status === 'KILLED') ? 'PASS' : 'FAIL';
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  console.error(`FAIL ${report.error}`);
} finally {
  // Unlink the node_modules junctions BEFORE removing the worktree. A recursive delete that
  // followed a junction would empty the real checkout's node_modules.
  for (const link of [path.join(work, 'portal-client', 'node_modules'), path.join(work, 'node_modules')]) {
    try { unlinkSync(link); } catch { /* already gone */ }
  }
  try { git(`worktree remove --force "${work}"`); } catch { rmSync(work, { recursive: true, force: true }); }
}

const out = path.join(repo, 'test-results', 'cp-070');
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'cp-mutations.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.result} CP-070 portal mutation matrix: ${report.mutations.filter((m) => m.status === 'KILLED').length}/${mutations.length} killed`);
process.exit(report.result === 'PASS' ? 0 : 1);
