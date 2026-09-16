import { supabaseAdmin } from '../supabase';
import type { PortalNotificationPreferences } from './contracts/notification-preferences';

const KEY = 'portal_notification_preferences';
const defaults: PortalNotificationPreferences = { connectionIssues: true, lowStock: true };

export function parseNotificationPreferences(input: unknown): PortalNotificationPreferences | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  if (Object.keys(row).length !== 2 || typeof row.connectionIssues !== 'boolean' || typeof row.lowStock !== 'boolean') return null;
  return { connectionIssues: row.connectionIssues, lowStock: row.lowStock };
}

function fromMetadata(metadata: Record<string, unknown> | undefined): PortalNotificationPreferences {
  const stored = metadata?.[KEY];
  // Accounts predating this feature start with both categories on. No browser migration.
  if (stored == null) return { ...defaults };
  const parsed = parseNotificationPreferences(stored);
  if (!parsed) throw new Error('Invalid saved notification preferences');
  return parsed;
}

export async function readNotificationPreferences(userId: string): Promise<PortalNotificationPreferences> {
  if (!userId) throw new Error('Authenticated user required');
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data.user || data.user.id !== userId) throw new Error('Notification preferences unavailable');
  return fromMetadata(data.user.user_metadata);
}

export async function saveNotificationPreferences(userId: string, preferences: PortalNotificationPreferences) {
  if (!userId) throw new Error('Authenticated user required');
  // Supabase merges this top-level user_metadata key. Never send app_metadata,
  // profile fields, or caller-provided user IDs; concurrent profile edits are preserved.
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    user_metadata: { [KEY]: preferences },
  });
  if (error || !data.user || data.user.id !== userId) throw new Error('Notification preferences could not be saved');
  const saved = parseNotificationPreferences(data.user.user_metadata?.[KEY]);
  if (!saved || saved.connectionIssues !== preferences.connectionIssues || saved.lowStock !== preferences.lowStock) {
    throw new Error('Notification preference save was not confirmed');
  }
  return saved;
}
