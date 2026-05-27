import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Inbox, RefreshCw } from 'lucide-react';
import {
  DEFAULT_TABLE_PAGE_SIZE,
  DEFAULT_TABLE_PAGE_SIZE_OPTIONS,
  MIN_TABLE_COLUMN_WIDTH,
  reorderTableColumns,
  resizeTableColumn,
} from '../lib/tablePreferences';

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="portal-section-header mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div className="min-w-0">
        <h1 className="text-2xl font-black text-ink md:text-[32px] md:leading-tight">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-ink-2">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export function RefreshButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-card bg-surface px-4 text-[12px] font-extrabold text-ink ring-1 ring-line transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-sm active:translate-y-0 active:scale-[0.985] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/35 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
    >
      <RefreshCw size={14} className={loading ? 'animate-spinSlow text-brand' : ''} />
      Refresh
    </button>
  );
}

export function RetryButton({ loading, onClick }: { loading?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex h-9 items-center gap-2 rounded-lg bg-danger px-3 text-[12px] font-extrabold text-white transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-danger/90 hover:shadow-sm active:translate-y-0 active:scale-[0.985] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger/35 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
    >
      <RefreshCw size={14} className={loading ? 'animate-spinSlow' : ''} />
      Retry
    </button>
  );
}

export function StatCard({
  label,
  value,
  tone = 'brand',
}: {
  label: string;
  value: string;
  tone?: 'brand' | 'ok' | 'warn';
}) {
  const toneClass =
    tone === 'ok' ? 'bg-ok-bg text-ok' : tone === 'warn' ? 'bg-warn-bg text-warn' : 'bg-brand-bg text-brand';
  return (
    <div className="rounded-card bg-surface p-5 ring-1 ring-line transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-sm motion-reduce:transform-none motion-reduce:transition-none">
      <div className="text-[11px] font-black uppercase text-ink-3">{label}</div>
      <div className="mt-3 flex items-end justify-between">
        <div className="text-3xl font-black tabular-nums text-ink">{value}</div>
        <div className={`h-9 w-9 rounded-lg ${toneClass}`} />
      </div>
    </div>
  );
}

