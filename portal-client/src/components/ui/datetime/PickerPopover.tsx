import { useEffect, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/cn';

/**
 * Shared trigger + popover shell for the datetime picker family. Owns the
 * open/close chrome — click-outside and Escape dismiss, glass panel, entry
 * motion — so DatePicker / DateRangePicker / MonthPicker / TimePicker all
 * look and behave identically and only implement their picking surface.
 */
export function PickerPopover({
  label,
  icon,
  display,
  placeholder,
  open,
  onOpenChange,
  width = 300,
  disabled = false,
  className,
  children,
}: {
  label?: string;
  icon: ReactNode;
  display: string;
  placeholder: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  width?: number;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div className={cn('flex flex-col gap-1.5', className)} ref={ref}>
      {label && <span className="text-[13px] font-semibold text-ink-2">{label}</span>}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onOpenChange(!open)}
          className={cn(
            'focus-ring flex h-9 w-full cursor-pointer items-center gap-2 rounded-glass-sm border border-white/80 bg-white/60 px-2.5 text-left text-sm ring-1 ring-slate-200/70 transition-colors hover:bg-white/90',
            open && 'border-brand-400',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <span className="shrink-0 text-brand-500">{icon}</span>
          <span className={cn('truncate', display ? 'text-ink' : 'text-slate-400')}>{display || placeholder}</span>
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              style={{ width }}
              className="glass-strong absolute z-30 mt-2 rounded-glass-sm p-3 shadow-glass-lg"
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
