import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, PackageSearch, RefreshCw, SlidersHorizontal, TrendingUp, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import SearchBar from '../components/ui/search-bar';
import { useSearchParams } from 'react-router-dom';
import { Table } from '../components/ui/Table';
import { StoreSelectorDropdown, clientIdOf, type StoreFilterValue } from '../components/StoreScopeControls';
import { safeDate, safeMoney, safeNumber } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAnalysisSkuBreakdownQuery, useAnalysisSkuOrdersQuery, useClientsQuery } from '../lib/portalQueries';
import {
  DEFAULT_TABLE_PAGE_SIZE,
  DEFAULT_TABLE_PAGE_SIZE_OPTIONS,
} from '../lib/tablePreferences';
import type { AnalysisSkuOrder, AnalysisSkuRow } from '../types/portal';

const palette = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#7c3aed'];
const rangeLabels = ['30d', '90d', '180d', '1yr', 'All'];
const dayMs = 86_400_000;

type AnalysisColumn = {
  key: string;
  header: string;
  className?: string;
  width?: number;
};

const analysisColumns: AnalysisColumn[] = [
  { key: 'item', header: 'Item Name', width: 210 },
  { key: 'sku', header: 'SKU', width: 140 },
  { key: 'client', header: 'Client', width: 130 },
  { key: 'orders', header: 'Orders', className: 'right', width: 76 },
  { key: 'pending', header: 'Pending', className: 'center', width: 90 },
  { key: 'ext', header: 'Ext. shipped', className: 'center', width: 110 },
  { key: 'qty', header: 'Total Qty', className: 'right', width: 92 },
  { key: 'trend', header: 'Units Trend', width: 128 },
  { key: 'avg', header: 'Avg Sell Price', className: 'right', width: 112 },
  { key: 'revenue', header: 'Total Revenue', className: 'right', width: 128 },
  { key: 'std', header: 'Std', className: 'right', width: 82 },
  { key: 'exp', header: 'Exp', className: 'right', width: 72 },
  { key: 'shipping', header: 'Total shipping', className: 'right', width: 136 },
];

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function todayIso() {
  return isoDay(new Date());
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return isoDay(date);
}

function rangeFromPreset(label: string) {
  const to = new Date();
  const from = new Date(to);
  if (label === '90d') from.setDate(to.getDate() - 89);
  else if (label === '180d') from.setDate(to.getDate() - 179);
  else if (label === '1yr') from.setFullYear(to.getFullYear() - 1);
  else if (label === 'All') from.setFullYear(to.getFullYear() - 3);
  else from.setDate(to.getDate() - 29);
  return { from: isoDay(from), to: isoDay(to) };
}

function displayDate(value: string) {
  const [year, month, day] = value.split('-');
  return month && day && year ? `${month}/${day}/${year}` : value;
}

function monthTitle(value: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(value);
}

function daysBetween(from: string, to: string) {
  return Math.max(1, Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / dayMs) + 1);
}

