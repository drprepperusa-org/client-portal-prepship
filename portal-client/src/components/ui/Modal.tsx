import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

/**
 * Centered modal dialog. Portalled to document.body so backdrop-filter / blur
 * ancestors can't trap its fixed positioning. Closes on backdrop click + Esc.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 560,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  maxWidth?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[70] bg-ink/40 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-[71] grid place-items-center p-4" onClick={onClose}>
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth }}
              className="glass-strong flex max-h-[88vh] w-full flex-col overflow-hidden rounded-glass shadow-glass-lg"
            >
              <div className="flex items-center justify-between gap-3 border-b border-white/60 px-5 py-4">
                <h2 className="truncate font-display text-base font-bold text-ink">{title}</h2>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="focus-ring grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-3 transition-colors hover:bg-slate-100 hover:text-ink"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="overflow-y-auto p-5">{children}</div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
