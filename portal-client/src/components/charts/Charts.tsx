import {
  ResponsiveContainer,
  AreaChart,
  Area,
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

export function OrdersAreaChart({ data }: { data: { day: string; orders: number; shipped: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ left: -18, right: 6, top: 6 }}>
        <defs>
          <linearGradient id="gOrders" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#03A9F4" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#03A9F4" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gShipped" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#14B8A6" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#14B8A6" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.14)" vertical={false} />
        <XAxis dataKey="day" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Area type="monotone" dataKey="orders" stroke="#03A9F4" strokeWidth={2.5} fill="url(#gOrders)" />
        <Area type="monotone" dataKey="shipped" stroke="#14B8A6" strokeWidth={2.5} fill="url(#gShipped)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function VolumeBarChart({ data }: { data: { month: string; vol: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ left: -10, right: 6, top: 6 }}>
        <defs>
          <linearGradient id="gBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4FC3F7" />
            <stop offset="100%" stopColor="#03A9F4" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.14)" vertical={false} />
        <XAxis dataKey="month" tick={AXIS} axisLine={false} tickLine={false} />
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
      <BarChart data={data} layout="vertical" margin={{ left: 24, right: 12, top: 6 }}>
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
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={3} stroke="none">
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `$${v.toLocaleString()}`} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Multi-line "Daily Units Sold — Top SKUs": one line per SKU across the date range. */
export function TopSkuTrendChart({ data, skus }: { data: Array<Record<string, number | string>>; skus: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ left: -12, right: 8, top: 6 }}>
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
      <LineChart data={data} margin={{ left: -10, right: 8, top: 6 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.14)" vertical={false} />
        <XAxis dataKey="week" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis domain={[92, 100]} tick={AXIS} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v}%`} />
        <Line type="monotone" dataKey="rate" stroke="#F43F5E" strokeWidth={3} dot={{ r: 4, fill: '#F43F5E' }} activeDot={{ r: 6 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
