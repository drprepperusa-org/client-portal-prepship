import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function check(name: string, condition: boolean): void {
  if (!condition) {
    throw new Error(`PS-379 guard failed: ${name}`);
  }
  console.log(`ok   ${name}`);
}

const route = read('src/routes/client-portal/billing.ts');
const autoGenerate = read('src/services/billing-auto-generate.ts');
const worker = read('src/worker.ts');
const billingPage = read('portal-client/src/pages/Billing.tsx');
const billingApi = read('portal-client/src/lib/api/domains/billing.ts');
const envSchema = read('src/lib/env.ts');
const main = read('src/main.ts');
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };

const generateRouteBlock = route.slice(
  route.indexOf("app.post('/billing/generate'"),
  route.indexOf("app.get('/markups'")
);

check(
  'client portal billing route no longer imports the independent generator',
  !/import\s+\{\s*generateLineItems\s*\}\s+from ['"]\.\.\/\.\.\/services\/billing['"]/.test(route)
);

check(
  'POST /billing/generate delegates to the canonical PrepShip API',
  /app\.post\('\/billing\/generate'/.test(generateRouteBlock) &&
    /env\.PREPSHIP_API_URL/.test(generateRouteBlock) &&
    /`\$\{baseUrl\}\/billing\/generate`/.test(generateRouteBlock) &&
    /method:\s*'POST'/.test(generateRouteBlock)
);

check(
  'POST /billing/generate cannot call a local generator or persist billing_last_generated',
  !/generateLineItems\(/.test(generateRouteBlock) &&
    !/BILLING_LAST_GENERATED_KEY/.test(generateRouteBlock) &&
    !/billing_last_generated/.test(generateRouteBlock)
);

check(
  'billing viewers can request generation and PrepShip rechecks the bearer token',
  /if \(!scope\.canViewFinancials\)/.test(generateRouteBlock) &&
    /const authorization = c\.req\.header\('authorization'\)/.test(generateRouteBlock) &&
    /headers:\s*\{[\s\S]*authorization/.test(generateRouteBlock)
);

check(
  'restricted portal callers cannot override the canonical tenant scope',
  /!scope\.isGlobal && body\.clientId !== undefined/.test(generateRouteBlock) &&
    /client_override_forbidden/.test(generateRouteBlock) &&
    /scope\.isGlobal && body\.clientId !== undefined/.test(generateRouteBlock)
);

check(
  'portal forwards canonical billing days and audits request, success, and failure',
  /dateFrom:\s*range\.fromDay/.test(generateRouteBlock) &&
    /dateTo:\s*range\.toDay/.test(generateRouteBlock) &&
    /portal\.billing\.generate\.requested/.test(generateRouteBlock) &&
    /portal\.billing\.generate\.failed/.test(generateRouteBlock) &&
    /portal\.billing\.generate['"]/.test(generateRouteBlock)
);

check(
  'Update Billing is visible to every user with financial visibility',
  /const canUpdateBilling = Boolean\(me\.data\?\.canViewFinancials\)/.test(billingPage) &&
    /\{canUpdateBilling && \([\s\S]*Update Billing/.test(billingPage)
);

check(
  'Billing has no separate manual Refresh control or refresh-only state',
  !/const \[refreshing, setRefreshing\]/.test(billingPage) &&
    !/async function refresh\(\)/.test(billingPage) &&
    !/>\s*Refresh\s*<\/Button>/.test(billingPage)
);

check(
  'Update Billing sends the selected days, waits for PrepShip, then refreshes portal reads',
  /portalApi\.generateBilling\(accessToken, draftFrom, draftTo\)/.test(billingPage) &&
    /await invalidateBilling\(\)/.test(billingPage) &&
    /120_000/.test(billingApi)
);

check(
  'canonical PrepShip API URL is an explicit validated environment setting',
  /PREPSHIP_API_URL:\s*z\.string\(\)\.url\(\)\.optional\(\)/.test(envSchema)
);

check(
  'production always mounts only Client Portal routes and defaults fail closed elsewhere',
  /CLIENT_PORTAL_ONLY_API:\s*booleanFlag\(true\)/.test(envSchema) &&
    /env\.NODE_ENV === 'production' \|\| env\.CLIENT_PORTAL_ONLY_API/.test(main) &&
    /if \(!clientPortalOnly\) \{[\s\S]*app\.route\('\/billing', billingRoute\)/.test(main)
);

check(
  'billing auto-generation helper is a no-op and cannot call generateLineItems',
  !/generateLineItems/.test(autoGenerate) &&
    /startBillingAutoGenerate\(\): void\s*\{[\s\S]*PrepShip Billing owns billing generation[\s\S]*return;[\s\S]*\}/.test(autoGenerate)
);

check(
  'worker still documents that portal automatic billing generation is parked',
  /PARKED: automatic billing generation/.test(worker) &&
    /startBillingAutoGenerate\(\);/.test(worker) &&
    /\/\/ startBillingAutoGenerate\(\);/.test(worker)
);

check(
  'package exposes PS-379 guard',
  packageJson.scripts?.['test:ps-379-disable-portal-billing-generation'] ===
    'tsx scripts/ps-379-disable-portal-billing-generation-guard.ts'
);

console.log('\nPASS PS-379 canonical portal billing delegation guard');
