import type { PortalNotificationPreferences } from './notification-preferences';

/** Current scoped conditions for enabled categories; muted counts are zero. */
export interface PortalAttention {
  /** Complete count from the Inventory low/out filter, never the visible page size. */
  inventoryCount: number;
  /** Store connections matching the existing Connections attention filter. */
  connectionCount: number;
  /** Complete enabled-category membership, scoped by the same canonical owners as the counts.
   * Opaque dismissal keys, not event timestamps; the UI must not parse or invent them. */
  inventoryIssueIds: string[];
  connectionIssueIds: string[];
  totalCount: number;
  checkedAt: string;
  preferences: PortalNotificationPreferences;
}
