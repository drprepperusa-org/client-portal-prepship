import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, Reorder } from 'framer-motion';
import { ShoppingCart, Truck, Boxes, Wallet, Inbox, Pencil, GripVertical, Eye, EyeOff, Check, RotateCcw, Columns2, Square, Info } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { StatCard } from '@/components/ui/StatCard';
import { Skeleton, EmptyState, Tooltip } from '@/components/ui/Display';
import { OrdersUnitsBarChart, VolumeBarChart } from '@/components/charts/Charts';
import { KpiPeekModal, type PeekKey } from '@/components/dashboard/KpiPeekModal';
import { ChartDayModal, type DayPeekSource } from '@/components/dashboard/ChartDayModal';
import { staggerContainer } from '@/lib/motion';
import { useDashboard, useDailyCounts, useDailyShipments, useAwaitingCount } from '@/lib/hooks';
import { usePortalFilters } from '@/lib/portalContext';
import { useAuth } from '@/auth';
import { money } from '@/lib/status';
import { cn } from '@/lib/cn';
import {
  loadLayout,
  saveLayout,
  DEFAULT_LAYOUT,
  WIDGET_LABELS,
  type DashLayout,
  type WidgetId,
  type WidgetWidth,
} from '@/lib/dashboardLayout';

/** Width class for a widget: half collapses to full below `lg` so it never gets
 *  cramped on small screens. gap-4 = 1rem, so half = (100% - gap) / 2. */
const widthClass = (w: WidgetWidth) => (w === 'half' ? 'w-full lg:w-[calc(50%-0.5rem)]' : 'w-full');

// Top SKUs column explainers — compact formulas (not prose), mirroring the
// backend-owned math in the canonical Analysis SKU query (see
// src/lib/client-portal/read-models/dashboard.ts → dashboardTopSkus). These are
// the SAME numbers the Analysis page shows for the same scope/date window.
const UNITS_TOOLTIP = 'Σ order_items quantity (order_items SOT, matches Analysis)';
const AVG_SHIPPING_TOOLTIP = 'Σ(allocated shipment label cost) ÷ shipped units (same SOT as Analysis)';

