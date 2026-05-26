import { existsSync, readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`client-portal architecture guard failed: ${message}`);
    process.exitCode = 1;
  }
}

const packageJson = JSON.parse(read('package.json'));
const main = read('src/main.ts');
const vercel = read('vercel.json');
const login = read('web/src/pages/Login.tsx');
const auth = read('web/src/lib/auth.tsx');

assert(existsSync('docs/client-portal-architecture.md'), 'docs/client-portal-architecture.md must exist');
assert(existsSync('src/lib/client-portal/scope.ts'), 'client portal scope resolver must exist');
assert(existsSync('src/lib/client-portal/dto.ts'), 'client portal DTO mapper must exist');
assert(existsSync('src/lib/client-portal/audit.ts'), 'client portal audit helper must exist');
assert(existsSync('src/routes/client-portal.ts'), 'client portal Hono route must exist');

assert(
  packageJson.scripts?.['guard:client-portal-architecture'] ===
    'node scripts/client-portal-architecture-guard.mjs',
  'package.json must expose guard:client-portal-architecture',
);
assert(
  packageJson.scripts?.['guard:client-portal-api'] ===
    'node scripts/client-portal-api-guard.mjs',
  'package.json must expose guard:client-portal-api',
);

assert(main.includes("'/api/client-portal'"), 'main.ts must protect /api/client-portal');
assert(main.includes("app.route('/api/client-portal'"), 'main.ts must mount /api/client-portal route');
assert(
  vercel.includes('"/api/client-portal/dashboard"') &&
    vercel.includes('prepshipv4-api-l5xc.onrender.com/dashboard/summary') &&
    vercel.includes('"/api/client-portal/orders/:path*"') &&
    vercel.includes('prepshipv4-api-l5xc.onrender.com/orders/:path*') &&
    vercel.includes('"/api/client-portal/integrations"') &&
    vercel.includes('prepshipv4-api-l5xc.onrender.com/carrier-accounts'),
  'vercel.json must map client portal routes to the currently deployed Render API routes',
);
assert(auth.includes('signUp') === false, 'frontend auth context must not expose public signUp');
assert(!/Create one|create account|sign up|signup/i.test(login), 'login page must not advertise public signup');
assert(/provisioned|provided|invited/i.test(login), 'login page must explain invite/provisioned access');

const doc = existsSync('docs/client-portal-architecture.md')
  ? read('docs/client-portal-architecture.md')
  : '';
for (const phrase of [
  '/api/client-portal',
  'invite-only',
  'clientIds',
  'storeIds',
  'safe DTO',
  'read-only foundation',
]) {
  assert(doc.includes(phrase), `architecture doc missing ${phrase}`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log('PASS client portal architecture guard');
