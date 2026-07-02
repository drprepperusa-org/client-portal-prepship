// Sign-out correctness for the ACTIVE client portal (portal-client/).
// Repointed from the legacy web/ app when it was retired. What must hold:
// sign-out clears the Supabase session AND the React Query cache (so the
// next sign-in can never read the previous tenant's cached data), sign-in
// applies the returned session immediately, and signed-out visitors are
// structurally routed to /login by the auth wall.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const authPath = 'portal-client/src/auth.tsx';
const appPath = 'portal-client/src/App.tsx';
const authSource = fs.readFileSync(path.join(root, authPath), 'utf8');
const appSource = fs.readFileSync(path.join(root, appPath), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${message}`);
}

const signOutStart = authSource.indexOf('signOut: async () => {');
const signOutEnd = signOutStart === -1 ? -1 : authSource.indexOf('},', signOutStart);
const signOutBlock =
  signOutStart === -1 || signOutEnd === -1 ? '' : authSource.slice(signOutStart, signOutEnd);

assert(signOutBlock.length > 0, 'auth provider exposes signOut implementation');
assert(
  signOutBlock.includes('supabase.auth.signOut()'),
  'sign-out revokes the Supabase session',
);
assert(
  signOutBlock.includes('queryClient.clear()') && signOutBlock.includes('setSession(null)'),
  'sign-out wipes the React Query cache and local auth state (no cross-tenant leftovers)',
);
assert(
  authSource.includes('function syncCacheForUser') &&
    authSource.includes('queryClient.clear()') &&
    authSource.includes('cachedUserId'),
  'auth provider wipes cached query data whenever the signed-in identity changes',
);
assert(
  /if\s*\(data\.session\)\s*\{/.test(authSource) && authSource.includes('setSession(data.session)'),
  'sign-in applies the returned Supabase session immediately',
);
assert(
  authSource.includes('supabase.auth.onAuthStateChange'),
  'auth provider tracks Supabase auth state changes',
);
assert(
  appSource.includes('<Navigate to="/login" replace state={{ from: location.pathname }} />'),
  'auth wall routes signed-out visitors to /login (sign-out lands on login structurally)',
);
assert(
  packageJson.scripts?.['test:auth-logout'] === 'node scripts/auth-logout-guard.mjs',
  'package exposes auth logout guard',
);

if (process.exitCode) {
  process.exit(process.exitCode);
}
