import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';
import { cn } from '@/lib/cn';

type ToastKind = 'success' | 'error' | 'info' | 'warning';
interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastApi {
  push: (t: Omit<Toast, 'id'>) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

const META: Record<ToastKind, { icon: typeof Info; color: string; ring: string }> = {
  success: { icon: CheckCircle2, color: 'text-emerald-600', ring: 'ring-emerald-200' },
  error: { icon: XCircle, color: 'text-rose-600', ring: 'ring-rose-200' },
  info: { icon: Info, color: 'text-brand-600', ring: 'ring-brand-200' },
  warning: { icon: AlertTriangle, color: 'text-amber-600', ring: 'ring-amber-200' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { ...t, id }]);
      window.setTimeout(() => remove(id), 4200);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (title, message) => push({ kind: 'success', title, message }),
      error: (title, message) => push({ kind: 'error', title, message }),
      info: (title, message) => push({ kind: 'info', title, message }),
      warning: (title, message) => push({ kind: 'warning', title, message }),
    }),
    [push],
  );

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[min(92vw,360px)] flex-col gap-3">
        <AnimatePresence>
          {toasts.map((t) => {
            const m = META[t.kind];
            const Icon = m.icon;
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, x: 40, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                className={cn('glass-strong pointer-events-auto flex items-start gap-3 rounded-glass-sm p-3.5 ring-1', m.ring)}
                role="status"
              >
                <Icon className={cn('mt-0.5 shrink-0', m.color)} size={20} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{t.title}</p>
                  {t.message && <p className="mt-0.5 text-[13px] text-ink-3">{t.message}</p>}
                </div>
                <button
                  onClick={() => remove(t.id)}
                  aria-label="Dismiss notification"
                  className="focus-ring -m-1 cursor-pointer rounded-md p-1 text-ink-3 transition-colors hover:text-ink"
                >
                  <X size={16} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
