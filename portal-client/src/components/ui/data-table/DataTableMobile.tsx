import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { staggerContainer, staggerItem } from '@/lib/motion';
import type { Column } from './types';

interface DataTableMobileProps<T> {
  ordered: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
  rowActionLabel?: (row: T) => string;
}

export function DataTableMobile<T>({
  ordered,
  rows,
  rowKey,
  rowClassName,
  onRowClick,
  rowActionLabel,
}: DataTableMobileProps<T>) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="enter"
      className="flex flex-col gap-3 md:hidden"
    >
      {rows.map((row) => (
        <motion.div
          key={rowKey(row)}
          variants={staggerItem}
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
        </motion.div>
      ))}
    </motion.div>
  );
}
