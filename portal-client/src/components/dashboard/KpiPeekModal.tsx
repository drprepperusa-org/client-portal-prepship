import { useEffect, useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ShoppingCart, Truck, Boxes, Wallet, X, ArrowRight, Inbox, MousePointerClick, type LucideIcon } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
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

const PANEL_W = 540;

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

export function CountUp({ value, active, format }: { value: number; active: boolean; format: (n: number) => string }) {
  const v = useCountUp(value, active);
  return <>{format(v)}</>;
}

/* ───────────────────── interactive trend chart (bigger + clickable) ───────────────────── */

export interface ChartPoint {
  day: string; // YYYY-MM-DD
  label: string; // MM-DD
  value: number;
}

export function niceDate(day: string) {
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Bigger area chart with on-chart indicators: dots, a hover crosshair/tooltip,
 *  and click-to-pin — selecting a day surfaces a detail readout below. */
function PeekChart({ data, color, format }: { data: ChartPoint[]; color: string; format: (n: number) => string }) {
  const id = useId();
  const [sel, setSel] = useState<ChartPoint | null>(null);
  const values = data.map((d) => d.value);
  const total = values.reduce((n, v) => n + v, 0);
  const avg = values.length ? total / values.length : 0;

  const pick = (state: { activePayload?: Array<{ payload?: ChartPoint }> } | null) => {
    const p = state?.activePayload?.[0]?.payload;
    if (p) setSel((cur) => (cur?.day === p.day ? null : p));
  };

  const share = sel && total > 0 ? (sel.value / total) * 100 : 0;
  const vsAvg = sel && avg > 0 ? ((sel.value - avg) / avg) * 100 : 0;

  return (
    <div className="rounded-glass-sm bg-white/45 p-3 ring-1 ring-slate-200/60">
      <ResponsiveContainer width="100%" height={172}>
        <AreaChart data={data} margin={{ left: -22, right: 6, top: 6, bottom: 0 }} onClick={pick} style={{ cursor: 'pointer' }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.14)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} minTickGap={22} />
          <YAxis tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} width={44} allowDecimals={false} />
          <Tooltip
            cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: '4 4' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as ChartPoint;
              return (
                <div className="rounded-lg border border-white/70 bg-white/90 px-3 py-2 text-xs shadow-glass backdrop-blur">
                  <p className="font-semibold text-ink">{niceDate(p.day)}</p>
                  <p style={{ color }} className="mt-0.5 font-bold tnum">{format(p.value)}</p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2.5}
            fill={`url(#${id})`}
            dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
            activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
            isAnimationActive
            animationDuration={650}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Click-to-detail readout */}
      <AnimatePresence mode="wait">
        {sel ? (
          <motion.div
            key={sel.day}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-white/60 px-3 py-2 ring-1 ring-slate-200/70"
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-ink">{niceDate(sel.day)}</p>
              <p style={{ color }} className="font-display text-lg font-bold tnum">{format(sel.value)}</p>
            </div>
            <div className="flex shrink-0 gap-2 text-right">
              <div className="rounded-md bg-white/70 px-2 py-1 ring-1 ring-slate-200/70">
                <p className="text-[10px] uppercase tracking-wide text-ink-3">Share</p>
                <p className="text-xs font-semibold text-ink tnum">{share.toFixed(0)}%</p>
              </div>
              <div className="rounded-md bg-white/70 px-2 py-1 ring-1 ring-slate-200/70">
                <p className="text-[10px] uppercase tracking-wide text-ink-3">vs avg</p>
                <p className={cn('text-xs font-semibold tnum', vsAvg >= 0 ? 'text-emerald-600' : 'text-rose-500')}>
                  {vsAvg >= 0 ? '+' : ''}{vsAvg.toFixed(0)}%
                </p>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.p
            key="hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-ink-3"
          >
            <MousePointerClick size={13} /> Tap any day for detail
          </motion.p>
        )}
      </AnimatePresence>
    </div>
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
  series: ChartPoint[];
  trendLabel: string;
  cta: { label: string; to: string };
  body: ReactNode;
}

const int = (n: number) => Math.round(n).toLocaleString();
const sum = (a: number[]) => a.reduce((n, v) => n + v, 0);
const peak = (a: number[]) => (a.length ? Math.max(...a) : 0);
const toSeries = <T extends { day: string }>(rows: T[], val: (r: T) => number): ChartPoint[] =>
  rows.map((r) => ({ day: r.day, label: r.day.slice(5), value: val(r) }));

function buildConfig(peek: PeekKey, d: KpiPeekData): PeekConfig {
  const ACC = (a: Accent) => ACCENTS[a].solid;
  switch (peek) {
    case 'open': {
      const series = toSeries(d.counts, (c) => c.awaiting);
      return {
        label: 'Open orders', icon: ShoppingCart, accent: 'indigo', value: d.openOrders, format: int,
        sub: 'Awaiting shipment right now', series, trendLabel: `New awaiting / day (last ${d.days})`,
        cta: { label: 'Go to Orders', to: '/orders' },
        body: <PeekSection title="Next to ship"><OpenOrdersPeek /></PeekSection>,
      };
    }
    case 'shipped': {
      const series = toSeries(d.counts, (c) => c.shipped);
      const vals = series.map((s) => s.value);
      const total = sum(vals);
      const orders = sum(d.counts.map((c) => c.total));
      return {
        label: 'Shipped', icon: Truck, accent: 'teal', value: total, format: int,
        sub: `Last ${d.days} days`, series, trendLabel: `Shipped / day`,
        cta: { label: 'Go to Shipments', to: '/shipments' },
        body: (
          <PeekSection title="At a glance">
            <div className="grid grid-cols-3 gap-2">
              <StatChip label="Peak day" value={int(peak(vals))} />
              <StatChip label="Avg / day" value={int(vals.length ? total / vals.length : 0)} />
              <StatChip label="Orders" value={int(orders)} />
            </div>
          </PeekSection>
        ),
      };
    }
    case 'units': {
      const series = toSeries(d.daily, (x) => x.units);
      const total = d.units;
      const top = [...d.bySku].sort((a, b) => b.units30 - a.units30).slice(0, 5);
      const max = peak(top.map((s) => s.units30));
      return {
        label: 'Units shipped', icon: Boxes, accent: 'amber', value: total, format: int,
        sub: `Last ${d.days} days`, series, trendLabel: `Units / day`,
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
      const series = toSeries(d.dailyRevenue, (x) => x.revenue);
      const vals = series.map((s) => s.value);
      const orders = sum(d.counts.map((c) => c.total));
      const aov = orders > 0 ? d.revenue / orders : 0;
      const top = [...d.bySku].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
      const max = peak(top.map((s) => s.revenue));
      const hidden = d.revenue === 0 && vals.every((v) => v === 0);
      return {
        label: 'Revenue', icon: Wallet, accent: 'emerald', value: d.revenue, format: money,
        sub: `Last ${d.days} days`, series, trendLabel: `Revenue / day`,
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
                <StatChip label="Peak day" value={money(peak(vals))} />
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
