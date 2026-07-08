// Pins the portal store-connect trust boundary (spec 2026-07-08):
//  - portal submissions stay source='portal', active=false
//  - non-admin clientId is forced from scope (resolveSubmittedClientId)
//  - shopify canonical domain is derived server-side at submit
//  - validate/reconnect are rate-limited and never echo credentials
// CRLF-tolerant: substring checks only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('src/routes/client-portal/integrations.ts', 'utf8').replace(/\r\n/g, '\n');
assert(route.includes("account.source = 'portal'"), 'portal submit must force source=portal');
assert(route.includes("'portal',\n        false"), 'portal submit must insert active=false');
assert(route.includes('resolveSubmittedClientId'), 'portal submit must force clientId from scope');
assert(route.includes('checkValidationRateLimit'), 'validate/reconnect must be rate-limited');
assert(route.includes('verified.myshopifyDomain'), 'shopify identifier must come from live verification');
assert(!route.includes('accessToken:'), 'route must never build a response containing a token');
assert(!route.includes('clientSecret:'), 'route must never build a response containing a client secret');
assert(route.includes('submittedFields'), 'audit rows record credential field NAMES only (submittedFields key survives the sanitizer)');
assert(!route.includes('admin required'), 'submit endpoint must be open to client users');
assert(route.includes('verified.myshopifyDomain !== row.accountIdentifier'), 'reconnect must pin the canonical domain');

const helpers = readFileSync('src/lib/client-portal/integration-submission.ts', 'utf8').replace(/\r\n/g, '\n');
assert(helpers.includes('clientIds.includes(args.bodyClientId)'), 'cross-client injection check must exist');
assert(helpers.includes('VALIDATION_MAX_ATTEMPTS = 5'), 'validation limiter is 5 attempts/window');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert(
  pkg.scripts?.['guard:portal-store-connect'] === 'node scripts/portal-store-connect-guard.mjs',
  'package.json must expose guard:portal-store-connect',
);
console.log('PASS portal store connect guard');
