import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ShoppingCart, Truck, X, ArrowRight, Package, Boxes, Clock, CheckCircle2, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AnimatedIcon } from '@/components/ui/AnimatedIcon';
import { CountUp, niceDate } from './KpiPeekModal';
import { ACCENTS, type Accent } from '@/lib/accents';
import { liquidSpring, staggerContainer, staggerItem } from '@/lib/motion';
import { cn } from '@/lib/cn';
import type { DashboardSummary } from '@/lib/api';

export type DayPeekSource = 'orders' | 'shipments';

const PANEL_W = 460;
const int = (n: number) => Math.round(n).toLocaleString();
const dec1 = (n: number) => n.toFixed(1);

function pointTransform(p: { x: number; y: number } | null | undefined, reduce: boolean | null) {
  if (!p || reduce) return { x: 0, y: 0, scale: 0.95 };
  return { x: p.x - window.innerWidth / 2, y: p.y - window.innerHeight / 2, scale: 0.35 };
}

function Tile({ icon: Icon, label, value, active, accent, format = int }: { icon: LucideIcon; label: string; value: number; active: boolean; accent?: Accent; format?: (n: number) => string }) {
  return (
    <motion.div variants={staggerItem} className="rounded-glass-sm bg-white/55 px-3 py-2.5 ring-1 ring-slate-200/70">
      <div className="flex items-center gap-1.5 text-ink-3">
        <Icon size={13} className={accent ? ACCENTS[accent].text : undefined} />
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1 font-display text-xl font-bold text-ink tnum">
        <CountUp value={value} active={active} format={format} />
      </p>
    </motion.div>
  );
}

function Insight({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <motion.div variants={staggerItem} className="rounded-lg bg-white/60 px-2.5 py-1.5 text-center ring-1 ring-slate-200/70">
      <p className="text-[10px] uppercase tracking-wide text-ink-3">{label}</p>
      <p className={cn('text-sm font-bold tnum', tone === 'up' && 'text-emerald-600', tone === 'down' && 'text-rose-500', !tone && 'text-ink')}>{value}</p>
    </motion.div>
  );
}

export function ChartDayModal({
  day,
  source,
  origin,
  daily,
  onClose,
  onNavigate,
}: {
  day: string | null;
  source: DayPeekSource;
  origin?: { x: number; y: number } | null;
  daily: DashboardSummary['daily'];
  onClose: () => void;
  onNavigate: (to: string) => void;
}) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!day) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [day, onClose]);

  const selectedDay = day ? daily.find((row) => row.day === day) : undefined;
  const orders = selectedDay?.orderedOrders.value ?? 0;
  const units = selectedDay?.orderedUnits.value ?? 0;
  const shipped = selectedDay?.shippedOrders.value ?? 0;
  const awaiting = selectedDay?.awaitingOrders.value ?? 0;
  const cancelled = selectedDay?.cancelledOrders.value ?? 0;
  const shipmentsCount = selectedDay?.shipmentsCreated.value ?? 0;
  const unitsPerOrder = selectedDay?.unitsPerOrder ?? 0;

  // Period context for the metric this chart represents.
  const isOrders = source === 'orders';
  const accent: Accent = isOrders ? 'indigo' : 'teal';
  const icon: LucideIcon = isOrders ? ShoppingCart : Truck;
  const primaryValue = isOrders ? orders : shipmentsCount;
  const primaryLabel = isOrders ? 'orders' : 'shipments';
  const primaryMetric = isOrders ? selectedDay?.orderedOrders : selectedDay?.shipmentsCreated;
  const share = primaryMetric?.periodSharePercent ?? 0;
  const vsAvg = primaryMetric?.vsDailyAveragePercent ?? 0;
  const rank = primaryMetric?.busiestRank ?? 0;
  const periodDayCount = primaryMetric?.periodDayCount ?? 0;

  const from = pointTransform(origin, reduce);
  const grad = ACCENTS[accent].grad;

  return createPortal(
    <AnimatePresence>
      {day && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[70] bg-ink/40 backdrop-blur-sm" />
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
              aria-label={`${primaryLabel} detail for ${niceDate(day)}`}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 px-5 pt-5">
                <div className="flex items-center gap-3">
                  <AnimatedIcon icon={icon} accent={accent} tile />
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{niceDate(day)}</p>
                    <p className={cn('bg-gradient-to-br bg-clip-text font-display text-3xl font-bold tracking-tight text-transparent tnum', grad)}>
                      <CountUp value={primaryValue} active={!!day} format={int} />
                      <span className="ml-1.5 align-middle text-sm font-semibold text-ink-3">{primaryLabel}</span>
                    </p>
                  </div>
                </div>
                <button onClick={onClose} aria-label="Close" className="focus-ring grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-3 transition-colors hover:bg-slate-100 hover:text-ink">
                  <X size={18} />
                </button>
              </div>

              <motion.div variants={staggerContainer} initial="initial" animate="enter" className="flex-1 space-y-4 overflow-y-auto px-5 pb-2 pt-4">
                {/* Context insights */}
                <div className="grid grid-cols-3 gap-2">
                  <Insight label="Share of period" value={`${share.toFixed(0)}%`} />
                  <Insight label="vs daily avg" value={`${vsAvg >= 0 ? '+' : ''}${vsAvg.toFixed(0)}%`} tone={vsAvg >= 0 ? 'up' : 'down'} />
                  <Insight label="Busiest rank" value={`#${rank} of ${periodDayCount}`} />
                </div>

                {/* Order breakdown */}
                <motion.div variants={staggerItem}>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Orders that day</p>
                  <div className="grid grid-cols-3 gap-2">
                    <Tile icon={ShoppingCart} label="Orders" value={orders} active={!!day} accent="indigo" />
                    <Tile icon={Boxes} label="Units" value={units} active={!!day} accent="amber" />
                    <Tile icon={Package} label="Units / order" value={unitsPerOrder} active={!!day} format={dec1} />
                  </div>
                </motion.div>

                {/* Status + shipments */}
                <motion.div variants={staggerItem}>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Status &amp; fulfillment</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Tile icon={Clock} label="Awaiting" value={awaiting} active={!!day} accent="amber" />
                    <Tile icon={CheckCircle2} label="Shipped" value={shipped} active={!!day} accent="teal" />
                    <Tile icon={XCircle} label="Cancelled" value={cancelled} active={!!day} accent="rose" />
                    <Tile icon={Truck} label="Shipments" value={shipmentsCount} active={!!day} accent="teal" />
                  </div>
                </motion.div>
              </motion.div>

              {/* Footer */}
              <div className="border-t border-white/60 p-3">
                <button
                  onClick={() => { onNavigate(isOrders ? '/orders' : '/shipments'); onClose(); }}
                  className={cn('focus-ring group flex w-full items-center justify-center gap-2 rounded-glass-sm bg-gradient-to-br px-4 py-2.5 text-sm font-semibold text-white shadow-glass transition-opacity hover:opacity-95', grad)}
                >
                  {isOrders ? 'View Orders' : 'View Shipments'}
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
