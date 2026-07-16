import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const frontendDir = path.join(root, 'portal-client/src/lib/api/domains');
const routeDir = path.join(root, 'src/routes/client-portal');
const aggregator = readFileSync(path.join(root, 'src/routes/client-portal.ts'), 'utf8');
const main = readFileSync(path.join(root, 'src/main.ts'), 'utf8');

const frontendFiles = readdirSync(frontendDir)
  .filter((file) => file.endsWith('.ts'))
  .sort();
const routeFiles = readdirSync(routeDir)
  .filter((file) => file.endsWith('.ts'))
  .sort();

function listTypeScriptFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory()
      ? listTypeScriptFiles(path.join(dir, entry.name))
      : entry.name.endsWith('.ts') ? [path.join(dir, entry.name)] : [])
    .sort();
}

const routeSourceFiles = listTypeScriptFiles(routeDir);

const helperMethods = new Map([
  ['apiGet', 'GET'],
  ['apiPost', 'POST'],
  ['apiPut', 'PUT'],
  ['apiPatch', 'PATCH'],
  ['apiDelete', 'DELETE'],
  ['apiText', 'GET'],
  ['apiUpload', 'POST'],
  ['scopedList', 'GET'],
]);

function normalizePath(value) {
  return value
    .replace(/^\/api\/client-portal/, '')
    .replace(/\$\{[^}]+\}/g, ':param')
    .replace(/:\w+\{[^}]+\}/g, ':param')
    .replace(/:\w+/g, ':param')
    .replace(/\?.*$/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/';
}

function routeRegex(routePath) {
  const escaped = normalizePath(routePath)
    .split('/')
    .map((segment) => segment === ':param'
      ? '[^/]+'
      : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('/');
  return new RegExp(`^${escaped}/?$`);
}

function extractFrontendCalls() {
  const calls = [];
  const callPattern = /(apiGet|apiPost|apiPut|apiPatch|apiDelete|apiText|apiUpload|scopedList)(?:<[\s\S]*?>)?\s*\(\s*token,\s*(['"`])([\s\S]*?)\2/g;

  for (const file of frontendFiles) {
    const source = readFileSync(path.join(frontendDir, file), 'utf8');
    for (const match of source.matchAll(callPattern)) {
      const rawPath = match[3];
      if (!rawPath.startsWith('/api/client-portal/')) continue;
      calls.push({
        method: helperMethods.get(match[1]),
        path: normalizePath(rawPath),
        source: `portal-client/src/lib/api/domains/${file}`,
      });
    }
  }
  return calls;
}

function extractBackendRoutes() {
  const routes = [];
  const routePattern = /app\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g;

  for (const file of routeSourceFiles) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(routePattern)) {
      routes.push({
        method: match[1].toUpperCase(),
        path: normalizePath(match[3]),
        source: path.relative(root, file).replaceAll('\\', '/'),
      });
    }
  }
  return routes;
}

const importedRoutes = new Map(
  [...aggregator.matchAll(/import\s+(\w+)\s+from\s+'\.\/client-portal\/([^']+)'/g)]
    .map((match) => [match[2], match[1]]),
);

for (const file of routeFiles) {
  const domain = file.replace(/\.ts$/, '');
  const binding = importedRoutes.get(domain);
  assert.ok(binding, `active route aggregator imports ${domain}`);
  assert.match(aggregator, new RegExp(`app\\.route\\('\\/',\\s*${binding}\\)`), `active route aggregator mounts ${domain}`);
}

assert.match(main, /app\.route\('\/api\/client-portal',\s*clientPortalRoute\)/, 'main mounts the Client Portal aggregator');

const frontendCalls = extractFrontendCalls();
const backendRoutes = extractBackendRoutes();
const missing = frontendCalls.filter((call) => !backendRoutes.some((route) =>
  route.method === call.method && routeRegex(route.path).test(call.path)));

if (missing.length > 0) {
  for (const call of missing) {
    console.error(`MISSING ${call.method} ${call.path} from ${call.source}`);
  }
}

assert.ok(frontendCalls.length >= 30, 'active Client Portal API domains expose the expected endpoint set');
assert.ok(
  frontendCalls.some((call) => call.path === '/analysis/sku-orders'),
  'active Client Portal connectivity includes /analysis/sku-orders',
);
assert.equal(missing.length, 0, 'every active Client Portal API call has a matching Hono route');

console.log(`PASS active Client Portal backend connectivity (${frontendCalls.length} calls, ${backendRoutes.length} routes)`);
