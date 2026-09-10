import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Column, SortState } from './types';

interface DataTableMobileProps<T> {
  ordered: Column<T>[];
  sort: SortState;
  onToggleSort: (column: Column<T>) => void;
  rows: T[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
  rowActionLabel?: (row: T) => string;
}

export function DataTableMobile<T>({
  ordered, sort, onToggleSort,
  rows,
  rowKey,
  rowClassName,
  onRowClick,
  rowActionLabel,
}: DataTableMobileProps<T>) {
  return (
    <div
      className="flex flex-col gap-3 md:hidden"
    >
      {ordered.some((column) => column.sortAccessor) && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-ink-2">Sort by{' '}
            <select aria-label="Sort by" className="focus-ring rounded-lg p-2" value={sort?.key ?? ''}
              onChange={(event) => { const column = ordered.find((c) => c.key === event.target.value); if (column) onToggleSort(column); }}>
              <option value="" disabled>Default order</option>
              {ordered.filter((c) => c.sortAccessor).map((c) => <option key={c.key} value={c.key}>{c.header}</option>)}
            </select>
          </label>
          {sort && <button type="button" className="focus-ring min-h-11 rounded-lg px-3 text-sm"
            onClick={() => { const column = ordered.find((c) => c.key === sort.key); if (column) onToggleSort(column); }}>
            {sort.dir === 'asc' ? 'Ascending' : 'Descending'}
          </button>}
        </div>
      )}
      {rows.map((row) => (
        <div
          key={rowKey(row)}
          onClick={() => onRowClick?.(row)}
          className={cn(
            'glass relative rounded-glass-sm p-4',
            onRowClick && 'cursor-pointer',
            rowClassName?.(row),
          )}
        >
          {onRowClick && rowActionLabel && (
            <button
              type="button"
              aria-label={rowActionLabel(row)}
              onClick={(event) => {
                event.stopPropagation();
                onRowClick(row);
              }}
              className="focus-ring absolute right-2 top-2 grid h-11 w-11 place-items-center rounded-lg text-ink-3 hover:bg-brand-50 hover:text-brand-700"
            >
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          )}
          {ordered.map((column, columnIndex) => (
            <div
              key={column.key}
              className={cn(
                'flex items-start justify-between gap-3 py-1.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-slate-100',
                onRowClick && rowActionLabel && columnIndex === 0 && 'pr-12',
              )}
            >
              {!column.mobileHidden && (
                <span className="shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
                  {column.header}
                </span>
              )}
              <div className={cn(
                'min-w-0 text-right text-ink-2',
                column.mobileHidden ? 'w-full text-left' : 'flex-1',
              )}>
                {column.render(row)}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
