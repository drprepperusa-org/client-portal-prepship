import fs from 'node:fs';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

let failures = 0;

function check(name: string, condition: boolean) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${name}`);
  } else {
    console.log(`ok: ${name}`);
  }
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

const ownerPath = 'src/lib/client-portal/billing-day.ts';
check('canonical billing day owner exists', existsSync(ownerPath));

if (existsSync(ownerPath)) {
  const mod = await import(pathToFileURL(`${process.cwd()}/${ownerPath}`).href);
  const billingDayRange = mod.billingDayRange as (from: string, to: string) => null | {
    fromDay: string;
    toDay: string;
    fromUtc: string;
    toUtcExclusive: string;
  };
  const billingDayOf = mod.billingDayOf as (value: string | null | undefined) => string | null;

  assert.deepEqual(billingDayRange('2026-05-15', '2026-05-15'), {
    fromDay: '2026-05-15',
    toDay: '2026-05-15',
    fromUtc: '2026-05-15T00:00:00.000Z',
    toUtcExclusive: '2026-05-16T00:00:00.000Z',
  });
  assert.equal(billingDayRange('2026-02-28', '2026-02-28')?.toUtcExclusive, '2026-03-01T00:00:00.000Z');
  assert.equal(billingDayRange('2028-02-28', '2028-02-29')?.toUtcExclusive, '2028-03-01T00:00:00.000Z');
  assert.equal(billingDayOf('2026-04-30T23:59:59.999Z'), '2026-04-30');
  check('billingDayRange returns UTC-midnight exclusive upper bounds', true);
}

const apiScope = read('portal-client/src/lib/api/scope.ts');
const billingApi = read('portal-client/src/lib/api/domains/billing.ts');
check('billing API calls send selected days, not client-minted end-of-day instants',
  /function billingRangeParams/.test(apiScope) &&
    /dateFrom:\s*range\.from,\s*dateTo:\s*range\.to/.test(apiScope) &&
    !billingApi.includes('T23:59:59.999Z'));

const invoiceRoute = read('src/routes/client-portal/invoices.ts');
check('invoice routes normalize billing ranges before read-model calls',
  /import \{[^}]*billingDayRange[^}]*\} from '..\/..\/lib\/client-portal\/billing-day'/.test(invoiceRoute) &&
    /const range = requireBillingDayRange\(c/.test(invoiceRoute) &&
    /dateFrom: range\.fromUtc/.test(invoiceRoute) &&
    /dateTo: range\.toUtcExclusive/.test(invoiceRoute) &&
    /renderPortalInvoiceHtml\(\{ clientName: client\.name, dateFrom: range\.fromDay, dateTo: range\.toDay/.test(invoiceRoute));

const billingRoute = read('src/routes/client-portal/billing.ts');
check('billing reports use exclusive bounds while canonical generation forwards selected days',
  /import \{[^}]*billingDayRange[^}]*\} from '..\/..\/lib\/client-portal\/billing-day'/.test(billingRoute) &&
    /const range = requireBillingDayRange\(c/.test(billingRoute) &&
    /dateFrom: range\.fromUtc/.test(billingRoute) &&
    /dateTo: range\.toUtcExclusive/.test(billingRoute) &&
    /app\.post\('\/billing\/generate'/.test(billingRoute) &&
    /dateFrom: range\.fromDay/.test(billingRoute) &&
    /dateTo: range\.toDay/.test(billingRoute) &&
    /env\.PREPSHIP_API_URL/.test(billingRoute) &&
    !/generateLineItems\(/.test(billingRoute));

const invoiceReadModel = read('src/lib/client-portal/read-models/invoice-details.ts');
check('invoice read models use strict upper bound',
  !/b\.ship_date <= \$\{input\.dateTo\}/.test(invoiceReadModel) &&
    (invoiceReadModel.match(/\$\{invoiceEffectiveDay\} < \$\{input\.dateTo\}/g) ?? []).length >= 3 && // #1532: the order-grain count (one site) was retired
    /billingLineEffectiveDaySql/.test(invoiceReadModel));

const summaries = read('src/services/billing-summaries.ts');
check('billing summaries use strict upper bound',
  !/ship_date <= \$\{input\.dateTo\}/.test(summaries) &&
    !/lte\(persistedBillingEffectiveDay, to\)/.test(summaries) &&
    /lt\(persistedBillingEffectiveDay, to\)/.test(summaries) &&
    /coalesce\(billing_effective_date, ship_date\) < \$\{input\.dateTo\}/.test(summaries));

// CP-059A — the generation half of PS-382 moved to PrepShip.
//
// This block asserted that the PORTAL'S generator treated dateTo as EXCLUSIVE and
// dated storage lines inside the period. That generator is retired and
// src/services/billing.ts is deleted, so the assertions had no file to read.
//
// The rule is NOT dropped — it moved with the writer. PrepShip owns generation and
// pins its own exclusive-bound behaviour there. What remains the portal's concern is
// the READ path and the proxy, both already asserted above: billing-summaries.ts uses
// `< dateTo` half-open bounds, and the proxy forwards range.fromUtc/toUtcExclusive.
//
// What IS asserted here now is that the exclusive-bound contract survives on the type
// the read models still share, so a future reader cannot mistake dateTo for inclusive.
const readSupport = read('src/services/billing-read-support.ts');
check('the shared period type still documents dateTo as EXCLUSIVE',
  /dateTo: string; \/\/ ISO, UTC midnight, EXCLUSIVE/.test(readSupport) &&
    !/<= \$\{input\.dateTo\}::timestamptz/.test(readSupport));

check('the portal retains no local billing generator to date-range',
  !fs.existsSync('src/services/billing.ts'));

const packageJson = read('package.json');
check('package.json wires test:ps-382-billing-date-range',
  /"test:ps-382-billing-date-range":\s*"tsx scripts\/ps-382-billing-date-range-guard\.ts"/.test(packageJson));

if (failures > 0) {
  console.error(`\nPS-382 billing date-range guard FAILED with ${failures} failure(s).`);
  process.exit(1);
}

console.log('\nPS-382 billing date-range guard passed.');
