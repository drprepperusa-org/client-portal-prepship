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
  'POST /billing/generate remains present but returns a PrepShip Billing SOT conflict',
  /app\.post\('\/billing\/generate'/.test(generateRouteBlock) &&
    /prep_ship_billing_sot/.test(generateRouteBlock) &&
    /PrepShip Billing owns billing generation/.test(generateRouteBlock) &&
    /,\s*409\s*\)/.test(generateRouteBlock)
);

check(
  'POST /billing/generate cannot call generateLineItems or persist billing_last_generated',
  !/generateLineItems\(/.test(generateRouteBlock) &&
    !/BILLING_LAST_GENERATED_KEY/.test(generateRouteBlock) &&
    !/billing_last_generated/.test(generateRouteBlock)
);

check(
  'blocked generate attempts are audit-visible without writing billing rows',
  /portal\.billing\.generate\.blocked/.test(generateRouteBlock) &&
    !/portal\.billing\.generate['"]/.test(generateRouteBlock.replace(/portal\.billing\.generate\.blocked/g, ''))
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

console.log('\nPASS PS-379 disable portal billing generation guard');
