import type { ReactNode } from 'react';
import { ShoppingCart, Truck, Boxes, type LucideIcon } from 'lucide-react';
import { ACCENTS, type Accent } from '@/lib/accents';
import type { PeekKey, KpiPeekData, ChartPoint } from './types';
import { StatChip, SkuBar, PeekSection } from './atoms';
import { OpenOrdersPeek } from './OpenOrdersPeek';

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
const sum = (a: number[]) => a.reduce((n, v) => n + v, 0);
const peak = (a: number[]) => (a.length ? Math.max(...a) : 0);
const toSeries = <T extends { day: string }>(rows: T[], val: (r: T) => number): ChartPoint[] =>
  rows.map((r) => ({ day: r.day, label: r.day.slice(5), value: val(r) }));

export function buildConfig(peek: PeekKey, d: KpiPeekData): PeekConfig {
  const ACC = (a: Accent) => ACCENTS[a].solid;
  switch (peek) {
    case 'open': {
      const series = toSeries(d.counts, (c) => c.awaiting);
      return {
        label: 'Open orders',
        icon: ShoppingCart,
        accent: 'indigo',
        value: d.openOrders,
        format: int,
        sub: 'Awaiting shipment right now',
        series,
        trendLabel: `New awaiting / day (last ${d.days})`,
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
        label: 'Shipped',
        icon: Truck,
        accent: 'teal',
        value: total,
        format: int,
        sub: `Last ${d.days} days`,
        series,
        trendLabel: 'Shipped / day',
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
      const top = d.bySku.slice(0, 5);
      const max = peak(top.map((s) => s.units30));
      return {
        label: 'Units shipped',
        icon: Boxes,
        accent: 'amber',
        value: total,
        format: int,
        sub: `Last ${d.days} days`,
        series,
        trendLabel: 'Units / day',
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
