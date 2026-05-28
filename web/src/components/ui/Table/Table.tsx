import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  ColumnDef,
  SortingState,
  ColumnSizingState,
  ColumnOrderState,
  VisibilityState,
  OnChangeFn,
  PaginationState,
} from '@tanstack/react-table';
import { Check, Columns3 } from 'lucide-react';
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
  showColumnControls?: boolean;
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
  showColumnControls = false,
}: TableProps<TData>) {
  // --- Local State ---
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  
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

  const [columnVisibility, setColumnVisibility] = useTablePersistence<VisibilityState>(
    tableId,
    'columnVisibility',
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

  useEffect(() => {
    setColumnVisibility((current) => {
      const validEntries = Object.entries(current).filter(([id]) => initialColumnIds.includes(id));
      if (validEntries.length === Object.keys(current).length) return current;
      return Object.fromEntries(validEntries);
    });
  }, [initialColumnIds, setColumnVisibility]);

  useEffect(() => {
    if (!columnMenuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!columnMenuRef.current?.contains(event.target as Node)) {
        setColumnMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setColumnMenuOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [columnMenuOpen]);

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
      columnVisibility,
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
    onColumnVisibilityChange: (updater) => {
      const newVisibility = typeof updater === 'function' ? updater(columnVisibility) : updater;
      setColumnVisibility(newVisibility);
    },
    onPaginationChange: (updater) => {
      const current = { pageIndex, pageSize: persistedPageSize };
      const next = typeof updater === 'function' ? updater(current) : updater;
      setPageIndex(next.pageIndex);
      setPersistedPageSize(next.pageSize);
      onPaginationChange?.(next);
    },
  });

  const hideableColumns = table.getAllLeafColumns().filter((column) => column.getCanHide());
  const visibleColumns = table.getVisibleLeafColumns().length;
  const totalColumns = table.getAllLeafColumns().length;
  const visibleHideableColumns = hideableColumns.filter((column) => column.getIsVisible()).length;

  return (
    <div data-portal-table={tableId} className={`flex flex-col rounded-lg border border-line bg-white shadow-sm ${className}`}>
      {showColumnControls ? (
        <div className="flex items-center justify-end border-b border-line bg-surface px-4 py-3">
          <div ref={columnMenuRef} className="relative">
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 text-xs font-black text-ink shadow-sm transition-colors hover:bg-brand-bg hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/35"
              aria-haspopup="menu"
              aria-expanded={columnMenuOpen}
              onClick={() => setColumnMenuOpen((open) => !open)}
            >
              <Columns3 size={15} />
              Columns
              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-black text-ink-3">
                {visibleColumns}/{totalColumns}
              </span>
            </button>
            {columnMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+8px)] z-30 w-72 overflow-hidden rounded-xl border border-line bg-white p-0 shadow-[0_24px_70px_rgba(15,23,42,.18)]"
              >
                <div className="flex items-center justify-between border-b border-line px-3 py-2">
                  <div className="text-[11px] font-black uppercase text-ink-3">Visible columns</div>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-[11px] font-black text-brand transition-colors hover:bg-brand/10"
                    aria-label="Reset visible columns"
                    onClick={() => table.resetColumnVisibility()}
                  >
                    Reset
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto px-3 py-2">
                  {hideableColumns.map((column) => {
                    const isVisible = column.getIsVisible();
                    const disableLastVisible = isVisible && visibleHideableColumns <= 1;
                    return (
                      <label
                        key={column.id}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs font-bold text-ink transition-colors hover:bg-surface-2 ${
                          disableLastVisible ? 'cursor-not-allowed opacity-55' : ''
                        }`}
                      >
                        <span
                          className={`grid h-4 w-4 place-items-center rounded border ${
                            isVisible ? 'border-brand bg-brand text-white' : 'border-line bg-white text-transparent'
                          }`}
                        >
                          <Check size={12} strokeWidth={3} />
                        </span>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={isVisible}
                          disabled={disableLastVisible}
                          onChange={column.getToggleVisibilityHandler()}
                        />
                        <span className="truncate">{columnLabel(column.columnDef.header, column.id)}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="border-t border-line px-3 py-2 text-[11px] font-semibold text-ink-3">
                  Drag a column header to reorder. {totalColumns} columns
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
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

function columnLabel(header: unknown, fallback: string) {
  if (typeof header === 'string') return header || fallback;
  if (typeof header === 'number') return String(header);
  return fallback.replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
