import { useId, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface FieldShellProps {
  label?: string;
  helper?: string;
  error?: string;
  success?: string;
  required?: boolean;
  className?: string;
  children: (id: string, describedBy: string | undefined, invalid: boolean) => ReactNode;
}

/** Shared label / helper / error scaffold for every input. */
export function FieldShell({
  label,
  helper,
  error,
  success,
  required,
  className,
  children,
}: FieldShellProps) {
  const id = useId();
  const msgId = `${id}-msg`;
  const invalid = Boolean(error);
  const describedBy = error || helper || success ? msgId : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">
          {label}
          {required && <span className="ml-0.5 text-rose-500">*</span>}
        </label>
      )}
      {children(id, describedBy, invalid)}
      <AnimatePresence mode="wait" initial={false}>
        {(error || success || helper) && (
          <motion.p
            key={error || success || helper}
            id={msgId}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className={cn(
              'flex items-center gap-1.5 text-xs',
              error ? 'text-rose-600' : success ? 'text-emerald-600' : 'text-ink-3',
            )}
          >
            {error && <AlertCircle size={13} />}
            {!error && success && <CheckCircle2 size={13} />}
            {error || success || helper}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Shared base input ring/glass styles. */
export function inputClasses(invalid: boolean, hasLeadingIcon = false, hasTrailingIcon = false) {
  return cn(
    'w-full rounded-glass-sm bg-white/70 text-[15px] text-ink placeholder:text-slate-400',
    'border backdrop-blur-sm transition-[border-color,box-shadow,background] duration-200',
    'focus:bg-white/90 focus:outline-none',
    'disabled:cursor-not-allowed disabled:bg-slate-100/60 disabled:text-slate-400',
    'h-11 px-3.5',
    hasLeadingIcon && 'pl-10',
    hasTrailingIcon && 'pr-10',
    invalid
      ? 'border-rose-300 focus:border-rose-400 focus:shadow-[0_0_0_3px_rgba(244,63,94,0.18)]'
      : 'border-white/80 ring-1 ring-slate-200/70 focus:border-brand-400 focus:shadow-[0_0_0_3px_rgba(3, 169, 244,0.18)]',
  );
}
