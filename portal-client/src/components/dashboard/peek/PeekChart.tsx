import { useId, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { MousePointerClick } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { cn } from '@/lib/cn';
import type { ChartPoint } from './types';
import { niceDate } from './atoms';
import { CHART_THEME } from '@/lib/accents';
import { ChartDataTable, ChartDaySelector } from '@/components/charts/ChartAccessibility';

/** Bigger area chart with on-chart indicators: dots, a hover crosshair/tooltip,
 *  and click-to-pin — selecting a day surfaces a detail readout below. */
export function PeekChart({ data, color, format }: { data: ChartPoint[]; color: string; format: (n: number) => string }) {
  const id = useId();
  const [sel, setSel] = useState<ChartPoint | null>(null);
  const reduceMotion = useReducedMotion();
  const values = data.map((d) => d.value);
  const total = values.reduce((n, v) => n + v, 0);
  const avg = values.length ? total / values.length : 0;

  /** Chart clicks carry the active index/label (Recharts 3 dropped the
   *  activePayload array from click state) — map back to our own data row. */
  const pick = (state: { activeTooltipIndex?: number | string | null; activeLabel?: string | number } | null) => {
    const raw = state?.activeTooltipIndex;
    const idx = raw == null || raw === '' ? NaN : Number(raw);
    const p = Number.isInteger(idx) ? data[idx] : data.find((d) => d.label === state?.activeLabel);
    if (p) setSel((cur) => (cur?.day === p.day ? null : p));
  };

  const share = sel && total > 0 ? (sel.value / total) * 100 : 0;
  const vsAvg = sel && avg > 0 ? ((sel.value - avg) / avg) * 100 : 0;

  return (
    <div role="group" aria-label="KPI trend by day" className="rounded-glass-sm bg-white/45 p-3 ring-1 ring-slate-200/60">
      <ResponsiveContainer width="100%" height={172}>
        <AreaChart data={data} accessibilityLayer margin={{ left: -22, right: 6, top: 6, bottom: 0 }} onClick={pick} style={{ cursor: 'pointer' }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_THEME.axis }} axisLine={false} tickLine={false} minTickGap={22} />
          <YAxis tick={{ fontSize: 11, fill: CHART_THEME.axis }} axisLine={false} tickLine={false} width={44} allowDecimals={false} />
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
            activeDot={{ r: 5, stroke: CHART_THEME.white, strokeWidth: 2 }}
            isAnimationActive={!reduceMotion}
            animationDuration={reduceMotion ? 0 : 650}
          />
        </AreaChart>
      </ResponsiveContainer>

      <ChartDaySelector
        days={data.map((point) => ({ day: point.day, label: niceDate(point.day) }))}
        onSelect={(day) => {
          const point = data.find((item) => item.day === day);
          if (point) setSel(point);
        }}
      />
      <ChartDataTable
        title="KPI trend by day"
        rows={data}
        columns={[
          { key: 'day', label: 'Day', render: (point) => niceDate(point.day) },
          { key: 'value', label: 'Value', render: (point) => format(point.value) },
        ]}
      />

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
