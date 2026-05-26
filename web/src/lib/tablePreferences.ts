export const DEFAULT_TABLE_PAGE_SIZE = 50;
export const DEFAULT_TABLE_PAGE_SIZE_OPTIONS = [50, 100, 200] as const;
export const MIN_TABLE_COLUMN_WIDTH = 72;

export function reorderTableColumns<T extends string>(columns: T[], draggedKey: T, targetKey: T): T[] {
  if (draggedKey === targetKey) return columns;
  const from = columns.indexOf(draggedKey);
  const target = columns.indexOf(targetKey);
  if (from < 0 || target < 0) return columns;

  const next = [...columns];
  const [dragged] = next.splice(from, 1);
  if (dragged === undefined) return columns;
  const targetAfterRemoval = next.indexOf(targetKey);
  next.splice(targetAfterRemoval, 0, dragged);
  return next;
}

export function resizeTableColumn(currentWidth: number, delta: number, minimumWidth = MIN_TABLE_COLUMN_WIDTH): number {
  return Math.max(minimumWidth, Math.round(currentWidth + delta));
}