export function Panel({ children, title, right }: { children: ReactNode; title: string; right?: ReactNode }) {
  return (
    <section className="portal-panel rounded-card bg-surface ring-1 ring-line transition-shadow duration-200 ease-out hover:shadow-sm motion-reduce:transition-none">
      <div className="flex min-h-[58px] items-center justify-between gap-4 border-b border-line px-5 py-4">
        <h2 className="text-sm font-black text-ink md:text-[15px]">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  className?: string;
  render: (row: T) => ReactNode;
  width?: string;
};

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  checkboxSelection = false,
  pageSizeOptions = [...DEFAULT_TABLE_PAGE_SIZE_OPTIONS],
  initialPageSize = DEFAULT_TABLE_PAGE_SIZE,
  tableId,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  checkboxSelection?: boolean;
  pageSizeOptions?: number[];
  initialPageSize?: number;
  tableId?: string;
}) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [selectedRows, setSelectedRows] = useState<Set<string | number>>(new Set());
  const columnSignature = columns.map((column) => column.key).join('|');
  const pageSizeSignature = pageSizeOptions.join('|');
  const normalizedPageSizeOptions = useMemo(() => pageSizeOptions, [pageSizeSignature]);
  const storageKey = `portal.table.${tableId ?? columnSignature.replace(/\|/g, '.')}`;
  const defaultOrder = useMemo(() => columns.map((column) => column.key), [columnSignature]);
  const [columnOrder, setColumnOrder] = useState<string[]>(defaultOrder);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const resizeRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    setColumnOrder((previous) => {
      const known = previous.filter((key) => defaultOrder.includes(key));
      const missing = defaultOrder.filter((key) => !known.includes(key));
      return [...known, ...missing];
    });
  }, [defaultOrder]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { order?: unknown; widths?: unknown; pageSize?: unknown };
      if (Array.isArray(parsed.order)) {
        const savedOrder = parsed.order.filter((value): value is string => typeof value === 'string');
        const known = savedOrder.filter((key) => defaultOrder.includes(key));
        const missing = defaultOrder.filter((key) => !known.includes(key));
        setColumnOrder([...known, ...missing]);
      }
      if (parsed.widths && typeof parsed.widths === 'object') {
        setColumnWidths(parsed.widths as Record<string, number>);
      }
      if (typeof parsed.pageSize === 'number' && normalizedPageSizeOptions.includes(parsed.pageSize)) {
        setPageSize(parsed.pageSize);
      }
    } catch {
      // Ignore invalid saved table preferences.
    }
  }, [defaultOrder, normalizedPageSizeOptions, storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, JSON.stringify({ order: columnOrder, widths: columnWidths, pageSize }));
  }, [columnOrder, columnWidths, pageSize, storageKey]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const state = resizeRef.current;
      if (!state) return;
      setColumnWidths((previous) => ({
        ...previous,
        [state.key]: resizeTableColumn(state.startWidth, event.clientX - state.startX),
      }));
    }

    function onPointerUp() {
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  const orderedColumns = useMemo(() => {
    const map = new Map(columns.map((column) => [column.key, column]));
    return columnOrder.map((key) => map.get(key)).filter((column): column is DataTableColumn<T> => Boolean(column));
  }, [columnOrder, columns]);
  const totalPages = Math.max(Math.ceil(rows.length / pageSize), 1);
  const safePage = Math.min(page, totalPages - 1);
  const visibleRows = useMemo(
    () => rows.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [pageSize, rows, safePage]
  );
  const firstRow = rows.length === 0 ? 0 : safePage * pageSize + 1;
  const lastRow = Math.min((safePage + 1) * pageSize, rows.length);
  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((row) => selectedRows.has(getRowKey(row)));

  function toggleRow(rowKey: string | number) {
    setSelectedRows((previous) => {
      const next = new Set(previous);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }

  function toggleVisibleRows() {
    setSelectedRows((previous) => {
      const next = new Set(previous);
      if (allVisibleSelected) {
        visibleRows.forEach((row) => next.delete(getRowKey(row)));
      } else {
        visibleRows.forEach((row) => next.add(getRowKey(row)));
      }
      return next;
    });
  }

  return (
    <div className="portal-data-table overflow-hidden rounded-b-card bg-surface">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-xs">
          <thead className="bg-surface-2">
            <tr>
              {checkboxSelection ? (
                <th className="w-12 border-b border-r border-line px-3 py-2">
                  <label className="grid h-5 w-5 cursor-pointer place-items-center">
                    <input
                      type="checkbox"
                      aria-label="Select visible rows"
                      checked={allVisibleSelected}
                      onChange={toggleVisibleRows}
                      className="h-4 w-4 rounded border-line text-brand accent-[var(--theme-blue)]"
                    />
                  </label>
                </th>
              ) : null}
              {orderedColumns.map((column) => (
                <th
                  key={column.key}
                  draggable
                  onDragStart={(event) => {
                    setDraggedColumn(column.key);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', column.key);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const dragged = draggedColumn ?? event.dataTransfer.getData('text/plain');
                    if (!dragged) return;
                    setColumnOrder((previous) => reorderTableColumns(previous, dragged, column.key));
                    setDraggedColumn(null);
                  }}
                  onDragEnd={() => setDraggedColumn(null)}
                  style={{ width: columnWidths[column.key] ?? column.width ?? undefined }}
                  className={`group relative whitespace-nowrap border-b border-r border-line px-3 py-3 pr-6 text-[10px] font-black uppercase tracking-[0.08em] text-ink-3 last:border-r-0 ${column.className?.includes('right') ? 'text-right' : ''} ${draggedColumn === column.key ? 'opacity-55' : ''}`}
                >
                  {column.header}
                  <button
                    type="button"
                    aria-label={`Resize ${String(column.header)} column`}
                    className="portal-table-resize-handle"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      resizeRef.current = {
                        key: column.key,
                        startX: event.clientX,
                        startWidth: columnWidths[column.key] ?? event.currentTarget.parentElement?.getBoundingClientRect().width ?? MIN_TABLE_COLUMN_WIDTH,
                      };
                      document.body.style.cursor = 'col-resize';
                      document.body.style.userSelect = 'none';
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const rowKey = getRowKey(row);
              const selected = selectedRows.has(rowKey);
              return (
                <tr
                  key={rowKey}
                  data-selected={selected ? 'true' : 'false'}
                  onClick={() => onRowClick?.(row)}
                  className={`border-b border-line transition-colors duration-200 ease-out last:border-b-0 hover:bg-brand-bg/45 focus-within:bg-brand-bg/45 motion-reduce:transition-none ${
                    selected ? 'bg-brand-bg/55' : ''
                  } ${onRowClick ? 'cursor-pointer' : ''}`}
                >
                  {checkboxSelection ? (
                    <td className="w-12 border-r border-line px-3 py-2 align-middle">
                      <input
                        type="checkbox"
                        aria-label={`Select row ${String(rowKey)}`}
                        checked={selected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => toggleRow(rowKey)}
                        className="h-4 w-4 rounded border-line text-brand accent-[var(--theme-blue)]"
                      />
                    </td>
                  ) : null}
                  {orderedColumns.map((column) => (
                    <td
                      key={column.key}
                      style={{ width: columnWidths[column.key] ?? column.width ?? undefined }}
                      className={`border-r border-line px-3 py-3 align-middle text-ink-2 last:border-r-0 ${column.className?.includes('right') ? 'text-right' : ''}`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (checkboxSelection ? 1 : 0)} className="px-5 py-10 text-center text-sm font-bold text-ink-3">
                  No rows to display
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 border-t border-line bg-surface-2 px-4 py-3 text-xs font-bold text-ink-2 sm:flex-row sm:items-center sm:justify-end">
        <label className="flex items-center gap-2">
          Rows per page:
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(0);
            }}
            className="h-8 rounded-lg border border-line bg-surface px-2 text-xs font-black text-ink outline-none transition-colors hover:bg-surface-2 focus:border-brand"
          >
            {normalizedPageSizeOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <span className="tabular-nums text-ink-2">{firstRow}-{lastRow} of {rows.length}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={safePage <= 0}
            onClick={() => setPage((value) => Math.max(value - 1, 0))}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-brand-bg hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            aria-label="Next page"
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage((value) => Math.min(value + 1, totalPages - 1))}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-brand-bg hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-5 py-14 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-card bg-surface-2 text-brand ring-1 ring-line">
        <Inbox size={20} />
      </div>
      <div className="text-sm font-black text-ink">{title}</div>
      <div className="mt-2 text-sm leading-6 text-ink-3">{body}</div>
    </div>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="rounded-card bg-danger-bg px-4 py-3 text-sm font-semibold text-danger ring-1 ring-danger-border">
      {message}
    </div>
  );
}

export function ErrorPanel({
  message,
  loading,
  onRetry,
}: {
  message: string;
  loading?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="portal-error-panel">
      <div>
        <strong>Unable to load data</strong>
        <span>{message}</span>
      </div>
      {onRetry ? <RetryButton loading={loading} onClick={onRetry} /> : null}
    </div>
  );
}

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <span
      className={`block rounded-full bg-[linear-gradient(90deg,rgb(var(--surface-3-rgb,238_240_244))_0%,rgb(var(--surface-2-rgb,248_249_251))_50%,rgb(var(--surface-3-rgb,238_240_244))_100%)] bg-[length:200%_100%] animate-shimmer ${className}`}
      aria-hidden="true"
    />
  );
}

export function KpiSkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div
          className="flex min-h-[112px] items-center gap-4 rounded-card bg-surface p-5 ring-1 ring-line transition-shadow duration-200 hover:shadow-sm motion-reduce:transition-none"
          key={index}
        >
          <SkeletonBlock className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-3">
            <SkeletonBlock className="h-3 w-[42%]" />
            <SkeletonBlock className="h-6 w-24" />
            <SkeletonBlock className="h-3 w-[64%]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, row) => (
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_0.8fr_0.8fr]" key={row}>
          {Array.from({ length: columns }).map((__, column) => (
            <SkeletonBlock key={column} className="h-3 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <div className="rounded-card bg-surface p-5 ring-1 ring-line" key={index}>
          <SkeletonBlock className="h-3 w-[64%]" />
          <SkeletonBlock className="mt-4 h-3 w-full" />
          <SkeletonBlock className="mt-3 h-3 w-[42%]" />
        </div>
      ))}
    </div>
  );
}

export function RefreshingNotice({ show }: { show: boolean }) {
  return show ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand animate-pulse motion-reduce:animate-none">
      <RefreshCw size={13} className="animate-spinSlow" />
      Refreshing
    </span>
  ) : null;
}

export function StatusBadge({ value }: { value: string | null | undefined }) {
  const status = String(value ?? 'unknown').toLowerCase();
  const label = status.replace(/_/g, ' ') || 'unknown';
  const cls =
    status === 'shipped'
      ? 'bg-ok-bg text-ok'
      : status === 'cancelled'
        ? 'bg-danger-bg text-danger'
        : 'bg-brand-bg text-brand';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black capitalize ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {label}
    </span>
  );
}
