import { spawnSync } from 'node:child_process';

const scripts = [
  'typecheck',
  'audit:client-portal-maintainability',
  'guard:source-line-length',
  'test:web-bundle-budget',
  'guard:client-portal-architecture',
  'test:client-portal-shadow-renderer',
  'test:client-portal-bundle-redaction',
  'guard:site-actions',
  'test:api-contracts',
  'test:shipstation-label-url',
  'test:print-queue-invalid-label',
  'test:portal-smoke',
  'test:client-portal-ui',
  'test:client-portal-failure-states',
];

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is unavailable; run certification through npm');

for (const script of scripts) {
  console.log(`\n[certification] npm run ${script}`);
  const result = spawnSync(process.execPath, [npmCli, 'run', script], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('\nFull-site certification passed.');
