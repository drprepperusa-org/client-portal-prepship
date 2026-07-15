import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
}

const PAGE_SIZE_OPTIONS = [50, 100, 200, 300, 500] as const;

function PaginationArrow({
  enabled,
  label,
  onClick,
  children,
}: {
  enabled: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      aria-label={label}
      className={cn(
        'focus-ring grid h-8 w-8 place-items-center rounded-lg ring-1 ring-slate-200 transition-colors',
        enabled
          ? 'cursor-pointer bg-white text-ink-2 hover:bg-brand-50 hover:text-brand-600'
          : 'cursor-not-allowed text-slate-300',
      )}
    >
      {children}
    </button>
  );
}

export function Pagination({ page, totalPages, total, pageSize, onPage, onPageSize }: PaginationProps) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
      <div className="flex items-center gap-3">
        <p className="text-xs text-ink-3 tnum">
          {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
        </p>
        <label className="flex items-center gap-1.5 text-xs text-ink-3">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
            aria-label="Rows per page"
            className="focus-ring h-8 cursor-pointer rounded-lg border border-white/80 bg-white/70 px-2 text-xs font-medium text-ink ring-1 ring-slate-200/70"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-1.5">
        <PaginationArrow enabled={canPrev} label="Previous page" onClick={() => canPrev && onPage(page - 1)}>
          <ChevronLeft size={16} />
        </PaginationArrow>
        <span className="px-2 text-xs font-medium text-ink-2 tnum">
          {page} / {Math.max(1, totalPages)}
        </span>
        <PaginationArrow enabled={canNext} label="Next page" onClick={() => canNext && onPage(page + 1)}>
          <ChevronRight size={16} />
        </PaginationArrow>
      </div>
    </div>
  );
}
