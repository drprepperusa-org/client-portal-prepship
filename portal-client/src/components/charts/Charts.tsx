import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { CHART_COLORS } from '@/lib/accents';

const AXIS = { fontSize: 12, fill: '#64748B' };
const tooltipStyle = {
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.7)',
  background: 'rgba(255,255,255,0.9)',
  backdropFilter: 'blur(12px)',
  boxShadow: '0 8px 32px rgba(31,41,99,0.14)',
  fontSize: 13,
};

/** Custom tooltip for the cumulative orders/units bar: always reports the real
 *  Orders count and Unit count, never the internal continuation delta. */
function OrdersUnitsTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ payload: { orders: number; units: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div style={tooltipStyle as CSSProperties} className="px-3 py-2">
      <div className="mb-1 font-medium text-ink-2">{label}</div>
      <div style={{ color: '#03A9F4' }}>Orders count: {Number(row.orders).toLocaleString()}</div>
      <div style={{ color: '#14B8A6' }}>Unit count: {Number(row.units).toLocaleString()}</div>
    </div>
  );
}

/**
 * Cumulative (NOT additive) orders-vs-units bar chart. Each day stacks an
 * "Orders count" segment up to the order count, then a continuation segment of
 * only the EXTRA units beyond that (`unitDelta = max(0, units - orders)`), so
 * the bar top lands at the true unit count — a day with 20 orders / 25 units
 * tops out at 25, never 45. When units < orders the continuation is 0 and the
 * tooltip still reports the accurate raw values.
 */
/** Recharts passes the chart state + native event to onClick; we only need the
 *  active day label and the cursor position (to grow the day modal from it). */
type BarClickState = { activeLabel?: string | number };
export type DaySelect = (day: string, point?: { x: number; y: number }) => void;
function dayClickHandler(onSelectDay?: DaySelect) {
  return (state: BarClickState, e: ReactMouseEvent) => {
    const day = state?.activeLabel;
    if (day != null && onSelectDay) onSelectDay(String(day), e ? { x: e.clientX, y: e.clientY } : undefined);
  };
}
const mmdd = (d: string | number) => String(d).slice(5);

export function OrdersUnitsBarChart({ data, onSelectDay }: { data: { day: string; orders: number; units: number }[]; onSelectDay?: DaySelect }) {
  const rows = data.map((d) => ({ ...d, unitDelta: Math.max(0, Number(d.units) - Number(d.orders)) }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={rows} accessibilityLayer={false} margin={{ left: -10, right: 6, top: 6 }} onClick={dayClickHandler(onSelectDay)} className={onSelectDay ? 'cursor-pointer' : undefined}>
        <defs>
          <linearGradient id="gOuOrders" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4FC3F7" />
            <stop offset="100%" stopColor="#03A9F4" />
          </linearGradient>
          <linearGradient id="gOuUnits" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2DD4BF" />
            <stop offset="100%" stopColor="#14B8A6" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.14)" vertical={false} />
        <XAxis dataKey="day" tickFormatter={mmdd} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={<OrdersUnitsTooltip />} cursor={{ fill: 'rgba(3, 169, 244,0.06)' }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="orders" name="Orders count" stackId="ou" fill="url(#gOuOrders)" maxBarSize={42} />
        <Bar dataKey="unitDelta" name="Unit count" stackId="ou" fill="url(#gOuUnits)" radius={[8, 8, 0, 0]} maxBarSize={42} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function VolumeBarChart({ data, onSelectDay }: { data: { day: string; vol: number }[]; onSelectDay?: DaySelect }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} accessibilityLayer={false} margin={{ left: -10, right: 6, top: 6 }} onClick={dayClickHandler(onSelectDay)} className={onSelectDay ? 'cursor-pointer' : undefined}>
        <defs>
          <linearGradient id="gBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4FC3F7" />
            <stop offset="100%" stopColor="#03A9F4" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.14)" vertical={false} />
        <XAxis dataKey="day" tickFormatter={mmdd} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(3, 169, 244,0.06)' }} />
        <Bar dataKey="vol" fill="url(#gBar)" radius={[8, 8, 0, 0]} maxBarSize={42} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HBarChart({ data }: { data: { name: string; units: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} accessibilityLayer={false} layout="vertical" margin={{ left: 24, right: 12, top: 6 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.14)" horizontal={false} />
        <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" tick={AXIS} axisLine={false} tickLine={false} width={92} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(20,184,166,0.06)' }} />
        <Bar dataKey="units" radius={[0, 8, 8, 0]} maxBarSize={26}>
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SpendPieChart({ data }: { data: { name: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart accessibilityLayer={false}>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={3} stroke="none">
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => `$${Number(v ?? 0).toLocaleString()}`} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Multi-line "Daily Units Sold — Top SKUs": one line per SKU across the date range. */
export function TopSkuTrendChart({ data, skus }: { data: Array<Record<string, number | string>>; skus: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} accessibilityLayer={false} margin={{ left: -12, right: 8, top: 6 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.14)" vertical={false} />
        <XAxis dataKey="day" tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
        {skus.map((sku, i) => (
          <Line key={sku} type="monotone" dataKey={sku} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function RateLineChart({ data }: { data: { week: string; rate: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} accessibilityLayer={false} margin={{ left: -10, right: 8, top: 6 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.14)" vertical={false} />
        <XAxis dataKey="week" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis domain={[92, 100]} tick={AXIS} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v ?? 0)}%`} />
        <Line type="monotone" dataKey="rate" stroke="#F43F5E" strokeWidth={3} dot={{ r: 4, fill: '#F43F5E' }} activeDot={{ r: 6 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
