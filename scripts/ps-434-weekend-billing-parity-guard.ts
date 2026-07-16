import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { billingLineEffectiveDaySql } from '../src/services/billing-effective-day.js';

const effectiveDay = billingLineEffectiveDaySql(
  sql`billing_effective_date`,
  sql`ship_date`,
);
const compiled = new PgDialect().sqlToQuery(sql`select ${effectiveDay}`);
assert.equal(compiled.sql, 'select coalesce(billing_effective_date, ship_date)');

const read = (path: string) => readFileSync(path, 'utf8');
const schema = read('src/db/schema/billing.ts');
const details = read('src/lib/client-portal/read-models/invoice-details.ts');
const summaries = read('src/services/billing-summaries.ts');
const metrics = read('src/services/reporting-metrics.ts');
const contract = read('src/lib/client-portal/contracts/billing.ts');
const columns = read('portal-client/src/components/billing/invoiceColumns.tsx');
const excel = read('portal-client/src/lib/invoiceExcel.ts');
const html = read('src/lib/client-portal/invoice-html.ts');
const billingRoute = read('src/routes/client-portal/billing.ts');

assert.match(schema, /billingEffectiveDate: timestamp\('billing_effective_date'/);
assert.match(schema, /billingPolicyVersion: text\('billing_policy_version'/);
assert.match(details, /billingLineEffectiveDaySql/);
assert.match(details, /min\(\$\{invoiceEffectiveDay\}\)/);
assert.doesNotMatch(details, /and b\.ship_date [<>]=? \$\{input\.date(?:From|To)\}/);
assert.doesNotMatch(summaries, /and b\.ship_date [<>]=? \$\{input\.date(?:From|To)\}/);
assert.match(metrics, /billingLineEffectiveDaySql/);
assert.match(contract, /billingEffectiveDate\?: string \| null/);
assert.match(contract, /actualActivityDate\?: string \| null/);
assert.match(contract, /rolledFromWeekend\?: boolean/);
assert.match(columns, /row\.rolledFromWeekend/);
assert.match(columns, /Billed \{shortDate\(row\.billingEffectiveDate\)\}/);
assert.doesNotMatch(columns, /getDay\(|getUTCDay\(|Saturday|Sunday/);
assert.match(excel, /Billing \/ Activity Date/);
assert.match(html, /Billing \/ Activity Date/);
assert.match(billingRoute, /upstream\.status === 409/);
assert.match(billingRoute, /BILLING_WEEKEND_OPERATION_BLOCKED/);

console.log('PS-434 Client Portal weekend billing parity guard passed');
