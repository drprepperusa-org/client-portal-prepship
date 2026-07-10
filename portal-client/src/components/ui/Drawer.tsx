import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { useDialogFocus } from './useDialogFocus';

export function Drawer({ open, onClose, title, children, width = 480 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number }) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  useDialogFocus(open, onClose, panelRef);

  // Portal to <body> so the fixed overlay isn't trapped by a transformed/
  // filtered page ancestor (the route-transition wrapper sets `filter`).
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden="true" className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm" />
          <motion.aside
            ref={panelRef}
            initial={reduceMotion ? false : { x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 34 }}
            style={{ width: `min(${width}px, 94vw)` }}
            className="glass-strong fixed right-0 top-0 z-50 flex h-full flex-col rounded-l-glass shadow-glass-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
          >
            <header className="flex items-center justify-between border-b border-white/60 px-5 py-4">
              <h2 id={titleId} className="font-display text-base font-semibold text-ink">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close panel"
                className="focus-ring grid h-11 w-11 cursor-pointer place-items-center rounded-lg text-ink-3 transition-colors hover:bg-slate-100 hover:text-ink sm:h-8 sm:w-8"
              >
                <X size={18} />
              </button>
            </header>
            <div className="flex-1 overflow-auto p-5">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
