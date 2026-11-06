import { ChevronDown, ChevronRight, ChevronsUpDown, ChevronUp, GripVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { ColumnLayout } from '@/lib/useColumnLayout';
import { DataTableColumnControls } from '../DataTableColumnControls';
import { TableUpdateStatus } from '../TableUpdateStatus';
import type { Column, SortState } from './types';
import {
  useDataTableInteractions,
  type DataTableInteractions,
} from './useDataTableInteractions';

interface HeaderProps<T> {
  worksheet: boolean;
  ordered: Column<T>[];
  layout: ColumnLayout;
  interactions: DataTableInteractions;
  customizable: boolean;
  stickyHeader: boolean;
  hasRowAction: boolean;
  sort: SortState;
  onToggleSort: (column: Column<T>) => void;
}

function DataTableHeader<T>({
  worksheet,
  ordered,
  layout,
  interactions,
  customizable,
  stickyHeader,
  hasRowAction,
  sort,
  onToggleSort,
}: HeaderProps<T>) {
  return (
    <thead>
      <tr className="border-b border-slate-200/70 text-left">
        {ordered.map((column) => {
          const canDrag = customizable && column.draggable !== false;
          const canResize = column.resizable !== false;
          const isDragging = interactions.dragKey === column.key;
          const isDropTarget = interactions.overKey === column.key
            && interactions.dragKey !== column.key;
          const dropAfter = interactions.dragKey != null
            && layout.order.indexOf(interactions.dragKey) < layout.order.indexOf(column.key);
          return (
            <th
              key={column.key}
              draggable={canDrag && !interactions.resizing.current}
              onDragStart={(event) => canDrag && interactions.onHeaderDragStart(column.key, event)}
              onDragOver={(event) => interactions.onHeaderDragOver(column.key, event)}
              onDrop={(event) => interactions.onHeaderDrop(column.key, event)}
              onDragEnd={interactions.onHeaderDragEnd}
              aria-sort={sort?.key === column.key
                ? (sort.dir === 'asc' ? 'ascending' : 'descending')
                : undefined}
              className={cn(
                'group select-none overflow-hidden font-semibold transition-colors',
                worksheet ? 'border-r border-slate-300 px-3 py-2 text-sm text-ink last:border-r-0' : 'px-4 py-3 text-xs uppercase tracking-wide text-ink-3',
                stickyHeader
                  ? cn('sticky top-0 z-20 shadow-[inset_0_-1px_0_theme(colors.slate.200)]', worksheet ? 'bg-sky-100' : 'bg-white/95')
                  : 'relative',
                worksheet && !stickyHeader && 'bg-sky-100',
                canDrag ? 'cursor-grab active:cursor-grabbing' : column.sortAccessor && 'cursor-pointer',
                sort?.key === column.key && 'text-brand-600',
                isDragging && 'opacity-40',
                isDropTarget && 'bg-brand-50/70',
                column.className,
              )}
            >
              {isDropTarget && <span className={cn('absolute inset-y-0 w-0.5 bg-brand-500', dropAfter ? 'right-0' : 'left-0')} />}
              <span className={cn(
                'flex items-center gap-1',
                column.className?.includes('text-right') && 'justify-end',
              )}>
                {canDrag && (
                  <GripVertical
                    size={12}
                    className={cn('shrink-0 transition-opacity', worksheet ? 'text-ink-3' : 'text-slate-300 opacity-0 group-hover:opacity-100')}
                    aria-hidden
                  />
                )}
                {column.sortAccessor ? (
                  <button
                    type="button"
                    onClick={() => onToggleSort(column)}
                    className="focus-ring -my-2 inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 text-left"
                  >
                    <span ref={layout.registerHeaderRef(column.key)} className="whitespace-nowrap">
                      {column.header}
                    </span>
                    <span className="shrink-0 text-slate-400" aria-hidden="true">
                      {sort?.key === column.key ? (
                        sort.dir === 'asc'
                          ? <ChevronUp size={12} className="text-brand-600" />
                          : <ChevronDown size={12} className="text-brand-600" />
                      ) : (
                        <ChevronsUpDown
                          size={11}
                          className="opacity-0 transition-opacity group-hover:opacity-50 group-focus-within:opacity-50"
                        />
                      )}
                    </span>
                  </button>
                ) : (
                  <span ref={layout.registerHeaderRef(column.key)} className="whitespace-nowrap">
                    {column.header}
                  </span>
                )}
              </span>
              {canResize && (
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${column.header} column`}
                  aria-valuenow={layout.widthOf(column.key)}
                  aria-valuemin={column.minWidth ?? 88}
                  aria-valuemax={640}
                  tabIndex={0}
                  onPointerDown={(event) => interactions.startResize(column.key, event)}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                    event.preventDefault();
                    event.stopPropagation();
                    const delta = event.key === 'ArrowRight' ? 16 : -16;
                    layout.setWidth(column.key, layout.widthOf(column.key) + delta);
                  }}
                  onClick={(event) => event.stopPropagation()}
                  draggable={false}
                  className="focus-ring absolute right-0 top-0 z-10 flex h-full w-3 cursor-col-resize touch-none items-center justify-center"
                >
                  <span className="h-1/2 w-px bg-slate-300/80 transition-colors group-hover:bg-brand-400" />
                  <span className="absolute inset-y-0 right-0 w-0.5 bg-transparent transition-colors hover:bg-brand-400" />
                </span>
              )}
            </th>
          );
        })}
        {hasRowAction && <th scope="col"><span className="sr-only">Actions</span></th>}
      </tr>
    </thead>
  );
}

function DataTableFooter<T>({
  ordered,
  footer,
  hasRowAction,
}: {
  ordered: Column<T>[];
  footer?: ReactNode;
  hasRowAction: boolean;
}) {
  if (ordered.some((column) => column.footer !== undefined)) {
    return (
      <tfoot>
        <tr className="border-t-2 border-slate-200 bg-white/40 font-bold text-ink">
          {ordered.map((column) => (
            <td key={column.key} className={cn('px-4 py-3', column.className)}>
              {column.footer ?? null}
            </td>
          ))}
          {hasRowAction && <td />}
        </tr>
      </tfoot>
    );
  }
  if (!footer) return null;
  return (
    <tfoot>
      <tr className="border-t-2 border-slate-200 bg-white/40 font-bold text-ink">
        {footer}
        {hasRowAction && <td />}
      </tr>
    </tfoot>
  );
}

interface DataTableDesktopProps<T> {
  appearance: 'default' | 'worksheet';
  isUpdating: boolean;
  ordered: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
  rowActionLabel?: (row: T) => string;
  footer?: ReactNode;
  layout: ColumnLayout;
  byKey: Record<string, Column<T>>;
  customizable: boolean;
  stickyHeader: boolean;
  maxBodyHeight: string;
  sort: SortState;
  onToggleSort: (column: Column<T>) => void;
}

export function DataTableDesktop<T>(props: DataTableDesktopProps<T>) {
  const interactions = useDataTableInteractions(props.layout);
  const hasRowAction = props.onRowClick != null;
  const worksheet = props.appearance === 'worksheet';
  return (
    <div className={cn('min-w-0 max-w-full', worksheet ? 'block' : 'hidden md:block')}>
      {props.customizable && (
        <DataTableColumnControls layout={props.layout} byKey={props.byKey} isUpdating={props.isUpdating} />
      )}
      {!props.customizable && <TableUpdateStatus updating={props.isUpdating} />}
      {worksheet && <p className="mb-2 text-xs text-ink-2 md:hidden">Scroll sideways to view all columns.</p>}
      <div
        role={worksheet ? 'region' : undefined}
        aria-label={worksheet ? 'Scrollable worksheet' : undefined}
        tabIndex={worksheet ? 0 : undefined}
        className={cn(
          'max-w-full',
          worksheet ? 'focus-ring relative rounded-md border border-slate-300 bg-white' : 'rounded-glass',
          props.stickyHeader ? 'overflow-auto' : 'overflow-x-auto',
        )}
        style={props.stickyHeader ? { maxHeight: props.maxBodyHeight } : undefined}
      >
        <table
          className="border-collapse text-sm"
          style={{
            width: props.layout.totalWidth + (hasRowAction ? 52 : 0),
            minWidth: worksheet ? '100%' : undefined,
            tableLayout: 'fixed',
          }}
        >
          <colgroup>
            {props.ordered.map((column) => (
              <col key={column.key} style={{ width: props.layout.widthOf(column.key) }} />
            ))}
            {hasRowAction && <col style={{ width: 52 }} />}
          </colgroup>
          <DataTableHeader
            worksheet={worksheet}
            ordered={props.ordered}
            layout={props.layout}
            interactions={interactions}
            customizable={props.customizable}
            stickyHeader={props.stickyHeader}
            hasRowAction={hasRowAction}
            sort={props.sort}
            onToggleSort={props.onToggleSort}
          />
          {/* Returned rows are immediately readable, including on busy frames. */}
          <tbody>
            {props.rows.map((row) => (
              <tr
                key={props.rowKey(row)}
                onClick={() => props.onRowClick?.(row)}
                className={cn(
                  'border-b transition-colors last:border-0 hover:bg-brand-50/50',
                  worksheet ? 'border-slate-200' : 'border-slate-100',
                  props.onRowClick && 'cursor-pointer',
                  props.rowClassName?.(row),
                )}
              >
                {props.ordered.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'overflow-hidden align-middle text-ink-2',
                      worksheet ? 'border-r border-slate-200 px-3 py-2 leading-snug last:border-r-0' : 'px-4 py-3.5',
                      column.className,
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
                {props.onRowClick && props.rowActionLabel && (
                  <td className="px-1 py-1 text-center">
                    <button
                      type="button"
                      aria-label={props.rowActionLabel(row)}
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onRowClick?.(row);
                      }}
                      className="focus-ring grid h-11 w-11 place-items-center rounded-lg text-ink-3 hover:bg-brand-50 hover:text-brand-700"
                    >
                      <ChevronRight size={17} aria-hidden="true" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <DataTableFooter
            ordered={props.ordered}
            footer={props.footer}
            hasRowAction={hasRowAction}
          />
        </table>
      </div>
    </div>
  );
}
