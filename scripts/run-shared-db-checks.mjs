import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
// Use the local Node 20 installation when available, or an explicit runtime.
const nvmNode = path.join(process.env.LOCALAPPDATA ?? '', 'nvm/v20.19.0/node.exe');
const node = process.env.SHARED_DB_NODE ?? (fs.existsSync(nvmNode) ? nvmNode : process.execPath);
const runtime = path.dirname(node);
const npm = process.env.SHARED_DB_NPM_CLI ?? path.join(runtime,
  process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (/^(SystemRoot|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PATHEXT|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|NUMBER_OF_PROCESSORS|OS|PROCESSOR_ARCHITECTURE)$/i.test(key)) env[key] = value;
}
Object.assign(env, {
  PATH: runtime + path.delimiter + (process.env.PATH ?? ''), NODE_ENV: 'test',
  DATABASE_URL: 'postgres://fixture:fixture@127.0.0.1:1/fixture',
  SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'offline',
  SUPABASE_SERVICE_ROLE_KEY: 'offline', SUPABASE_JWT_SECRET: 'offline',
  DOTENV_CONFIG_PATH: 'reports/shared-db/no-env',
});
if (process.env.SHARED_DB_TEST_ADMIN_URL) {
  const url = process.env.SHARED_DB_TEST_ADMIN_URL;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) throw Error('Native fixture database must be loopback');
  Object.assign(env, { RATE_PIPELINE_PG_ADMIN_URL: url, PS520_PG17_ADMIN_URL: url, SHARED_DB_TEST_ADMIN_URL: url });
}
const output = fs.existsSync('portal-client') ? 'reports/shared-db' : 'tmp/shared-db';
fs.mkdirSync(output, { recursive: true });
const results = [];
for (const command of process.argv.slice(2)) {
  const start = Date.now();
  const result = spawnSync(node, [npm, 'run', command], {
    env, encoding: 'utf8', timeout: 1200000, maxBuffer: 30000000,
  });
  const log = (result.stdout ?? '') + (result.stderr ?? '');
  fs.writeFileSync(path.join(output, command.replaceAll(':', '-') + '.log'), log);
  const record = { command, exit: result.status, ms: Date.now() - start };
  results.push(record); console.log(JSON.stringify(record));
  if (result.status !== 0) console.log(log.slice(-2200));
}
fs.writeFileSync(path.join(output, 'checks-' + Date.now() + '.json'), JSON.stringify(results, null, 2));
if (results.some(r => r.exit !== 0)) process.exitCode = 1;
