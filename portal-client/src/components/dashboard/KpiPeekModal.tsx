import { useEffect, useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ShoppingCart, Truck, Boxes, Wallet, X, ArrowRight, Inbox, type LucideIcon } from 'lucide-react';
import { AnimatedIcon } from '@/components/ui/AnimatedIcon';
import { useOrders } from '@/lib/hooks';
import { itemCount, money, shortDate } from '@/lib/status';
import { ACCENTS, type Accent } from '@/lib/accents';
import { liquidSpring, staggerContainer, staggerItem } from '@/lib/motion';
import { cn } from '@/lib/cn';

export type PeekKey = 'open' | 'shipped' | 'units' | 'revenue';

export interface KpiPeekData {
  days: number;
  openOrders: number;
  units: number;
  revenue: number;
  counts: Array<{ day: string; awaiting: number; shipped: number; cancelled: number; total: number }>;
  daily: Array<{ day: string; orders: number; units: number }>;
  dailyRevenue: Array<{ day: string; revenue: number }>;
  bySku: Array<{ sku: string; units30: number; revenue: number; avgShippingPrice: number | null }>;
}

const PANEL_W = 480;

/* ───────────────────────── count-up headline ───────────────────────── */

function useCountUp(target: number, active: boolean, duration = 720) {
  const reduce = useReducedMotion();
  const [val, setVal] = useState(target);
  useEffect(() => {
    if (!active) return;
    if (reduce) {
      setVal(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setVal(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, reduce, duration]);
  return val;
}

function CountUp({ value, active, format }: { value: number; active: boolean; format: (n: number) => string }) {
  const v = useCountUp(value, active);
  return <>{format(v)}</>;
}

/* ───────────────────────── self-drawing sparkline ───────────────────────── */

function Sparkline({ values, color, height = 60 }: { values: number[]; color: string; height?: number }) {
  const reduce = useReducedMotion();
  const id = useId();
  const w = 100;
  const h = height;
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = n <= 1 ? 0 : (i / (n - 1)) * w;
    const y = h - (Math.max(0, v) / max) * (h - 6) - 3;
    return [x, y] as const;
  });
  if (!pts.length) pts.push([0, h - 3], [w, h - 3]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <motion.path d={area} fill={`url(#${id})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18, duration: 0.4 }} />
      <motion.path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={reduce ? undefined : { pathLength: 0 }}
        animate={reduce ? undefined : { pathLength: 1 }}
        transition={{ duration: 0.72, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}

/* ───────────────────────── small building blocks ───────────────────────── */

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <motion.div variants={staggerItem} className="rounded-glass-sm bg-white/55 px-3 py-2 ring-1 ring-slate-200/70">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className="mt-0.5 font-display text-base font-bold text-ink tnum">{value}</p>
    </motion.div>
  );
}

function SkuBar({ sku, value, max, color, display }: { sku: string; value: number; max: number; color: string; display: string }) {
  const pct = max > 0 ? Math.max(3, (value / max) * 100) : 0;
  return (
    <motion.div variants={staggerItem} className="flex items-center gap-3">
      <span className="w-24 shrink-0 truncate font-mono text-[12px] text-ink-2" title={sku}>{sku}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ ...liquidSpring, delay: 0.12 }}
        />
      </div>
      <span className="w-16 shrink-0 text-right text-[12px] font-semibold text-ink tnum">{display}</span>
    </motion.div>
  );
}

function PeekSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <motion.div variants={staggerItem}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{title}</p>
      {children}
    </motion.div>
  );
}

/* ───────────────────────── live open-orders list ───────────────────────── */

function OpenOrdersPeek() {
  const q = useOrders({ status: 'awaiting_shipment', pageSize: 6 });
  const rows = (q.data?.data ?? []).slice(0, 6);
  if (q.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-glass-sm bg-slate-100/80" />
        ))}
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="grid place-items-center gap-2 rounded-glass-sm bg-white/40 py-7 text-center ring-1 ring-slate-200/60">
        <Inbox size={22} className="text-ink-3" />
        <p className="text-sm text-ink-3">No orders awaiting shipment 🎉</p>
      </div>
    );
  }
  return (
    <motion.ul variants={staggerContainer} initial="initial" animate="enter" className="space-y-2">
      {rows.map((o) => (
        <motion.li
          key={o.id}
          variants={staggerItem}
          className="flex items-center gap-3 rounded-glass-sm bg-white/55 px-3 py-2.5 ring-1 ring-slate-200/70 transition-colors hover:bg-white/80"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-50 text-[11px] font-bold text-amber-600 ring-1 ring-amber-200">
            {itemCount(o.items)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-brand-700">{o.orderNumber ?? `#${o.id}`}</p>
            <p className="truncate text-xs text-ink-3">{o.clientName ?? '—'}</p>
          </div>
          <span className="shrink-0 text-xs text-ink-3 tnum">{shortDate(o.orderDate)}</span>
        </motion.li>
      ))}
    </motion.ul>
  );
}

/* ───────────────────────── per-metric peek config ───────────────────────── */

interface PeekConfig {
  label: string;
  icon: LucideIcon;
  accent: Accent;
  value: number;
  format: (n: number) => string;
  sub: string;
  trend: number[];
  trendLabel: string;
  cta: { label: string; to: string };
  body: ReactNode;
}

