import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}

export function Pagination({ page, totalPages, total, pageSize, onPage }: PaginationProps) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-3">
      <p className="text-xs text-ink-3 tnum">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => canPrev && onPage(page - 1)}
          disabled={!canPrev}
          aria-label="Previous page"
          className={cn('focus-ring grid h-8 w-8 place-items-center rounded-lg ring-1 ring-slate-200 transition-colors', canPrev ? 'cursor-pointer bg-white text-ink-2 hover:bg-brand-50 hover:text-brand-600' : 'cursor-not-allowed text-slate-300')}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="px-2 text-xs font-medium text-ink-2 tnum">
          {page} / {Math.max(1, totalPages)}
        </span>
        <button
          onClick={() => canNext && onPage(page + 1)}
          disabled={!canNext}
          aria-label="Next page"
          className={cn('focus-ring grid h-8 w-8 place-items-center rounded-lg ring-1 ring-slate-200 transition-colors', canNext ? 'cursor-pointer bg-white text-ink-2 hover:bg-brand-50 hover:text-brand-600' : 'cursor-not-allowed text-slate-300')}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
