import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export function Drawer({ open, onClose, title, children, width = 480 }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; width?: number }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Portal to <body> so the fixed overlay isn't trapped by a transformed/
  // filtered page ancestor (the route-transition wrapper sets `filter`).
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm" />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            style={{ width: `min(${width}px, 94vw)` }}
            className="glass-strong fixed right-0 top-0 z-50 flex h-full flex-col rounded-l-glass shadow-glass-lg"
            role="dialog"
            aria-modal="true"
          >
            <header className="flex items-center justify-between border-b border-white/60 px-5 py-4">
              <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
              <button onClick={onClose} aria-label="Close panel" className="focus-ring cursor-pointer rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-slate-100 hover:text-ink">
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
