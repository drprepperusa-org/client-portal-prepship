// Pins the client-portal fail-closed scope law (incident 2026-07-08):
// a portal caller with neither an explicit global grant nor explicit
// client/store scope gets 403 — an unstamped Supabase login must never fall
// through unrestricted. CRLF-tolerant: reads are normalized, checks are
// substrings only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scopeSrc = readFileSync('src/lib/client-portal/scope.ts', 'utf8').replace(/\r\n/g, '\n');

assert(
  scopeSrc.includes('if (!hasScope) {'),
  'assertClientPortalScope must deny ALL scopeless callers, not only client_user/read_only_support',
);
assert(
  scopeSrc.includes("c.json({ error: 'client portal scope required' }, 403)"),
  'scopeless portal callers must receive the 403 scope-required response',
);
assert(
  !scopeSrc.includes('needsExplicitScope &&'),
  'the fail-open role-conditional scope check must not return',
);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert(
  pkg.scripts?.['guard:portal-scope-fail-closed'] === 'node scripts/portal-scope-fail-closed-guard.mjs',
  'package.json must expose guard:portal-scope-fail-closed',
);
console.log('PASS portal scope fail-closed guard');