function toNumber(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function shortDate(value: string) {
  const [, month, day] = value.split('-');
  return month && day ? `${month}/${day}` : value;
}

function rowName(row: AnalysisSkuRow) {
  return row.name ?? row.sku;
}

function rowImage(row: AnalysisSkuRow) {
  return row.imageUrl ?? row.image_url ?? null;
}

function rowClient(row: AnalysisSkuRow) {
  return row.clientName ?? row.client_name ?? 'Client';
}

function rowClientId(row: AnalysisSkuRow) {
  return clientIdOf(row);
}

function rowInventoryId(row: AnalysisSkuRow) {
  const value = row.invSkuId ?? row.inv_sku_id ?? null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function trendFor(row: AnalysisSkuRow) {
  return row.daily_qty?.length ? row.daily_qty : [0, 1, 0, 2, 1, 3, 1, 0];
}

function Sparkline({ values, color = '#16a34a', height = 30 }: { values: number[]; color?: string; height?: number }) {
  const max = Math.max(1, ...values);
  const width = 96;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
    const y = height - (value / max) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg className="portal-analysis-spark" viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ItemThumb({ row }: { row: AnalysisSkuRow }) {
  const [failed, setFailed] = useState(false);
  const src = rowImage(row);
  const initial = rowName(row).slice(0, 1).toUpperCase();

  if (!src || failed) return <span>{initial}</span>;
  return <img src={src} alt="" onError={() => setFailed(true)} />;
}

function TrendChart({
  rows,
  dateBuckets,
}: {
  rows: AnalysisSkuRow[];
  dateBuckets: string[];
}) {
  const series = rows.slice(0, 5).map((row, index) => ({
    name: rowName(row),
    values: trendFor(row),
    color: chartColor(index),
  }));
  const max = Math.max(1, ...series.flatMap((item) => item.values));
  const width = 920;
  const height = 140;
  const pad = { top: 12, right: 14, bottom: 22, left: 32 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const labels = dateBuckets.filter((_, index) => index % 4 === 0 || index === dateBuckets.length - 1);

  function smoothPath(values: number[]) {
    if (values.length === 0) return '';
    const points = values.map((value, index) => ({
      x: pad.left + (index / Math.max(1, values.length - 1)) * innerWidth,
      y: pad.top + innerHeight - (value / max) * innerHeight,
    }));
    if (points.length === 1) return `M${points[0]!.x},${points[0]!.y}`;
    let d = `M${points[0]!.x.toFixed(1)},${points[0]!.y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = points[i]!;
      const p1 = points[i + 1]!;
      const cpx = (p0.x + p1.x) / 2;
      d += ` C${cpx.toFixed(1)},${p0.y.toFixed(1)} ${cpx.toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
    }
    return d;
  }

  function areaPath(values: number[]) {
    const line = smoothPath(values);
    if (!line) return '';
    const last = pad.left + innerWidth;
    return `${line} L${last.toFixed(1)},${(height - pad.bottom).toFixed(1)} L${pad.left.toFixed(1)},${(height - pad.bottom).toFixed(1)} Z`;
  }

  return (
    <div className="portal-analysis-chart-card portal-analysis-chart-modern">
      <div className="portal-analysis-chart-head">
        <div>
          <strong>Daily units sold</strong>
          <span className="portal-analysis-chart-sub">Top {series.length} SKUs · click a series in the legend to focus</span>
        </div>
        <div className="portal-analysis-legend">
          {series.map((item) => (
            <span key={item.name}>
              <i style={{ background: item.color }} />
              {item.name.length > 38 ? `${item.name.slice(0, 38)}…` : item.name}
            </span>
          ))}
        </div>
      </div>
      <svg className="portal-analysis-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Daily units sold by top SKUs">
        <defs>
          {series.map((item, index) => (
            <linearGradient key={`grad-${index}`} id={`area-grad-${index}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={item.color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={item.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((step) => {
          const y = pad.top + innerHeight - step * innerHeight;
          return (
            <g key={step}>
              <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="rgb(226 232 240)" strokeDasharray="2 5" strokeWidth="1" />
              <text x={pad.left - 6} y={y + 3} textAnchor="end" fontSize="9" fill="rgb(148 163 184)" fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">
                {Math.round(step * max)}
              </text>
            </g>
          );
        })}

        {labels.map((label) => {
          const index = Math.max(0, dateBuckets.indexOf(label));
          const x = pad.left + (index / Math.max(1, dateBuckets.length - 1)) * innerWidth;
          return (
            <text key={label} x={x} y={height - 4} textAnchor="middle" fontSize="9" fill="rgb(148 163 184)" fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">
              {shortDate(label)}
            </text>
          );
        })}

        {series.map((item, index) => (
          <path key={`area-${item.name}`} d={areaPath(item.values)} fill={`url(#area-grad-${index})`} />
        ))}

        {series.map((item) => (
          <path
            key={`line-${item.name}`}
            d={smoothPath(item.values)}
            fill="none"
            stroke={item.color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {series.map((item) =>
          item.values.map((value, index) => {
            const x = pad.left + (index / Math.max(1, item.values.length - 1)) * innerWidth;
            const y = pad.top + innerHeight - (value / max) * innerHeight;
            return (
              <circle
                key={`${item.name}-${index}`}
                cx={x}
                cy={y}
                r="2.5"
                fill="white"
                stroke={item.color}
                strokeWidth="1.5"
              />
            );
          }),
        )}
      </svg>
    </div>
  );
}

function chartColor(index: number) {
  return palette[index % palette.length] ?? '#2563eb';
}

function ModernTrendChart({
  rows,
  dateBuckets,
}: {
  rows: AnalysisSkuRow[];
  dateBuckets: string[];
}) {
  const series = rows.slice(0, 5).map((row, index) => ({
    name: rowName(row),
    values: trendFor(row),
    color: chartColor(index),
  }));
  const chartRows = dateBuckets.map((day, dayIndex) => {
    const point: Record<string, number | string> = { day, label: shortDate(day) };
    series.forEach((item, index) => {
      point[`sku${index}`] = item.values[dayIndex] ?? 0;
    });
    return point;
  });
  const activeSeries = series[0];

  return (
    <div className="portal-analysis-chart-card portal-analysis-chart-modern">
      <div className="portal-analysis-chart-head">
        <div>
          <strong>Daily units sold</strong>
          <span className="portal-analysis-chart-sub">Top {series.length} SKUs by unit movement in the selected window</span>
        </div>
        <div className="portal-analysis-legend">
          {series.map((item) => (
            <span key={item.name}>
              <i style={{ background: item.color }} />
              {item.name.length > 38 ? `${item.name.slice(0, 38)}...` : item.name}
            </span>
          ))}
        </div>
      </div>
      <div className="portal-analysis-chart" role="img" aria-label="Daily units sold by top SKUs">
        {chartRows.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartRows} margin={{ top: 14, right: 18, bottom: 0, left: -12 }}>
              <defs>
                <linearGradient id="analysisPrimaryFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={activeSeries?.color ?? palette[0]} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={activeSeries?.color ?? palette[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="rgb(var(--line-rgb) / .72)" strokeDasharray="4 8" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={22} tick={{ fill: 'rgb(var(--ink-3-rgb))', fontSize: 11, fontWeight: 700 }} />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={36} tick={{ fill: 'rgb(var(--ink-3-rgb))', fontSize: 11, fontWeight: 700 }} />
              <Tooltip content={<AnalysisChartTooltip series={series} />} />
              {activeSeries ? (
                <Area type="monotone" dataKey="sku0" name={activeSeries.name} stroke={activeSeries.color} strokeWidth={3} fill="url(#analysisPrimaryFill)" dot={false} activeDot={{ r: 5, strokeWidth: 2 }} />
              ) : null}
              {series.slice(1).map((item, index) => (
                <Line key={item.name} type="monotone" dataKey={`sku${index + 1}`} name={item.name} stroke={item.color} strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 2 }} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="portal-analysis-chart-empty">No daily movement data in this window.</div>
        )}
      </div>
    </div>
  );
}

function AnalysisChartTooltip({
  active,
  payload,
  label,
  series,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; name?: string; value?: number; color?: string }>;
  label?: string;
  series: Array<{ name: string; color: string }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="portal-analysis-chart-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => {
        const key = String(item.dataKey ?? '');
        const seriesIndex = Number(key.replace('sku', ''));
        const match = series[seriesIndex];
        return (
          <span key={key}>
            <i style={{ background: item.color ?? match?.color ?? palette[0] }} />
            {(match?.name ?? item.name ?? key).slice(0, 34)}: {safeNumber(item.value ?? 0)}
          </span>
        );
      })}
    </div>
  );
}

function AnalysisCell({ row, column, index }: { row: AnalysisSkuRow; column: AnalysisColumn; index: number }) {
  const qty = toNumber(row.total_qty);
  const revenue = toNumber(row.total_revenue);
  const avgSell = qty > 0 ? revenue / qty : 0;
  const sparkColor = index % 4 === 2 || index % 8 === 7 ? '#ef4444' : '#16a34a';

  switch (column.key) {
    case 'item':
      return (
        <div className="portal-analysis-item">
          <ItemThumb row={row} />
          <strong>{rowName(row)}</strong>
        </div>
      );
    case 'sku':
      return <a>{row.sku}</a>;
    case 'client':
      return rowClient(row);
    case 'orders':
      return safeNumber(row.orders);
    case 'pending':
      return toNumber(row.pending) > 0 ? <span className="portal-analysis-pill warn">{safeNumber(row.pending)} pend</span> : '-';
    case 'ext':
      return toNumber(row.ext_shipped) > 0 ? <span className="portal-analysis-pill">{safeNumber(row.ext_shipped)} ext</span> : '-';
    case 'qty':
      return <span className="total">{safeNumber(row.total_qty)}</span>;
    case 'trend':
      return <Sparkline values={trendFor(row)} color={sparkColor} />;
    case 'avg':
      return safeMoney(avgSell);
    case 'revenue':
      return <span className="money">{safeMoney(row.total_revenue)}</span>;
    case 'std':
      return <>{safeNumber(row.std_orders)} <small>{safeMoney(toNumber(row.total_shipping) * 0.72)}</small></>;
    case 'exp':
      return toNumber(row.exp_orders) > 0 ? safeNumber(row.exp_orders) : '-';
    case 'shipping':
      return <span className="money">{safeMoney(row.total_shipping)}</span>;
    default:
      return null;
  }
}

function AnalysisDatePicker({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => new Date(`${value}T00:00:00`));
  const pickerRef = useRef<HTMLDivElement>(null);
  const selected = new Date(`${value}T00:00:00`);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: startOffset + daysInMonth }, (_, index) => {
    if (index < startOffset) return null;
    return new Date(year, month, index - startOffset + 1);
  });

  useEffect(() => {
    setViewDate(new Date(`${value}T00:00:00`));
  }, [value]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !pickerRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="portal-analysis-date" ref={pickerRef}>
      <button type="button" className="portal-analysis-date-button" onClick={() => setOpen((current) => !current)} aria-label={label}>
        <CalendarDays size={14} />
        {displayDate(value)}
      </button>
      {open ? (
        <div className="portal-analysis-calendar">
          <div className="portal-analysis-calendar-head">
            <button type="button" onClick={() => setViewDate(new Date(year, month - 1, 1))}><ChevronLeft size={14} /></button>
            <strong>{monthTitle(viewDate)}</strong>
            <button type="button" onClick={() => setViewDate(new Date(year, month + 1, 1))}><ChevronRight size={14} /></button>
          </div>
          <div className="portal-analysis-weekdays">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
          </div>
          <div className="portal-analysis-days">
            {cells.map((day, index) => {
              if (!day) return <span key={`empty-${index}`} />;
              const dayValue = isoDay(day);
              const disabled = Boolean(max && dayValue > max);
              return (
                <button
                  key={dayValue}
                  type="button"
                  disabled={disabled}
                  className={day.toDateString() === selected.toDateString() ? 'active' : ''}
                  onClick={() => {
                    onChange(dayValue);
                    setOpen(false);
                  }}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DetailBarChart({ points }: { points: Array<{ day: string; units: number | string }> }) {
  const rows = points.length ? points : [];
  const max = Math.max(1, ...rows.map((point) => toNumber(point.units)));
  return (
    <div className="portal-analysis-drawer-chart">
      <div className="portal-analysis-drawer-chart-head">
        <strong>Units Sold - Last 30 Days</strong>
      </div>
      <div className="portal-analysis-drawer-bars">
        {rows.map((point) => {
          const units = toNumber(point.units);
          return (
            <div key={point.day} className="portal-analysis-drawer-bar">
              <span style={{ height: `${Math.max((units / max) * 100, units ? 8 : 0)}%` }}>{units || ''}</span>
              <small>{shortDate(point.day)}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function orderField(order: AnalysisSkuOrder, camel: keyof AnalysisSkuOrder, snake: keyof AnalysisSkuOrder) {
  return order[camel] ?? order[snake] ?? null;
}

function SkuDetailDrawer({
  row,
  range,
  onClose,
}: {
  row: AnalysisSkuRow | null;
  range: { from: string; to: string };
  onClose: () => void;
}) {
  const auth = useAuth();
  const inventoryId = row ? rowInventoryId(row) : null;
  const detail = useAnalysisSkuOrdersQuery(auth.accessToken, inventoryId, range);
  if (!row) return null;

  const qty = toNumber(row.total_qty);
  const avgDaily = qty / Math.max(1, daysBetween(range.from, range.to));
  const detailRows = detail.data?.orders ?? [];
  const dailySales = detail.data?.dailySales?.length
    ? detail.data.dailySales
    : trendFor(row).map((units, index) => ({ day: addDays(range.from, index), units }));
  const avgStandardShipping = detail.data ? toNumber(detail.data.avgStandardShippingCost) : toNumber(row.total_shipping) / Math.max(1, toNumber(row.std_orders));

  return (
    <div className="portal-analysis-drawer-shell">
      <button type="button" className="portal-analysis-drawer-backdrop" aria-label="Close SKU details" onClick={onClose} />
      <aside className="portal-analysis-drawer" aria-label="SKU details">
        <div className="portal-analysis-drawer-head">
          <div>
            <h2>{rowName(row)}</h2>
            <p>{row.sku}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close SKU details"><X size={16} /></button>
        </div>

        <div className="portal-analysis-drawer-kpis">
          <div>
            <span>{daysBetween(range.from, range.to)}-Day Units Sold</span>
            <strong>{safeNumber(detail.data?.totalUnits ?? row.total_qty)}</strong>
          </div>
          <div>
            <span>Avg. Standard Shipping Cost</span>
            <strong>{safeMoney(avgStandardShipping)}</strong>
          </div>
          <div>
            <span>Avg/Day</span>
            <strong>{safeNumber(avgDaily.toFixed(1))}</strong>
          </div>
        </div>

        <DetailBarChart points={dailySales} />

        <section className="portal-analysis-recent-orders">
          <div className="portal-analysis-recent-head">
            <strong>Recent Orders ({safeNumber(detailRows.length || row.orders)})</strong>
            {detail.isFetching ? <span>Loading...</span> : null}
          </div>
          <div className="portal-analysis-recent-table">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Order #</th>
                  <th>Customer</th>
                  <th>Qty</th>
                  <th>Cost</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.map((order, index) => {
                  const orderNumber = String(orderField(order, 'orderNumber', 'order_number') ?? order.order_id ?? index + 1);
                  const orderDate = String(orderField(order, 'orderDate', 'order_date') ?? '');
                  const customer = String(orderField(order, 'shipToName', 'ship_to_name') ?? '-');
                  const cost = orderField(order, 'standardShippingCost', 'standard_shipping_cost') ?? orderField(order, 'shippingCost', 'shipping_cost');
                  const status = String(orderField(order, 'orderStatus', 'order_status') ?? 'shipped');
                  const external = Boolean(orderField(order, 'isExternalShipped', 'is_external_shipped'));
                  return (
                    <tr key={`${orderNumber}-${index}`}>
                      <td>{safeDate(orderDate)}</td>
                      <td><a>{orderNumber}</a></td>
                      <td>{customer}</td>
                      <td>{safeNumber(order.qty)}</td>
                      <td>{cost ? safeMoney(cost) : external ? <span className="portal-analysis-pill warn">EXT</span> : '-'}</td>
                      <td><span className="portal-analysis-pill">{status.replace(/_/g, ' ')}</span></td>
                    </tr>
                  );
                })}
                {!detail.isLoading && detailRows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No recent order rows returned for this SKU.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </aside>
    </div>
  );
}

function AnalysisEmptyState({
  query,
  rangeLabel,
  onReset,
}: {
  query: string;
  rangeLabel: string;
  onReset: () => void;
}) {
  const cards = [
    {
      icon: <PackageSearch size={18} />,
      title: query ? 'Search is filtering every SKU out' : 'No SKU movement in this scope',
      body: query
        ? 'Clear the keyword or broaden the filter to bring matching SKUs back into view.'
        : 'Synced order activity for the selected client and date window will populate this analysis.',
    },
    {
      icon: <CalendarDays size={18} />,
      title: 'Current date window',
      body: rangeLabel,
    },
    {
      icon: <TrendingUp size={18} />,
      title: 'Analysis will show',
      body: 'Daily unit trends, revenue, shipping cost, order count, and SKU-level performance.',
    },
  ];

  return (
    <section className="portal-analysis-empty-shell" aria-label="Empty SKU analysis">
      <div className="portal-analysis-empty-hero">
        <span className="portal-analysis-empty-icon"><PackageSearch size={24} /></span>
        <div>
          <p>Analysis workspace</p>
          <h2>No SKU analysis rows found</h2>
          <span>Try a wider date range, clear the search, or confirm the selected client has synced order activity.</span>
        </div>
        <button type="button" onClick={onReset}>
          <RefreshCw size={15} />
          Reset view
        </button>
      </div>
      <div className="portal-analysis-empty-grid">
        {cards.map((card) => (
          <article key={card.title}>
            <span>{card.icon}</span>
            <div>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function Analysis() {
  const auth = useAuth();
  const [urlParams] = useSearchParams();
  const [range, setRange] = useState(() => rangeFromPreset('30d'));
  const [activeRange, setActiveRange] = useState('30d');
  const analysis = useAnalysisSkuBreakdownQuery(auth.accessToken, range);
  const clients = useClientsQuery(auth.accessToken);
  const [query, setQuery] = useState('');
  useEffect(() => {
    setQuery(urlParams.get('q') ?? '');
  }, [urlParams]);
  const [activeClientId, setActiveClientId] = useState<StoreFilterValue>('all');
  const [storeSearch, setStoreSearch] = useState('');
  const [narrow, setNarrow] = useState(false);
  const [selectedSku, setSelectedSku] = useState<AnalysisSkuRow | null>(null);
  const rows = analysis.data?.data ?? [];
  const clientRows = clients.data
    ? Array.isArray(clients.data)
      ? clients.data
      : clients.data.data
    : [];
  const dateBuckets = analysis.data?.dateBuckets ?? [];
  const filteredRows = useMemo(() => {
    const value = query.trim().toLowerCase();
    const activeClientName = activeClientId === 'all'
      ? null
      : clientRows.find((client) => Number(client.id) === activeClientId)?.name?.toLowerCase() ?? null;
    const matchesActiveClient = (row: AnalysisSkuRow) => {
      if (activeClientId === 'all') return true;
      const explicitClientName = row.clientName ?? row.client_name ?? null;
      const explicitClientId = rowClientId(row);
      return explicitClientId === activeClientId
        || (activeClientName && explicitClientName ? explicitClientName.toLowerCase() === activeClientName : false)
        || (!explicitClientId && !explicitClientName);
    };
    const shouldApplyClientFilter = activeClientId === 'all' || rows.some(matchesActiveClient);
    return rows.filter((row) => {
      const matchesClient = !shouldApplyClientFilter || matchesActiveClient(row);
      const matchesSearch = !value || [rowName(row), row.sku, rowClient(row)].join(' ').toLowerCase().includes(value);
      return matchesClient && matchesSearch;
    });
  }, [activeClientId, clientRows, query, rows]);
  const totalOrders = analysis.data?.totalOrders ?? filteredRows.reduce((sum, row) => sum + toNumber(row.orders), 0);
  const totalSkus = analysis.data?.totalSkus ?? filteredRows.length;
  const isEmptyAnalysis = !analysis.isLoading && filteredRows.length === 0;
  const tableColumns = useMemo<ColumnDef<AnalysisSkuRow>[]>(() => analysisColumns
    .map((column) => ({
      id: column.key,
      header: column.header,
      enableHiding: column.key !== 'item',
      size: Math.round((column.width ?? 120) * (narrow ? 0.78 : 1)),
      minSize: narrow ? 54 : 80,
      accessorFn: (row) => {
        if (column.key === 'item') return rowName(row);
        if (column.key === 'sku') return row.sku;
        if (column.key === 'avg') {
          const qty = toNumber(row.total_qty);
          return qty > 0 ? toNumber(row.total_revenue) / qty : 0;
        }
        if (column.key === 'trend') return trendFor(row).join(',');
        const value = row[column.key as keyof AnalysisSkuRow];
        return typeof value === 'number' || typeof value === 'string' ? value : '';
      },
      cell: ({ row }) => <AnalysisCell row={row.original} column={column} index={row.index} />,
    })), [narrow]);

  function applyPreset(label: string) {
    setActiveRange(label);
    setRange(rangeFromPreset(label));
  }

  function updateRange(next: Partial<{ from: string; to: string }>) {
    setActiveRange('Custom');
    setRange((current) => {
      const from = next.from ?? current.from;
      const to = next.to ?? current.to;
      return from > to ? { from: to, to: from } : { from, to };
    });
  }

  function shiftRange(direction: -1 | 1) {
    const span = daysBetween(range.from, range.to);
    setActiveRange('Custom');
    setRange({
      from: addDays(range.from, span * direction),
      to: addDays(range.to, span * direction),
    });
  }

  function resetAnalysisView() {
    setQuery('');
    setActiveClientId('all');
    setStoreSearch('');
    setActiveRange('30d');
    setRange(rangeFromPreset('30d'));
  }

  return (
    <div className="portal-analysis-page">
      <div className="portal-analysis-head portal-analysis-head-modern">
        <div className="portal-analysis-title">
          <span><TrendingUp size={18} /></span>
          <div>
            <h1>SKU Analysis</h1>
            <p>{safeNumber(totalSkus)} SKUs · {safeNumber(totalOrders)} orders in window</p>
          </div>
        </div>
      </div>

      <div className="portal-analysis-toolbar">
        <div className="portal-analysis-toolbar-row">
          <div className="portal-analysis-ranges" role="group" aria-label="Date range">
            {rangeLabels.map((label) => (
              <button key={label} type="button" onClick={() => applyPreset(label)} className={activeRange === label ? 'active' : ''}>
                {label}
              </button>
            ))}
          </div>
          <div className="portal-analysis-date-group">
            <AnalysisDatePicker label="Date from" value={range.from} max={todayIso()} onChange={(value) => updateRange({ from: value })} />
            <span className="portal-analysis-date-sep">→</span>
            <AnalysisDatePicker label="Date to" value={range.to} max={todayIso()} onChange={(value) => updateRange({ to: value })} />
          </div>
          <div className="portal-analysis-nav-group">
            <button type="button" className="portal-analysis-nav" aria-label="Previous range" onClick={() => shiftRange(-1)}><ChevronLeft size={15} /></button>
            <button type="button" className="portal-analysis-nav" aria-label="Next range" onClick={() => shiftRange(1)} disabled={range.to >= todayIso()}><ChevronRight size={15} /></button>
          </div>
          <div className="portal-analysis-count">{safeNumber(totalSkus)} SKUs</div>
        </div>

        <div className="portal-analysis-toolbar-row">
          <SearchBar
            containerClassName="w-full max-w-[280px]"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search SKU or item…"
          />
          <StoreSelectorDropdown
            clients={clientRows}
            value={activeClientId}
            onChange={setActiveClientId}
            search={storeSearch}
            onSearchChange={setStoreSearch}
            label="Store filter"
          />
          <div className="portal-analysis-toolbar-spacer" />
          <button type="button" className={`portal-analysis-toggle ${narrow ? 'active' : ''}`} onClick={() => setNarrow((current) => !current)}><SlidersHorizontal size={14} /> {narrow ? 'Wide' : 'Narrow'}</button>
        </div>
      </div>

      {isEmptyAnalysis ? (
        <AnalysisEmptyState
          query={query}
          rangeLabel={`${displayDate(range.from)} - ${displayDate(range.to)}`}
          onReset={resetAnalysisView}
        />
      ) : (
        <>
          <ModernTrendChart rows={filteredRows} dateBuckets={dateBuckets} />

          <section className="portal-analysis-table-card">
            <div className="p-4">
              <Table
                tableId="analysis-sku-breakdown"
                data={filteredRows}
                columns={tableColumns}
                loading={analysis.isLoading && !analysis.data}
                skeletonRows={8}
                defaultPageSize={DEFAULT_TABLE_PAGE_SIZE}
                pageSizeOptions={[...DEFAULT_TABLE_PAGE_SIZE_OPTIONS]}
                emptyMessage="No SKU analysis rows found"
                onRowClick={setSelectedSku}
                className={`portal-analysis-table ${narrow ? 'is-narrow text-[12px]' : ''}`}
                showColumnControls
              />
            </div>
          </section>
        </>
      )}
      <SkuDetailDrawer row={selectedSku} range={range} onClose={() => setSelectedSku(null)} />
    </div>
  );
}
