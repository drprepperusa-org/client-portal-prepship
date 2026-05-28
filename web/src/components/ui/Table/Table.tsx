import React, { useMemo, useState, useEffect } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  ColumnDef,
  SortingState,
  ColumnSizingState,
  ColumnOrderState,
  OnChangeFn,
  PaginationState,
} from '@tanstack/react-table';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { TableHeader } from './TableHeader';
import { TableBody } from './TableBody';
import { TablePagination } from './TablePagination';
import { useTablePersistence } from './useTablePersistence';

export interface TableProps<TData, TValue = any> {
  tableId: string;
  data: TData[];
  columns: ColumnDef<TData, TValue>[];
  loading?: boolean;
  skeletonRows?: number;
  pageSizeOptions?: number[];
  defaultPageSize?: number;
  manualPagination?: boolean;
  pageCount?: number;
  onPaginationChange?: (state: PaginationState) => void;
  onSortChange?: (state: SortingState) => void;
  onColumnResize?: (sizing: ColumnSizingState) => void;
  onColumnReorder?: (order: ColumnOrderState) => void;
  onRowClick?: (row: TData) => void;
  emptyMessage?: React.ReactNode;
  className?: string;
}

export function Table<TData>({
  tableId,
  data,
  columns,
  loading = false,
  skeletonRows = 6,
  pageSizeOptions = [10, 25, 50, 100],
  defaultPageSize = 10,
  manualPagination = false,
  pageCount,
  onPaginationChange,
  onSortChange,
  onColumnResize,
  onColumnReorder,
  onRowClick,
  emptyMessage,
  className = '',
}: TableProps<TData>) {
  // --- Local State ---
  const [sorting, setSorting] = useState<SortingState>([]);
  
  // Non-persisted pagination pageIndex (only size is persisted)
  const [pageIndex, setPageIndex] = useState(0);

  // --- Persistence ---
  const [persistedPageSize, setPersistedPageSize] = useTablePersistence(
    tableId,
    'pageSize',
    defaultPageSize
  );

  const [columnSizing, setColumnSizing] = useTablePersistence<ColumnSizingState>(
    tableId,
    'columnSizing',
    {}
  );

  const initialColumnIds = useMemo(() => columns.map((c) => c.id as string), [columns]);
  
  // We need to clean up order if column definitions change upstream
  const [persistedColumnOrder, setPersistedColumnOrder] = useTablePersistence<ColumnOrderState>(
    tableId,
    'columnOrder',
    initialColumnIds
  );

  const columnOrder = useMemo(() => {
    // Merge persisted order with new columns that might have appeared
    const validPersisted = persistedColumnOrder.filter((id) => initialColumnIds.includes(id));
    const missing = initialColumnIds.filter((id) => !validPersisted.includes(id));
    return [...validPersisted, ...missing];
  }, [persistedColumnOrder, initialColumnIds]);

  // --- Handlers ---
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      const oldIndex = columnOrder.indexOf(active.id as string);
      const newIndex = columnOrder.indexOf(over.id as string);
      const newOrder = arrayMove(columnOrder, oldIndex, newIndex);
      setPersistedColumnOrder(newOrder);
      onColumnReorder?.(newOrder);
    }
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  // --- Table Instance ---
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnOrder,
      columnSizing,
      pagination: {
        pageIndex,
        pageSize: persistedPageSize,
      },
    },
    // Pipeline
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // Features
    columnResizeMode: 'onChange',
    manualPagination,
    pageCount: manualPagination ? pageCount : undefined,
    onSortingChange: (updater) => {
      setSorting(updater);
      if (onSortChange && typeof updater !== 'function') {
        onSortChange(updater);
      }
    },
    onColumnSizingChange: (updater) => {
      const newSizing = typeof updater === 'function' ? updater(columnSizing) : updater;
      setColumnSizing(newSizing);
      onColumnResize?.(newSizing);
    },
    onPaginationChange: (updater) => {
      const current = { pageIndex, pageSize: persistedPageSize };
      const next = typeof updater === 'function' ? updater(current) : updater;
      setPageIndex(next.pageIndex);
      setPersistedPageSize(next.pageSize);
      onPaginationChange?.(next);
    },
  });

  return (
    <div data-portal-table={tableId} className={`flex flex-col rounded-lg border border-line bg-white shadow-sm ${className}`}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div className="relative w-full overflow-x-auto overflow-y-hidden">
          <table
            className="w-full text-left"
            style={{ 
              tableLayout: 'fixed',
              width: table.getTotalSize(),
            }}
          >
            <SortableContext
              items={columnOrder}
              strategy={horizontalListSortingStrategy}
            >
              <TableHeader table={table} />
            </SortableContext>
            
            <TableBody
              table={table}
              loading={loading}
              skeletonRows={skeletonRows}
              onRowClick={onRowClick}
              emptyMessage={emptyMessage}
            />
          </table>
        </div>
      </DndContext>

      <TablePagination table={table} pageSizeOptions={pageSizeOptions} />
    </div>
  );
}
