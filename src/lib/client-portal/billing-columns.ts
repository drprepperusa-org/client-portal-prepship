import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { settings } from '../../db/schema/settings';
import { clientPortalAuditLogs } from '../../db/schema/client-portal-audit-logs';
import { clientPortalCapabilities } from './capabilities';
import type { ClientPortalScope } from './scope';
import { BILLING_COLUMN_SECTIONS, type BillingColumnSelection, type BillingColumnUpdate } from './contracts/billing-columns';

const KEY = 'portal.billing.client_visible_columns.v1';
type Stored = BillingColumnSelection & { revision: string | null };
type Connection = Pick<typeof db, 'select' | 'insert' | 'execute'>;

export function canManageBillingColumns(scope: ClientPortalScope): boolean {
  return Boolean(scope.userId && scope.canViewFinancials && clientPortalCapabilities(scope).canManageAdmins);
}

export function defaultBillingColumns(): Stored {
  return {
    summary: BILLING_COLUMN_SECTIONS.summary.map(([key]) => key),
    lineItems: BILLING_COLUMN_SECTIONS.lineItems.map(([key]) => key),
    revision: null,
  };
}

export function parseBillingColumnUpdate(input: unknown): BillingColumnUpdate | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !['summary', 'lineItems', 'revision'].includes(key))) return null;
  if (!(value.revision === null || (typeof value.revision === 'string' && value.revision.length <= 64))) return null;
  for (const section of ['summary', 'lineItems'] as const) {
    const keys = value[section];
    const definitions = BILLING_COLUMN_SECTIONS[section];
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string' || !definitions.some(([id]) => id === key))) return null;
    if (new Set(keys).size !== keys.length) return null;
    if (definitions.some((definition) => definition[2] && !keys.includes(definition[0]))) return null;
  }
  return { summary: [...value.summary as string[]], lineItems: [...value.lineItems as string[]], revision: value.revision as string | null };
}

export async function readBillingColumns(conn: Connection = db): Promise<Stored> {
  const [row] = await conn.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY));
  if (!row) return defaultBillingColumns();
  const parsed = parseBillingColumnUpdate(JSON.parse(row.value ?? 'null'));
  if (!parsed) throw new Error('Invalid saved billing column settings');
  return parsed;
}

export class BillingColumnsConflict extends Error {}

export async function saveBillingColumns(scope: ClientPortalScope, input: unknown, database = db): Promise<Stored> {
  if (!canManageBillingColumns(scope)) throw new Error('Admin access required');
  const update = parseBillingColumnUpdate(input);
  if (!update) throw new Error('Invalid billing column settings');
  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(36422, 1)`);
    const before = await readBillingColumns(tx);
    if (before.revision !== update.revision) throw new BillingColumnsConflict('Settings changed. Reload before saving.');
    const saved = { ...update, revision: randomUUID() };
    await tx.insert(settings).values({ key: KEY, value: JSON.stringify(saved) })
      .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(saved) } });
    await tx.insert(clientPortalAuditLogs).values({
      event: 'portal.billing_columns.update', actorUserId: scope.userId,
      actorEmail: scope.email ?? null, clientIds: [], storeIds: [],
      metadata: { appliesTo: 'all_client_accounts', before, after: saved },
    });
    return saved;
  });
}
