import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

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
    <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <h1 className="text-2xl font-black text-ink md:text-3xl">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-ink-2">{subtitle}</p>
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
      className="inline-flex h-9 items-center gap-2 rounded-lg bg-surface px-3 text-[12px] font-extrabold text-ink ring-1 ring-line transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
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
      className="inline-flex h-9 items-center gap-2 rounded-lg bg-danger px-3 text-[12px] font-extrabold text-white transition-colors hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <RefreshCw size={14} className={loading ? 'portal-spin' : ''} />
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
    <div className="rounded-card bg-surface p-5 ring-1 ring-line">
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
    <section className="rounded-card bg-surface ring-1 ring-line">
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
        <h2 className="text-sm font-black text-ink">{title}</h2>
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
};

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string | number;
}) {
  return (
    <div className="portal-data-table-wrap">
      <table className="portal-data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.className}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) => (
                <td key={column.key} className={column.className}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-5 py-12 text-center">
      <div className="text-sm font-black text-ink">{title}</div>
      <div className="mt-1 text-sm text-ink-3">{body}</div>
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
  return <span className={`portal-skeleton ${className}`} aria-hidden="true" />;
}

export function KpiSkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="portal-kpis mb-6">
      {Array.from({ length: count }).map((_, index) => (
        <div className="portal-kpi" key={index}>
          <SkeletonBlock className="portal-skeleton-icon" />
          <div className="portal-kpi-body">
            <SkeletonBlock className="portal-skeleton-line short" />
            <SkeletonBlock className="portal-skeleton-line value" />
            <SkeletonBlock className="portal-skeleton-line medium" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="portal-table-skeleton">
      {Array.from({ length: rows }).map((_, row) => (
        <div className="portal-table-skeleton-row" key={row}>
          {Array.from({ length: columns }).map((__, column) => (
            <SkeletonBlock key={column} className="portal-skeleton-line" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="portal-card-skeleton-grid">
      {Array.from({ length: count }).map((_, index) => (
        <div className="portal-card-skeleton" key={index}>
          <SkeletonBlock className="portal-skeleton-line medium" />
          <SkeletonBlock className="portal-skeleton-line" />
          <SkeletonBlock className="portal-skeleton-line short" />
        </div>
      ))}
    </div>
  );
}

export function RefreshingNotice({ show }: { show: boolean }) {
  return show ? (
    <span className="portal-refreshing">
      <RefreshCw size={13} className="portal-spin" />
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
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-black capitalize ${cls}`}>{label}</span>;
}
