import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X, ArrowRight } from 'lucide-react';
import { AnimatedIcon } from '@/components/ui/AnimatedIcon';
import { ACCENTS } from '@/lib/accents';
import { liquidSpring, staggerContainer } from '@/lib/motion';
import { cn } from '@/lib/cn';
import type { PeekKey, KpiPeekData } from './peek/types';
import { CountUp, PeekSection } from './peek/atoms';
import { PeekChart } from './peek/PeekChart';
import { buildConfig } from './peek/buildConfig';

// Re-exported so consumers keep importing from the modal module.
export type { PeekKey, KpiPeekData } from './peek/types';
export { CountUp, niceDate } from './peek/atoms';

const PANEL_W = 540;

function originTransform(rect: DOMRect | null, reduce: boolean | null) {
  if (!rect || reduce) return { x: 0, y: 0, scale: 0.96 };
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return {
    x: cx - window.innerWidth / 2,
    y: cy - window.innerHeight / 2,
    scale: Math.min(0.9, Math.max(0.25, rect.width / PANEL_W)),
  };
}

export function KpiPeekModal({
  peek,
  origin,
  data,
  onClose,
  onNavigate,
}: {
  peek: PeekKey | null;
  origin: DOMRect | null;
  data: KpiPeekData;
  onClose: () => void;
  onNavigate: (to: string) => void;
}) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!peek) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [peek, onClose]);

  const cfg = peek ? buildConfig(peek, data) : null;
  const from = originTransform(origin, reduce);

  return createPortal(
    <AnimatePresence>
      {peek && cfg && (
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
              initial={{ opacity: 0, x: from.x, y: from.y, scale: from.scale }}
              animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: from.x, y: from.y, scale: from.scale }}
              transition={reduce ? { duration: 0.18 } : liquidSpring}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: PANEL_W }}
              className="glass-strong flex max-h-[88vh] w-full flex-col overflow-hidden rounded-glass shadow-glass-lg"
              role="dialog"
              aria-modal="true"
              aria-label={cfg.label}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 px-5 pt-5">
                <div className="flex items-center gap-3">
                  <AnimatedIcon icon={cfg.icon} accent={cfg.accent} tile />
                  <div>
                    <p className="text-sm font-medium text-ink-3">{cfg.label}</p>
                    <p className={cn('bg-gradient-to-br bg-clip-text font-display text-3xl font-bold tracking-tight text-transparent tnum', ACCENTS[cfg.accent].grad)}>
                      <CountUp value={cfg.value} active={!!peek} format={cfg.format} />
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="focus-ring grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-3 transition-colors hover:bg-slate-100 hover:text-ink"
                >
                  <X size={18} />
                </button>
              </div>
              <p className="px-5 text-xs text-ink-3/90">{cfg.sub}</p>

              {/* Body */}
              <motion.div variants={staggerContainer} initial="initial" animate="enter" className="flex-1 space-y-4 overflow-y-auto px-5 pb-2 pt-4">
                <PeekSection title={cfg.trendLabel}>
                  <PeekChart data={cfg.series} color={ACCENTS[cfg.accent].solid} format={cfg.format} />
                </PeekSection>
                {cfg.body}
              </motion.div>

              {/* Footer CTA */}
              <div className="border-t border-white/60 p-3">
                <button
                  onClick={() => {
                    onNavigate(cfg.cta.to);
                    onClose();
                  }}
                  className={cn(
                    'focus-ring group flex w-full items-center justify-center gap-2 rounded-glass-sm',
                    'bg-gradient-to-br px-4 py-2.5 text-sm font-semibold text-white shadow-glass',
                    'transition-opacity hover:opacity-95',
                    ACCENTS[cfg.accent].grad,
                  )}
                >
                  {cfg.cta.label}
                  <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
