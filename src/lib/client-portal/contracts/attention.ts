import type { PortalNotificationPreferences } from './notification-preferences';

/** Current scoped conditions for enabled categories; muted counts are zero. */
export interface PortalAttention {
  /** Complete count from the Inventory low/out filter, never the visible page size. */
  inventoryCount: number;
  /** Store connections matching the existing Connections attention filter. */
  connectionCount: number;
  totalCount: number;
  checkedAt: string;
  preferences: PortalNotificationPreferences;
}
