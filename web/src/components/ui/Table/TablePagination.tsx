import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type Table } from '@tanstack/react-table';

interface TablePaginationProps<TData> {
  table: Table<TData>;
  pageSizeOptions?: number[];
}

export function TablePagination<TData>({
  table,
  pageSizeOptions = [10, 25, 50, 100],
}: TablePaginationProps<TData>) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();
  
  // Calculate total rows for "Showing X-Y of Z"
  // For manual pagination, if the table doesn't have the total rows count easily exposed,
  // we could just omit it, but TanStack provides options for manual row count.
  const totalRows = table.getRowCount ? table.getRowCount() : table.getCoreRowModel().rows.length;
  
  const currentFirstRow = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const currentLastRow = Math.min(totalRows, (pageIndex + 1) * pageSize);

  // Generate page numbers with ellipsis
  const renderPageButtons = () => {
    const pages: (number | string)[] = [];
    const maxVisiblePages = 5;

    if (pageCount <= maxVisiblePages) {
      for (let i = 0; i < pageCount; i++) pages.push(i);
    } else {
      pages.push(0);
      if (pageIndex > 2) pages.push('...');
      
      const start = Math.max(1, pageIndex - 1);
      const end = Math.min(pageCount - 2, pageIndex + 1);
      
      for (let i = start; i <= end; i++) pages.push(i);
      
      if (pageIndex < pageCount - 3) pages.push('...');
      pages.push(pageCount - 1);
    }

    return pages.map((page, index) => {
      if (page === '...') {
        return (
          <span key={`ellipsis-${index}`} className="px-2 text-ink-3">
            ...
          </span>
        );
      }
      
      const p = page as number;
      const isActive = p === pageIndex;
      
      return (
        <button
          key={p}
          onClick={() => table.setPageIndex(p)}
          className={`grid h-7 min-w-[28px] place-items-center rounded px-1.5 text-[13px] font-medium transition-colors duration-200
            ${isActive 
              ? 'bg-brand text-white' 
              : 'text-ink-2 hover:bg-brand/10 hover:text-brand'
            }
          `}
          aria-label={`Go to page ${p + 1}`}
          aria-current={isActive ? 'page' : undefined}
        >
          {p + 1}
        </button>
      );
    });
  };

  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-3">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor="table-page-size" className="text-[13px] font-medium text-ink-3">
            Show
          </label>
          <select
            id="table-page-size"
            value={pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            className="h-7 rounded border border-line bg-surface px-1.5 text-[13px] font-medium text-ink-2 outline-none transition-colors hover:border-line-2 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
        
        <div className="hidden text-[13px] font-medium text-ink-3 sm:block">
          Showing <span className="font-semibold text-ink-2">{currentFirstRow}</span> to{' '}
          <span className="font-semibold text-ink-2">{currentLastRow}</span> of{' '}
          <span className="font-semibold text-ink-2">{totalRows}</span>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          className="grid h-7 w-7 place-items-center rounded text-ink-3 transition-colors hover:bg-brand/10 hover:text-brand disabled:pointer-events-none disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeft size={16} strokeWidth={2.5} />
        </button>
        
        <div className="flex items-center gap-0.5">
          {renderPageButtons()}
        </div>

        <button
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          className="grid h-7 w-7 place-items-center rounded text-ink-3 transition-colors hover:bg-brand/10 hover:text-brand disabled:pointer-events-none disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRight size={16} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
