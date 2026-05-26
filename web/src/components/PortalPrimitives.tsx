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
      className="inline-flex h-9 items-center gap-2 rounded-lg bg-surface px-3 text-[12px] font-extrabold text-ink ring-1 ring-line transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-sm active:translate-y-0 active:scale-[0.985] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/35 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
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
    <section className="rounded-card bg-surface ring-1 ring-line transition-shadow duration-200 ease-out hover:shadow-sm motion-reduce:transition-none">
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
    <div className="overflow-x-auto rounded-b-card">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="bg-surface-2">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`whitespace-nowrap border-b border-line px-5 py-3 text-[11px] font-black uppercase tracking-[0.08em] text-ink-3 ${column.className?.includes('right') ? 'text-right' : ''}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr
              key={getRowKey(row)}
              className="transition-colors duration-200 ease-out hover:bg-brand-bg/50 focus-within:bg-brand-bg/50 motion-reduce:transition-none"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-5 py-4 align-middle text-ink-2 ${column.className?.includes('right') ? 'text-right' : ''}`}
                >
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
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-black capitalize ${cls}`}>{label}</span>;
}
