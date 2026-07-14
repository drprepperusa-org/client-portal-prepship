import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronLeft, ChevronRight, Columns3, RotateCcw } from 'lucide-react';
import type { ColumnLayout } from '@/lib/useColumnLayout';
import { cn } from '@/lib/cn';
import type { Column } from './data-table/types';

export function DataTableColumnControls<T>({
  layout,
  byKey,
}: {
  layout: ColumnLayout;
  byKey: Record<string, Column<T>>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    function onDocumentPointer(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocumentPointer);
    return () => document.removeEventListener('mousedown', onDocumentPointer);
  }, []);

  return (
    <div className="flex items-center justify-end gap-2 px-1 pb-2">
      {layout.isCustomized && (
        <button
          type="button"
          onClick={layout.resetLayout}
          className="focus-ring inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-ink-3 transition-colors hover:bg-slate-100 hover:text-brand-600 sm:min-h-8"
        >
          <RotateCcw size={13} aria-hidden="true" /> Reset
        </button>
      )}
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={menuId}
          className={cn(
            'focus-ring inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border sm:min-h-8',
            'border-white/80 bg-white/70 px-2.5 py-1.5 text-xs font-semibold text-ink-2',
            'ring-1 ring-slate-200/70 transition-colors hover:bg-white',
          )}
        >
          <Columns3 size={14} aria-hidden="true" /> Columns
          <span className="text-ink-3">{layout.visibleOrder.length}/{layout.order.length}</span>
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              id={menuId}
              role="group"
              aria-label="Table column controls"
              initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: reduceMotion ? 0 : 0.14 }}
              className="glass-strong absolute right-0 z-30 mt-2 max-h-80 w-72 overflow-auto rounded-glass-sm p-2 shadow-glass-lg"
            >
              <p className="px-2 pb-1.5 text-[11px] text-ink-3">Toggle visibility, move columns, or drag headers to reorder.</p>
              {layout.order.map((key, index) => {
                const column = byKey[key];
                if (!column) return null;
                const visible = !layout.hidden.includes(key);
                const isLastVisible = visible && layout.visibleOrder.length === 1;
                const movable = column.draggable !== false;
                return (
                  <div key={key} className="flex items-center gap-1 rounded-md hover:bg-slate-100/80">
                    <button
                      type="button"
                      onClick={() => !isLastVisible && layout.toggleHidden(key)}
                      disabled={isLastVisible}
                      aria-pressed={visible}
                      className="focus-ring flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded border', visible ? 'border-brand-500 bg-gradient-to-br from-brand-400 to-brand-600' : 'border-slate-300 bg-white')}>
                        {visible && <Check size={11} className="text-white" strokeWidth={3.5} aria-hidden="true" />}
                      </span>
                      <span className="truncate text-ink-2">{column.header}</span>
                    </button>
                    {movable && (
                      <div className="flex shrink-0 items-center">
                        <button
                          type="button"
                          onClick={() => layout.move(key, -1)}
                          disabled={index === 0}
                          aria-label={`Move ${column.header} left`}
                          className="focus-ring grid h-11 w-11 place-items-center rounded-md text-ink-3 hover:bg-white hover:text-brand-600 disabled:opacity-30 sm:h-9 sm:w-9"
                        >
                          <ChevronLeft size={15} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => layout.move(key, 1)}
                          disabled={index === layout.order.length - 1}
                          aria-label={`Move ${column.header} right`}
                          className="focus-ring grid h-11 w-11 place-items-center rounded-md text-ink-3 hover:bg-white hover:text-brand-600 disabled:opacity-30 sm:h-9 sm:w-9"
                        >
                          <ChevronRight size={15} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
