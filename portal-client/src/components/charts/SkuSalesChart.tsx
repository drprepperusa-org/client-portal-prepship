import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { CHART_THEME } from '@/lib/accents';
import { ChartDataTable } from './ChartAccessibility';

/** Presentation only: the Analysis SKU read model supplies the daily units. */
export default function SkuSalesChart({ data }: { data: Array<{ day: string; units: number }> }) {
  return (
    <figure aria-label="Units sold for selected SKU">
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} accessibilityLayer margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
          <XAxis
            dataKey="day"
            tick={{ fontSize: 10, fill: CHART_THEME.axis }}
            interval="preserveStartEnd"
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgb(var(--brand-rgb) / 0.06)' }}
            contentStyle={{
              borderRadius: 12,
              border: `1px solid ${CHART_THEME.tooltipBorder}`,
              background: CHART_THEME.tooltipBackground,
              fontSize: 12,
            }}
          />
          <Bar dataKey="units" fill={CHART_THEME.brand} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <ChartDataTable
        title="Units sold for selected SKU"
        rows={data}
        columns={[
          { key: 'day', label: 'Day', render: point => point.day },
          { key: 'units', label: 'Units', render: point => point.units.toLocaleString() },
        ]}
      />
    </figure>
  );
}
