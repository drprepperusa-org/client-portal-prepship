import { useMemo, useState } from 'react';
import { useColumnLayout } from '@/lib/useColumnLayout';
import { DataTableDesktop } from './data-table/DataTableDesktop';
import { DataTableMobile } from './data-table/DataTableMobile';
import type { Column, DataTableProps, SortState } from './data-table/types';

export type { Column } from './data-table/types';

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  onRowClick,
  rowActionLabel,
  empty,
  tableId,
  footer,
  defaultSort = null,
  sort: controlledSort,
  onSortChange,
  allowColumnCustomization = false,
  stickyHeader = false,
  maxBodyHeight = 'calc(100vh - 15rem)',
}: DataTableProps<T>) {
  // Structural layout remains an explicit admin/global opt-in. Without it,
  // persisted order/visibility is ignored and resizing stays session-only.
  const customizable = Boolean(tableId) && allowColumnCustomization;
  const layout = useColumnLayout(customizable ? tableId : undefined, columns);
  const byKey = Object.fromEntries(
    columns.map((column) => [column.key, column]),
  ) as Record<string, Column<T>>;
  const ordered = layout.visibleOrder
    .map((key) => byKey[key])
    .filter(Boolean) as Column<T>[];

  // Controlled mode delegates whole-dataset sorting to the server. Local mode
  // sorts only the supplied rows and retains the existing three-state cycle.
  const controlled = onSortChange != null;
  const [internalSort, setInternalSort] = useState<SortState>(defaultSort);
  const sort = controlled ? controlledSort ?? null : internalSort;
  function toggleSort(column: Column<T>) {
    if (!column.sortAccessor) return;
    let next: SortState;
    if (!sort || sort.key !== column.key) next = { key: column.key, dir: 'asc' };
    else if (sort.dir === 'asc') next = { key: column.key, dir: 'desc' };
    else next = controlled ? { key: column.key, dir: 'asc' } : null;
    if (controlled) onSortChange(next);
    else setInternalSort(next);
  }
  const sortedRows = useMemo(() => {
    if (controlled || !sort) return rows;
    const accessor = columns.find((column) => column.key === sort.key)?.sortAccessor;
    if (!accessor) return rows;
    const direction = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((left, right) => {
      const leftValue = accessor(left);
      const rightValue = accessor(right);
      if (leftValue == null && rightValue == null) return 0;
      if (leftValue == null) return 1;
      if (rightValue == null) return -1;
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * direction;
      }
      return String(leftValue).localeCompare(String(rightValue), undefined, {
        numeric: true,
        sensitivity: 'base',
      }) * direction;
    });
  }, [rows, sort, columns, controlled]);

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <>
      <DataTableDesktop
        ordered={ordered}
        rows={sortedRows}
        rowKey={rowKey}
        rowClassName={rowClassName}
        onRowClick={onRowClick}
        rowActionLabel={rowActionLabel}
        footer={footer}
        layout={layout}
        byKey={byKey}
        customizable={customizable}
        stickyHeader={stickyHeader}
        maxBodyHeight={maxBodyHeight}
        sort={sort}
        onToggleSort={toggleSort}
      />
      <DataTableMobile
        ordered={ordered}
        rows={sortedRows}
        rowKey={rowKey}
        rowClassName={rowClassName}
        onRowClick={onRowClick}
        rowActionLabel={rowActionLabel}
      />
    </>
  );
}
