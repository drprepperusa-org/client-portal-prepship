import { db } from '../../db/client';
import { clientPortalAuditLogs } from '../../db/schema/client-portal-audit-logs';
import type { ClientPortalScope } from './scope';

const SENSITIVE_KEY_PATTERN =
  /password|token|secret|credential|authorization|cookie|apikey|api_key|ssapikey|ssapisecret|label|raw|payload/i;
const SENSITIVE_KEY_EXAMPLES = ['password', 'token', 'credentials'];

export function sanitizePortalAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizePortalAuditMetadata);
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = sanitizePortalAuditMetadata(nested);
    }
  }
  return out;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return { value };
  if (Array.isArray(value)) return { items: value };
  return value as Record<string, unknown>;
}

export async function recordPortalAudit(
  event: string,
  scope: Pick<ClientPortalScope, 'userId' | 'email' | 'clientIds' | 'storeIds'>,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const safeMetadata = metadataRecord(sanitizePortalAuditMetadata(metadata));
  try {
    await db.insert(clientPortalAuditLogs).values({
      event,
      actorUserId: scope.userId || null,
      actorEmail: scope.email ?? null,
      clientIds: scope.clientIds,
      storeIds: scope.storeIds,
      metadata: safeMetadata,
    });
  } catch (error) {
    console.warn('[client-portal:audit] persist failed', error);
  }

  console.info('[client-portal:audit]', {
    event,
    userId: scope.userId || null,
    email: scope.email ?? null,
    clientIds: scope.clientIds,
    storeIds: scope.storeIds,
    metadata: safeMetadata,
  });
}
