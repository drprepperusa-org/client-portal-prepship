// Frontend auth/session caching for the ACTIVE client portal (portal-client/).
// Repointed from the legacy web/ app when it was retired. The concern is the
// same one the legacy auth-session-cache helper solved: API calls must never
// hit supabase.auth.getSession() per request. In the active portal the
// AuthProvider owns the single bootstrap getSession() call, caches the access
// token in React state, keeps it fresh via onAuthStateChange, and every data
// hook passes that cached token into the API client as an argument.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const portalPackageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'portal-client/package.json'), 'utf8'),
);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${message}`);
}

// Every portal source file that calls supabase.auth.getSession — must be
// exactly the AuthProvider and nothing else.
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

// Match line-wrapped calls too (auth.tsx chains `supabase.auth\n.getSession()`).
const getSessionCallers = walk(path.join(root, 'portal-client/src'))
  .filter((filePath) => fs.readFileSync(filePath, 'utf8').includes('.getSession('))
  .map((filePath) => path.relative(root, filePath).replaceAll(path.sep, '/'));

assert(
  getSessionCallers.length === 1 && getSessionCallers[0] === 'portal-client/src/auth.tsx',
  `AuthProvider owns the only getSession call (found: ${getSessionCallers.join(', ') || 'none'})`,
);

const authSource = read('portal-client/src/auth.tsx');
assert(
  authSource.includes('accessToken: session?.access_token ?? null'),
  'AuthProvider caches the access token in React state',
);
assert(
  authSource.includes('supabase.auth.onAuthStateChange'),
  'cached token is invalidated/refreshed from auth state changes',
);

const hooksSource = read('portal-client/src/lib/hooks.ts');
assert(
  hooksSource.includes('const { accessToken } = useAuth();') &&
    hooksSource.includes('fn(accessToken as string)') &&
    hooksSource.includes('enabled: Boolean(accessToken)'),
  'data hooks pass the cached token into the API client and gate queries on it',
);

const apiSource = read('portal-client/src/lib/api.ts');
assert(
  !apiSource.includes('.getSession('),
  'API client never fetches the session itself — it receives the token as an argument',
);

assert(
  typeof portalPackageJson.dependencies?.['@supabase/supabase-js'] === 'string',
  'portal-client declares its Supabase JS dependency',
);
assert(
  packageJson.scripts?.['test:frontend-auth-cache'] ===
    'node scripts/frontend-auth-cache-guard.mjs',
  'package exposes frontend auth cache guard',
);

if (process.exitCode) {
  process.exit(process.exitCode);
}