const int = (n: number) => Math.round(n).toLocaleString();
const sum = (a: number[]) => a.reduce((n, v) => n + v, 0);
const peak = (a: number[]) => (a.length ? Math.max(...a) : 0);

function buildConfig(peek: PeekKey, d: KpiPeekData): PeekConfig {
  const ACC = (a: Accent) => ACCENTS[a].solid;
  switch (peek) {
    case 'open': {
      const trend = d.counts.map((c) => c.awaiting);
      return {
        label: 'Open orders', icon: ShoppingCart, accent: 'indigo', value: d.openOrders, format: int,
        sub: 'Awaiting shipment right now', trend, trendLabel: `New awaiting / day (last ${d.days})`,
        cta: { label: 'Go to Orders', to: '/orders' },
        body: <PeekSection title="Next to ship"><OpenOrdersPeek /></PeekSection>,
      };
    }
    case 'shipped': {
      const trend = d.counts.map((c) => c.shipped);
      const total = sum(trend);
      const orders = sum(d.counts.map((c) => c.total));
      return {
        label: 'Shipped', icon: Truck, accent: 'teal', value: total, format: int,
        sub: `Last ${d.days} days`, trend, trendLabel: `Shipped / day`,
        cta: { label: 'Go to Shipments', to: '/shipments' },
        body: (
          <PeekSection title="At a glance">
            <div className="grid grid-cols-3 gap-2">
              <StatChip label="Peak day" value={int(peak(trend))} />
              <StatChip label="Avg / day" value={int(trend.length ? total / trend.length : 0)} />
              <StatChip label="Orders" value={int(orders)} />
            </div>
          </PeekSection>
        ),
      };
    }
    case 'units': {
      const trend = d.daily.map((x) => x.units);
      const total = d.units;
      const top = [...d.bySku].sort((a, b) => b.units30 - a.units30).slice(0, 5);
      const max = peak(top.map((s) => s.units30));
      return {
        label: 'Units shipped', icon: Boxes, accent: 'amber', value: total, format: int,
        sub: `Last ${d.days} days`, trend, trendLabel: `Units / day`,
        cta: { label: 'Go to Analysis', to: '/analysis' },
        body: (
          <PeekSection title="Top SKUs by units">
            {top.length ? (
              <div className="space-y-2.5">
                {top.map((s) => <SkuBar key={s.sku} sku={s.sku} value={s.units30} max={max} color={ACC('amber')} display={int(s.units30)} />)}
              </div>
            ) : <p className="text-sm text-ink-3">No SKU activity yet.</p>}
          </PeekSection>
        ),
      };
    }
    case 'revenue':
    default: {
      const trend = d.dailyRevenue.map((x) => x.revenue);
      const orders = sum(d.counts.map((c) => c.total));
      const aov = orders > 0 ? d.revenue / orders : 0;
      const top = [...d.bySku].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
      const max = peak(top.map((s) => s.revenue));
      const hidden = d.revenue === 0 && trend.every((v) => v === 0);
      return {
        label: 'Revenue', icon: Wallet, accent: 'emerald', value: d.revenue, format: money,
        sub: `Last ${d.days} days`, trend, trendLabel: `Revenue / day`,
        cta: { label: 'Go to Finance', to: '/finance' },
        body: hidden ? (
          <PeekSection title="Top SKUs by revenue">
            <p className="rounded-glass-sm bg-white/40 px-3 py-6 text-center text-sm text-ink-3 ring-1 ring-slate-200/60">
              Revenue is hidden for this view.
            </p>
          </PeekSection>
        ) : (
          <>
            <PeekSection title="At a glance">
              <div className="grid grid-cols-2 gap-2">
                <StatChip label="Avg order value" value={money(aov)} />
                <StatChip label="Peak day" value={money(peak(trend))} />
              </div>
            </PeekSection>
            <PeekSection title="Top SKUs by revenue">
              {top.length ? (
                <div className="space-y-2.5">
                  {top.map((s) => <SkuBar key={s.sku} sku={s.sku} value={s.revenue} max={max} color={ACC('emerald')} display={money(s.revenue)} />)}
                </div>
              ) : <p className="text-sm text-ink-3">No SKU revenue yet.</p>}
            </PeekSection>
          </>
        ),
      };
    }
  }
}

/* ───────────────────────── the modal ───────────────────────── */

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
                  <div className="rounded-glass-sm bg-white/45 p-3 ring-1 ring-slate-200/60">
                    <Sparkline values={cfg.trend} color={ACCENTS[cfg.accent].solid} />
                  </div>
                </PeekSection>
                {cfg.body}
              </motion.div>

              {/* Footer CTA */}
              <div className="border-t border-white/60 p-3">
                <button
                  onClick={() => { onNavigate(cfg.cta.to); onClose(); }}
                  className={cn('focus-ring group flex w-full items-center justify-center gap-2 rounded-glass-sm bg-gradient-to-br px-4 py-2.5 text-sm font-semibold text-white shadow-glass transition-opacity hover:opacity-95', ACCENTS[cfg.accent].grad)}
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
