#!/usr/bin/env tsx
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const CONFIRMATION = 'apply-cp-057-return-label-voided-0049';
const migrationPath = 'drizzle/0049_return_label_purchase_intent_voided.sql';
const EXPECTED_MIGRATION_SHA256 =
  'e9f1ba7c472a4336bbdd217dcdeec722630d746195c79e0462149fc8254211bd';

type SchemaState = {
  database_name: string;
  generation_column: boolean;
  lease_token_column: boolean;
  lease_expires_column: boolean;
  resolution_note_column: boolean;
  return_unique_index: boolean;
  provider_ref_unique_index: boolean;
  state_index: boolean;
  state_lease_index: boolean;
  rls_enabled: boolean;
  state_constraint: string | null;
  row_count: string;
  row_fingerprint: string;
};

function stripSqlComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const databaseHost = new URL(databaseUrl).host;
  const applyRequested = process.argv.includes('--apply');
  const confirmationProvided = process.argv.includes(`--confirm=${CONFIRMATION}`);
  const databaseArgument = process.argv
    .find((argument) => argument.startsWith('--database='))
    ?.slice('--database='.length);
  const hostArgument = process.argv
    .find((argument) => argument.startsWith('--host='))
    ?.slice('--host='.length);
  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    connection: { application_name: 'cp-057-return-label-voided-0049' },
  });

  const inspect = async (database = client): Promise<SchemaState> => {
    const [exists] = await database<{ table_exists: boolean }[]>`
      select to_regclass('public.return_label_purchase_intents') is not null as table_exists
    `;
    if (!exists?.table_exists) {
      throw new Error('return_label_purchase_intents is missing; apply migration 0041 first');
    }

    const [state] = await database<SchemaState[]>`
      select
        current_database() as database_name,
        exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = 'return_label_purchase_intents'
            and column_name = 'generation'
        ) as generation_column,
        exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = 'return_label_purchase_intents'
            and column_name = 'lease_token'
        ) as lease_token_column,
        exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = 'return_label_purchase_intents'
            and column_name = 'lease_expires_at'
        ) as lease_expires_column,
        exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = 'return_label_purchase_intents'
            and column_name = 'resolution_note'
        ) as resolution_note_column,
        to_regclass('public.return_label_purchase_intents_return_idx') is not null
          as return_unique_index,
        to_regclass('public.return_label_purchase_intents_provider_ref_idx') is not null
          as provider_ref_unique_index,
        to_regclass('public.return_label_purchase_intents_state_idx') is not null
          as state_index,
        to_regclass('public.return_label_purchase_intents_state_lease_idx') is not null
          as state_lease_index,
        coalesce((
          select c.relrowsecurity
          from pg_class c
          where c.oid = 'public.return_label_purchase_intents'::regclass
        ), false) as rls_enabled,
        (
          select pg_get_constraintdef(c.oid)
          from pg_constraint c
          where c.conrelid = 'public.return_label_purchase_intents'::regclass
            and c.conname = 'return_label_purchase_intents_state_check'
        ) as state_constraint,
        (select count(*)::text from public.return_label_purchase_intents) as row_count,
        (
          select md5(coalesce(string_agg(to_jsonb(i)::text, E'\n' order by i.id), ''))
          from public.return_label_purchase_intents i
        ) as row_fingerprint
    `;
    if (!state) throw new Error('CP-057 schema inspection returned no row');
    return state;
  };

  const assertPrerequisites = (state: SchemaState): void => {
    if (
      !state.generation_column ||
      !state.lease_token_column ||
      !state.lease_expires_column ||
      !state.resolution_note_column ||
      !state.state_lease_index
    ) {
      throw new Error('Migration 0047 prerequisites are missing; run its guarded lane first');
    }
    if (
      !state.return_unique_index ||
      !state.provider_ref_unique_index ||
      !state.state_index
    ) {
      throw new Error('Migration 0041 indexes are missing; restore them before continuing');
    }
    if (!state.rls_enabled) {
      throw new Error('Purchase-intent RLS is disabled; restore migration 0045 before continuing');
    }
  };

  const assertPostconditions = (before: SchemaState, after: SchemaState): void => {
    if (!/\bvoided\b/i.test(after.state_constraint ?? '')) {
      throw new Error(`0049 constraint verification failed: ${after.state_constraint ?? 'missing'}`);
    }
    if (
      after.row_count !== before.row_count ||
      after.row_fingerprint !== before.row_fingerprint
    ) {
      throw new Error('0049 row-preservation verification failed');
    }
    assertPrerequisites(after);
  };

  try {
    const before = await inspect();
    console.log(`[cp-057-0049] current=${JSON.stringify(before)}`);
    assertPrerequisites(before);
    const migration = readFileSync(migrationPath, 'utf8');
    const migrationDigest = createHash('sha256')
      .update(migration.replace(/\r\n/g, '\n'))
      .digest('hex');
    if (migrationDigest !== EXPECTED_MIGRATION_SHA256) {
      throw new Error(`Migration refused: unexpected 0049 digest ${migrationDigest}`);
    }
    const executableSql = stripSqlComments(migration);
    if (
      /\b(?:alter\s+table|update|delete|truncate|insert)\s+(?:table\s+|from\s+|into\s+)?(?:public\.)?(?:orders|shipments)\b/i
        .test(executableSql)
    ) {
      throw new Error('Migration refused: orders/shipments mutation detected');
    }
    if (/\b(?:update|delete|truncate|insert)\b/i.test(executableSql)) {
      throw new Error('Migration refused: 0049 must not contain data mutations');
    }
    const withoutExpectedConstraintDrop = executableSql.replace(
      /ALTER\s+TABLE\s+public\.return_label_purchase_intents\s+DROP\s+CONSTRAINT\s+return_label_purchase_intents_state_check\s*;/i,
      '',
    );
    if (/\bdrop\s+(?:table|column|index|constraint)\b/i.test(withoutExpectedConstraintDrop)) {
      throw new Error('Migration refused: unexpected destructive DROP detected');
    }
    if (!applyRequested) {
      console.log(
        `[cp-057-0049] DRY RUN: pass --apply --confirm=${CONFIRMATION} ` +
          `--host=${databaseHost} --database=${before.database_name}`,
      );
      return;
    }
    if (
      !confirmationProvided ||
      hostArgument !== databaseHost ||
      databaseArgument !== before.database_name
    ) {
      throw new Error(
        `Apply refused: pass --confirm=${CONFIRMATION} ` +
          `--host=${databaseHost} --database=${before.database_name}`,
      );
    }
    if (/\bvoided\b/i.test(before.state_constraint ?? '')) {
      console.log('[cp-057-0049] already_applied=true');
      return;
    }

    let appliedState: SchemaState | null = null;
    await client.begin(async (tx) => {
      await tx`set local lock_timeout = '5s'`;
      await tx`set local statement_timeout = '30s'`;
      await tx`lock table public.return_label_purchase_intents in access exclusive mode`;
      const transactionClient = tx as unknown as typeof client;
      const lockedBefore = await inspect(transactionClient);
      assertPrerequisites(lockedBefore);
      if (lockedBefore.database_name !== databaseArgument) {
        throw new Error('0049 target database changed during the apply transaction');
      }
      if (/\bvoided\b/i.test(lockedBefore.state_constraint ?? '')) {
        appliedState = lockedBefore;
        return;
      }
      await tx.unsafe(migration);
      const lockedAfter = await inspect(transactionClient);
      assertPostconditions(lockedBefore, lockedAfter);
      appliedState = lockedAfter;
    });

    if (!appliedState) throw new Error('0049 transaction returned no verified schema state');
    console.log(`[cp-057-0049] applied=${JSON.stringify(appliedState)}`);
    console.log('[cp-057-0049] existing_rows_unchanged=true rls_index_preserved=true');
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error('[cp-057-0049] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
