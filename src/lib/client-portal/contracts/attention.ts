/** Current scoped conditions, not historical notifications or unread messages. */
export interface PortalAttention {
  /** Complete count from the Inventory low/out filter, never the visible page size. */
  inventoryCount: number;
  /** Store connections matching the existing Connections attention filter. */
  connectionCount: number;
  totalCount: number;
  checkedAt: string;
}
