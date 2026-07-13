import type { ReactNode } from 'react';
import { ShoppingCart, Truck, Boxes, type LucideIcon } from 'lucide-react';
import { ACCENTS, type Accent } from '@/lib/accents';
import type { PeekKey, KpiPeekData, ChartPoint } from './types';
import { StatChip, SkuBar, PeekSection } from './atoms';
import { OpenOrdersPeek } from './OpenOrdersPeek';
import type { DashboardDailyMetric } from '@/lib/api';

export interface PeekConfig {
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
const toSeries = <T extends { day: string }>(
  rows: T[],
  metric: (row: T) => DashboardDailyMetric,
): ChartPoint[] => rows.map((row) => ({ day: row.day, label: row.day.slice(5), ...metric(row) }));

export function buildConfig(peek: PeekKey, d: KpiPeekData): PeekConfig {
  const ACC = (a: Accent) => ACCENTS[a].solid;
  switch (peek) {
    case 'open': {
      const series = toSeries(d.daily, (row) => row.awaitingOrders);
      return {
        label: 'Open orders',
        icon: ShoppingCart,
        accent: 'indigo',
        value: d.openOrders,
        format: int,
        sub: 'Awaiting shipment right now',
        series,
        trendLabel: `Awaiting status by order date (last ${d.days})`,
        cta: { label: 'Go to Orders', to: '/orders' },
        body: <PeekSection title="Next to ship"><OpenOrdersPeek /></PeekSection>,
      };
    }
    case 'shipped': {
      const series = toSeries(d.daily, (row) => row.shippedOrders);
      const total = d.period?.shippedOrderCount ?? 0;
      return {
        label: 'Shipped',
        icon: Truck,
        accent: 'teal',
        value: total,
        format: int,
        sub: `Last ${d.days} days`,
        series,
        trendLabel: 'Shipped status by order date',
        cta: { label: 'Go to Shipments', to: '/shipments' },
        body: (
          <PeekSection title="At a glance">
            <div className="grid grid-cols-3 gap-2">
              <StatChip label="Peak day" value={int(d.period?.peakShippedOrderCount ?? 0)} />
              <StatChip label="Avg / day" value={int(d.period?.averageShippedOrdersPerDay ?? 0)} />
              <StatChip label="Orders" value={int(d.period?.allOrderCount ?? 0)} />
            </div>
          </PeekSection>
        ),
      };
    }
    case 'units': {
      const series = toSeries(d.daily, (row) => row.orderedUnits);
      const total = d.units;
      const top = d.bySku.slice(0, 5);
      const max = Math.max(0, ...top.map((sku) => sku.units30));
      return {
        label: 'Ordered units',
        icon: Boxes,
        accent: 'amber',
        value: total,
        format: int,
        sub: `Last ${d.days} days`,
        series,
        trendLabel: 'Ordered units by order date',
        cta: { label: 'Go to Analysis', to: '/analysis' },
        body: (
          <PeekSection title="Top SKUs by units">
            {top.length ? (
              <div className="space-y-2.5">
                {top.map((s) => (
                  <SkuBar
                    key={s.sku}
                    sku={s.sku}
                    value={s.units30}
                    max={max}
                    color={ACC('amber')}
                    display={int(s.units30)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-3">No SKU activity yet.</p>
            )}
          </PeekSection>
        ),
      };
    }
  }
}