export default function Dashboard() {
  const { days } = usePortalFilters();
  const { userId } = useAuth();
  const nav = useNavigate();
  const dash = useDashboard();
  const counts = useDailyCounts();
  const ships = useDailyShipments();
  const aw = useAwaitingCount();

  // Live-peek modal: which KPI is open + the rect of the card it grew from.
  const [peek, setPeek] = useState<{ key: PeekKey; rect: DOMRect } | null>(null);
  const openPeek = (key: PeekKey) => (rect: DOMRect) => setPeek({ key, rect });

  // Chart drill-down: which day is open + which chart it came from + click point.
  const [dayPeek, setDayPeek] = useState<{ day: string; source: DayPeekSource; origin?: { x: number; y: number } } | null>(null);
  const openDay = (source: DayPeekSource) => (day: string, origin?: { x: number; y: number }) => setDayPeek({ day, source, origin });

  // ── Customizable layout (per-user, persisted) ──
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<DashLayout>(() => loadLayout(userId));
  const prevUser = useRef(userId);
  useEffect(() => {
    if (prevUser.current !== userId) {
      prevUser.current = userId;
      setLayout(loadLayout(userId));
      setEditing(false);
    }
  }, [userId]);
  useEffect(() => {
    saveLayout(userId, layout);
  }, [userId, layout]);

  const setOrder = (order: WidgetId[]) => setLayout((l) => ({ ...l, order }));
  const toggleHidden = (id: WidgetId) =>
    setLayout((l) => ({ ...l, hidden: l.hidden.includes(id) ? l.hidden.filter((x) => x !== id) : [...l.hidden, id] }));
  const toggleWidth = (id: WidgetId) =>
    setLayout((l) => ({ ...l, widths: { ...l.widths, [id]: l.widths[id] === 'full' ? 'half' : 'full' } }));
  const resetLayout = () => setLayout(DEFAULT_LAYOUT);

  const loading = dash.isLoading || counts.isLoading || ships.isLoading || aw.isLoading;

  const countRows = counts.data?.data ?? [];
  // Open orders = current orders still awaiting shipment (a live state count,
  // NOT a 30-day window). Sourced from the same endpoint as the sidebar badge
  // so the two always agree.
  const openOrders = aw.data?.count ?? 0;
  const shipped = countRows.reduce((n, r) => n + Number(r.shipped ?? 0), 0);

  // Full YYYY-MM-DD is kept (axis formats to MM-DD) so a bar click resolves the
  // day's full detail.
  const ordersUnitsSeries = (dash.data?.daily ?? []).map((d) => ({ day: d.day, orders: d.orders, units: d.units }));
  const volumeSeries = (ships.data?.data ?? []).map((r) => ({ day: r.day, vol: r.shipments }));
  const topSku = dash.data?.bySku?.[0]?.sku ?? '—';

  /** Render a single dashboard widget. In edit mode, interactive handlers are
   *  withheld so dragging/toggling never fires a drill-down modal. */
  function renderWidget(id: WidgetId, edit: boolean): ReactNode {
    switch (id) {
      case 'kpis':
        return (
          <motion.div variants={staggerContainer} initial="initial" animate="enter" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[148px] rounded-glass" />)
            ) : (
              <>
                {/* Honest labels (CP-021): each KPI names the entity + table it
                    comes from, so two numbers on the page can't silently mean
                    different things. "Shipped Orders" = orders.order_status='shipped'
                    (order clock); "Ordered Units" = Σ order_items.quantity (order
                    clock — NOT shipped units); "Shipments Created" (below) =
                    shipments rows by ship_date (shipment clock). */}
                <StatCard label="Open orders" value={openOrders.toLocaleString()} icon={ShoppingCart} accent="indigo" hint="Awaiting shipment" onPeek={edit ? undefined : openPeek('open')} />
                <StatCard label={`Shipped orders (${days}d)`} value={shipped.toLocaleString()} icon={Truck} accent="teal" onPeek={edit ? undefined : openPeek('shipped')} />
                <StatCard label={`Ordered units (${days}d)`} value={Number(dash.data?.units ?? 0).toLocaleString()} icon={Boxes} accent="amber" hint={`Top SKU: ${topSku}`} onPeek={edit ? undefined : openPeek('units')} />
                <StatCard label={`Revenue (${days}d)`} value={money(dash.data?.revenue ?? 0)} icon={Wallet} accent="emerald" onPeek={edit ? undefined : openPeek('revenue')} />
              </>
            )}
          </motion.div>
        );
      case 'ordersChart':
        return (
          <GlassPanel className="p-5">
            <SectionTitle title="Orders over time" subtitle={`Orders count vs. unit count (last ${days} days)`} />
            <div className="mt-4">
              {loading ? (
                <Skeleton className="h-[260px]" />
              ) : ordersUnitsSeries.length ? (
                <OrdersUnitsBarChart
                  data={ordersUnitsSeries}
                  onSelectDay={edit ? undefined : openDay('orders')}
                />
              ) : (
                <EmptyState
                  icon={<Inbox size={24} />}
                  title="No order activity"
                  message="No orders in the selected period."
                />
              )}
            </div>
          </GlassPanel>
        );
      case 'volumeChart':
        return (
          <GlassPanel className="p-5">
            {/* CP-021: this counts shipments (label rows) by ship_date — the
                shipment clock — NOT orders. Named "Shipments Created" so it can't
                be read as the order-based "Shipped orders" KPI above. */}
            <SectionTitle title="Shipments created" subtitle="Daily shipments (shipments table, by ship date)" />
            <div className="mt-4">
              {loading ? (
                <Skeleton className="h-[260px]" />
              ) : volumeSeries.length ? (
                <VolumeBarChart
                  data={volumeSeries}
                  onSelectDay={edit ? undefined : openDay('shipments')}
                />
              ) : (
                <EmptyState
                  icon={<Inbox size={24} />}
                  title="No shipments"
                  message="No shipments in the selected period."
                />
              )}
            </div>
          </GlassPanel>
        );
      case 'topSkus':
        return (
          <GlassPanel className="p-5">
            {/* CP-021: ranked by ordered units (order_items SOT), same query as
                the Analysis Top-SKUs — so these rows match Analysis exactly. */}
            <SectionTitle title="Top SKUs" subtitle={`By ordered units — matches Analysis (last ${days} days)`} />
            <div className="mt-4">
              {loading ? (
                <Skeleton className="h-40" />
              ) : (dash.data?.bySku?.length ?? 0) === 0 ? (
                <EmptyState icon={<Inbox size={24} />} title="No SKU data" message="SKU activity will appear here." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-ink-3">
                        <th className="py-2 pr-4">SKU</th>
                        <th className="py-2 px-4 text-right">
                          <Tooltip side="top" multiline label={UNITS_TOOLTIP}>
                            <span tabIndex={0} className="focus-ring inline-flex cursor-help items-center gap-1 rounded">
                              Unit Count Last 30 Days
                              <Info size={12} className="shrink-0" />
                            </span>
                          </Tooltip>
                        </th>
                        <th className="py-2 pl-4 text-right">
                          <Tooltip side="top" multiline label={AVG_SHIPPING_TOOLTIP}>
                            <span tabIndex={0} className="focus-ring inline-flex cursor-help items-center gap-1 rounded">
                              Avg Shipping Price
                              <Info size={12} className="shrink-0" />
                            </span>
                          </Tooltip>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {dash.data!.bySku.slice(0, 8).map((s) => (
                        <tr key={s.sku}>
                          <td className="py-2.5 pr-4 font-medium text-ink-2">{s.sku}</td>
                          <td className="py-2.5 px-4 text-right tnum text-ink-3">{s.units30.toLocaleString()}</td>
                          <td className="py-2.5 pl-4 text-right tnum text-ink-3">
                            {s.avgShippingPrice == null ? (
                              <Tooltip side="top" multiline label="No order carrying this SKU had a shipping charge.">
                                <span tabIndex={0} className="focus-ring cursor-help rounded">{'—'}</span>
                              </Tooltip>
                            ) : (
                              <span className="tnum">{money(s.avgShippingPrice)}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </GlassPanel>
        );
    }
  }

  const visibleOrder = layout.order.filter((id) => !layout.hidden.includes(id));

  return (
    <div className="space-y-4">
      {/* Edit toolbar */}
      <div className="flex items-center justify-between gap-3">
        <p className={cn('text-sm text-ink-3 transition-opacity', editing ? 'opacity-100' : 'opacity-0')}>
          Drag to reorder · tap the eye to hide a section
        </p>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button
                onClick={resetLayout}
                className="focus-ring inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-glass-sm border border-white/80 bg-white/60 px-3 text-sm font-medium text-ink-2 ring-1 ring-slate-200/70 transition-colors hover:bg-white/90"
              >
                <RotateCcw size={14} /> Reset
              </button>
              <button
                onClick={() => setEditing(false)}
                className={cn(
                  'focus-ring inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-glass-sm',
                  'bg-gradient-to-br from-brand-400 to-brand-600 px-3.5 text-sm font-semibold',
                  'text-white shadow-glass transition-opacity hover:opacity-95',
                )}
              >
                <Check size={15} /> Done
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="focus-ring inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-glass-sm border border-white/80 bg-white/60 px-3 text-sm font-medium text-ink-2 ring-1 ring-slate-200/70 transition-colors hover:bg-white/90"
            >
              <Pencil size={14} /> Edit dashboard
            </button>
          )}
        </div>
      </div>

      {/* Widgets — a wrapping row so half-width widgets sit side-by-side. */}
      {editing ? (
        <Reorder.Group axis="y" values={layout.order} onReorder={setOrder} className="flex flex-wrap items-start gap-4">
          {layout.order.map((id) => {
            const isHidden = layout.hidden.includes(id);
            const isHalf = layout.widths[id] === 'half';
            return (
              <Reorder.Item
                key={id}
                value={id}
                className={cn('cursor-grab rounded-glass bg-white/30 p-1.5 ring-1 ring-brand-200/70 active:cursor-grabbing', widthClass(layout.widths[id]))}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2 px-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-ink-2">
                    <GripVertical size={15} className="shrink-0 text-ink-3" />
                    <span className="truncate">{WIDGET_LABELS[id]}</span>
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => toggleWidth(id)}
                      aria-label={`Make ${WIDGET_LABELS[id]} ${isHalf ? 'full' : 'half'} width`}
                      className="focus-ring inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-ink-3 ring-1 ring-slate-200/70 transition-colors hover:bg-white/70 hover:text-ink"
                    >
                      {isHalf ? <Columns2 size={13} /> : <Square size={13} />}
                      {isHalf ? 'Half' : 'Full'}
                    </button>
                    <button
                      onClick={() => toggleHidden(id)}
                      aria-label={isHidden ? `Show ${WIDGET_LABELS[id]}` : `Hide ${WIDGET_LABELS[id]}`}
                      className="focus-ring grid h-7 w-7 cursor-pointer place-items-center rounded-lg text-ink-3 ring-1 ring-slate-200/70 transition-colors hover:bg-white/70 hover:text-ink"
                    >
                      {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div className={cn('pointer-events-none', isHidden && 'opacity-40 grayscale')}>{renderWidget(id, true)}</div>
              </Reorder.Item>
            );
          })}
        </Reorder.Group>
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          {visibleOrder.map((id) => (
            <div key={id} className={widthClass(layout.widths[id])}>
              {renderWidget(id, false)}
            </div>
          ))}
        </div>
      )}

      <KpiPeekModal
        peek={peek?.key ?? null}
        origin={peek?.rect ?? null}
        onClose={() => setPeek(null)}
        onNavigate={nav}
        data={{
          days,
          openOrders,
          units: Number(dash.data?.units ?? 0),
          revenue: Number(dash.data?.revenue ?? 0),
          counts: countRows,
          daily: dash.data?.daily ?? [],
          dailyRevenue: dash.data?.dailyRevenue ?? [],
          bySku: dash.data?.bySku ?? [],
        }}
      />

      <ChartDayModal
        day={dayPeek?.day ?? null}
        source={dayPeek?.source ?? 'orders'}
        origin={dayPeek?.origin}
        onClose={() => setDayPeek(null)}
        onNavigate={nav}
        data={{ days, daily: dash.data?.daily ?? [], counts: countRows, shipments: ships.data?.data ?? [] }}
      />
    </div>
  );
}
