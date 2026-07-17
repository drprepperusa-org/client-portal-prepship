#!/usr/bin/env tsx
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const CONFIRMATION = 'apply-ps-423-return-label-fencing-0047';
const migrationPath = 'drizzle/0047_return_label_operation_fencing.sql';

type SchemaState = {
  generation_column: boolean;
  lease_token_column: boolean;
  lease_expires_column: boolean;
  resolution_note_column: boolean;
  state_lease_index: boolean;
};

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const approved = process.argv.includes('--apply') &&
    process.argv.includes(`--confirm=${CONFIRMATION}`);
  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    connection: { application_name: 'ps-423-cp-return-fencing-0047' },
  });

  const inspect = async (): Promise<SchemaState> => {
    const [state] = await client<SchemaState[]>`
      select
        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'return_label_purchase_intents' and column_name = 'generation') as generation_column,
        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'return_label_purchase_intents' and column_name = 'lease_token') as lease_token_column,
        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'return_label_purchase_intents' and column_name = 'lease_expires_at') as lease_expires_column,
        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'return_label_purchase_intents' and column_name = 'resolution_note') as resolution_note_column,
        to_regclass('public.return_label_purchase_intents_state_lease_idx') is not null as state_lease_index
    `;
    if (!state) throw new Error('PS-423 Client Portal schema inspection returned no row');
    return state;
  };

  try {
    const before = await inspect();
    console.log(`[ps-423-cp-migration] current=${JSON.stringify(before)}`);
    if (!approved) {
      console.log(`[ps-423-cp-migration] DRY RUN: pass --apply --confirm=${CONFIRMATION}`);
      return;
    }
    const migration = readFileSync(migrationPath, 'utf8');
    if (/\b(?:alter|update|delete|truncate|insert)\s+(?:table\s+|from\s+|into\s+)?(?:public\.)?(?:orders|shipments)\b/i.test(migration)) {
      throw new Error('Migration refused: orders/shipments mutation detected');
    }
    if (/\bdrop\s+(?:table|column|index)\b/i.test(migration)) {
      throw new Error('Migration refused: destructive DROP detected');
    }
    await client.begin(async (tx) => {
      await tx.unsafe(migration);
    });
    const after = await inspect();
    if (Object.values(after).some((present) => !present)) {
      throw new Error(`PS-423 Client Portal migration verification failed: ${JSON.stringify(after)}`);
    }
    console.log(`[ps-423-cp-migration] applied=${JSON.stringify(after)}`);
    console.log('[ps-423-cp-migration] orders_shipments_unchanged=true');
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error('[ps-423-cp-migration] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
