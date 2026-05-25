import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type OrderVolumePoint = {
  day: string;
  total: number;
  awaiting: number;
  shipped: number;
  cancelled: number;
};

export type ChannelMixPoint = {
  name: string;
  count: number;
  color: string;
};

const axisColor = '#738399';
const gridColor = '#dbe6ef';
const brandBlue = '#03b0f7';

function shortDay(day: string) {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day.slice(5);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function OrderVolumeChart({ data }: { data: OrderVolumePoint[] }) {
  const hasData = data.some((point) => point.total > 0 || point.awaiting > 0 || point.shipped > 0);
  if (!hasData) {
    return (
      <div className="portal-chart-empty">
        <span>No orders in the selected range</span>
        <small>Orders placed today will appear here automatically.</small>
      </div>
    );
  }

  return (
    <div className="portal-chart-inner" aria-label="Orders volume chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 18, right: 22, bottom: 8, left: -8 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fill: axisColor, fontSize: 11, fontWeight: 700 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: axisColor, fontSize: 11, fontWeight: 700 }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip contentStyle={{ border: `1px solid ${gridColor}`, borderRadius: 8, boxShadow: '0 14px 34px rgba(18, 40, 63, .12)' }} />
          <Line type="linear" dataKey="total" name="Total orders" stroke={brandBlue} strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          <Line type="linear" dataKey="shipped" name="Shipped" stroke="#22c55e" strokeWidth={2} dot={false} />
          <Line type="linear" dataKey="awaiting" name="Awaiting" stroke="#f59e0b" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChannelMixChart({ data }: { data: ChannelMixPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="portal-chart-empty">
        <span>No channel data yet</span>
        <small>Connected store order activity will appear here.</small>
      </div>
    );
  }

  return (
    <div className="portal-chart-inner" aria-label="Channel mix chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 20, right: 26, bottom: 12, left: 16 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fill: axisColor, fontSize: 11, fontWeight: 700 }} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tick={{ fill: axisColor, fontSize: 11, fontWeight: 800 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip cursor={{ fill: 'rgba(3, 176, 247, .08)' }} contentStyle={{ border: `1px solid ${gridColor}`, borderRadius: 8 }} />
          <Bar dataKey="count" name="Orders" radius={[0, 8, 8, 0]} barSize={22}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
