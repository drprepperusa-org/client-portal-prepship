#!/usr/bin/env tsx
/**
 * PS-512 — apply drizzle/0051, which gives the billing summary read model columns for the
 * categories it was already totalling.
 *
 * DRY RUN BY DEFAULT. Applying requires both --apply and the exact confirmation token, matching
 * the convention every other migration script here follows. Nothing runs from CI.
 *
 * What it does: three additive `add column if not exists` on billing_summary_metrics, all
 * `numeric(14,2) not null default 0`. No existing column is altered, no row is rewritten or
 * deleted, and `grand_total` is untouched — it already summed every line type, which is why the
 * amount charged was never wrong even while these categories were invisible.
 *
 * Until this runs, the metrics path reports 0 for adjustment and replacement while grand_total
 * still includes them, so the printable invoice footer under-states those categories. The
 * per-row figures come from the canonical detail rows and are correct either way.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const CONFIRMATION = 'apply-ps-512-billing-summary-categories-0051';
const MIGRATION_PATH = 'drizzle/0051_billing_summary_replacement_adjustment.sql';
const EXPECTED_MIGRATION_SHA256 =
  '84aeb55553eaa94e108f42e395206fbfa664ae0b4704ad76c19ca0133f2ce6a6';

const NEW_COLUMNS = ['adjustment_total', 'replace_postage_total', 'replace_pick_pack_total'] as const;

type ColumnState = { column_name: string };

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const databaseHost = new URL(databaseUrl).host;

  const applyRequested = process.argv.includes('--apply');
  const confirmed = process.argv.includes(`--confirm=${CONFIRMATION}`);

  const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');
  const actualSha = createHash('sha256').update(migrationSql).digest('hex');
  if (actualSha !== EXPECTED_MIGRATION_SHA256) {
    throw new Error(
      `${MIGRATION_PATH} has changed since this script was written.\n`
      + `  expected ${EXPECTED_MIGRATION_SHA256}\n  actual   ${actualSha}\n`
      + 'Review the change and update EXPECTED_MIGRATION_SHA256 deliberately — the whole point of '
      + 'this check is that the SQL you review is the SQL that runs.',
    );
  }

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const before = await sql<ColumnState[]>`
      select column_name
      from information_schema.columns
      where table_name = 'billing_summary_metrics'
        and column_name = any(${sql.array([...NEW_COLUMNS])})
    `;
    const present = new Set(before.map((r) => r.column_name));

    console.log(`database host: ${databaseHost}`);
    console.log(`migration:     ${MIGRATION_PATH}`);
    console.log(`sha256:        ${actualSha}`);
    for (const column of NEW_COLUMNS) {
      console.log(`  ${column}: ${present.has(column) ? 'ALREADY PRESENT' : 'missing'}`);
    }

    if (present.size === NEW_COLUMNS.length) {
      console.log('\nAll three columns already exist. Nothing to do.');
      return;
    }

    if (!applyRequested || !confirmed) {
      console.log('\nDRY RUN. Nothing was changed.');
      console.log(`To apply:  npx tsx ${process.argv[1]} --apply --confirm=${CONFIRMATION}`);
      return;
    }

    await sql.unsafe(migrationSql);

    const after = await sql<ColumnState[]>`
      select column_name
      from information_schema.columns
      where table_name = 'billing_summary_metrics'
        and column_name = any(${sql.array([...NEW_COLUMNS])})
    `;
    const nowPresent = new Set(after.map((r) => r.column_name));
    const missing = NEW_COLUMNS.filter((c) => !nowPresent.has(c));
    if (missing.length > 0) {
      throw new Error(`applied, but these columns are still missing: ${missing.join(', ')}`);
    }
    console.log('\nApplied. All three columns present.');
    console.log('The next metrics refresh populates them; existing rows read 0 until then, which');
    console.log('is what they effectively reported before this migration.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
