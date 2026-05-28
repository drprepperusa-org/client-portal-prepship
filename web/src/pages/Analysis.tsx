import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, Columns3, PackageSearch, RefreshCw, SlidersHorizontal, TrendingUp, X } from 'lucide-react';
import SearchBar from '../components/ui/search-bar';
import { safeDate, safeMoney, safeNumber } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAnalysisSkuBreakdownQuery, useAnalysisSkuOrdersQuery } from '../lib/portalQueries';
import {
  DEFAULT_TABLE_PAGE_SIZE,
  DEFAULT_TABLE_PAGE_SIZE_OPTIONS,
  MIN_TABLE_COLUMN_WIDTH,
  reorderTableColumns,
  resizeTableColumn,
} from '../lib/tablePreferences';
import type { AnalysisSkuOrder, AnalysisSkuRow } from '../types/portal';

const palette = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#7c3aed'];
const rangeLabels = ['30d', '90d', '180d', '1yr', 'All'];
const ANALYSIS_STORAGE_KEY = 'portal.table.analysis-sku';
const dayMs = 86_400_000;

type AnalysisColumn = {
  key: string;
  header: string;
  className?: string;
  width?: number;
};

const analysisColumns: AnalysisColumn[] = [
  { key: 'item', header: 'Item name', width: 190 },
  { key: 'sku', header: 'SKU', width: 140 },
  { key: 'orders', header: 'Orders', className: 'right', width: 76 },
  { key: 'pending', header: 'Pending', className: 'center', width: 90 },
  { key: 'ext', header: 'Ext. shipped', className: 'center', width: 110 },
  { key: 'qty', header: 'Total qty', className: 'right', width: 92 },
  { key: 'trend', header: 'Units trend', width: 128 },
  { key: 'avg', header: 'Avg sell', className: 'right', width: 92 },
  { key: 'revenue', header: 'Total revenue', className: 'right', width: 128 },
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
    color: palette[index % palette.length],
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
              <text x={pad.left - 6} y={y + 3} textAnchor="end" fontSize="9" fill="rgb(148 163 184)" fontFamily="Geist Mono, monospace">
                {Math.round(step * max)}
              </text>
            </g>
          );
        })}

        {labels.map((label) => {
          const index = Math.max(0, dateBuckets.indexOf(label));
          const x = pad.left + (index / Math.max(1, dateBuckets.length - 1)) * innerWidth;
          return (
            <text key={label} x={x} y={height - 4} textAnchor="middle" fontSize="9" fill="rgb(148 163 184)" fontFamily="Geist Mono, monospace">
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

  return (
    <div className="portal-analysis-date">
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
  const [range, setRange] = useState(() => rangeFromPreset('30d'));
  const [activeRange, setActiveRange] = useState('30d');
  const analysis = useAnalysisSkuBreakdownQuery(auth.accessToken, range);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_TABLE_PAGE_SIZE);
  const [columnOrder, setColumnOrder] = useState<string[]>(analysisColumns.map((column) => column.key));
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [selectedSku, setSelectedSku] = useState<AnalysisSkuRow | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const resizeRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const rows = analysis.data?.data ?? [];
  const dateBuckets = analysis.data?.dateBuckets ?? [];
  const filteredRows = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return rows;
    return rows.filter((row) => [rowName(row), row.sku, rowClient(row)].join(' ').toLowerCase().includes(value));
  }, [query, rows]);
  const totalOrders = analysis.data?.totalOrders ?? filteredRows.reduce((sum, row) => sum + toNumber(row.orders), 0);
  const totalSkus = analysis.data?.totalSkus ?? filteredRows.length;
  const totalPages = Math.max(Math.ceil(filteredRows.length / pageSize), 1);
  const safePage = Math.min(page, totalPages - 1);
  const visibleRows = filteredRows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const firstRow = filteredRows.length === 0 ? 0 : safePage * pageSize + 1;
  const lastRow = Math.min((safePage + 1) * pageSize, filteredRows.length);
  const isEmptyAnalysis = !analysis.isLoading && filteredRows.length === 0;
  const orderedColumns = useMemo(() => {
    const map = new Map(analysisColumns.map((column) => [column.key, column]));
    return columnOrder
      .map((key) => map.get(key))
      .filter((column): column is AnalysisColumn => column !== undefined)
      .filter((column) => !hiddenColumns.has(column.key));
  }, [columnOrder, hiddenColumns]);
  const tableWidths = useMemo(() => {
    const widths: Record<string, number> = {};
    for (const column of orderedColumns) {
      const base = columnWidths[column.key] ?? Math.round((column.width ?? MIN_TABLE_COLUMN_WIDTH) * (narrow ? 0.78 : 1));
      widths[column.key] = Math.max(narrow ? 54 : MIN_TABLE_COLUMN_WIDTH, base);
    }
    return widths;
  }, [columnWidths, narrow, orderedColumns]);
  const tableWidth = useMemo(() => orderedColumns.reduce((sum, column) => sum + (tableWidths[column.key] ?? column.width ?? MIN_TABLE_COLUMN_WIDTH), 0), [orderedColumns, tableWidths]);
  const visibleColumnCount = analysisColumns.length - hiddenColumns.size;

  useEffect(() => {
    setPage(0);
  }, [query, pageSize, range.from, range.to]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem(ANALYSIS_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { order?: unknown; widths?: unknown; hidden?: unknown; pageSize?: unknown; narrow?: unknown };
      const defaultOrder = analysisColumns.map((column) => column.key);
      if (Array.isArray(parsed.order)) {
        const savedOrder = parsed.order.filter((value): value is string => typeof value === 'string');
        const known = savedOrder.filter((key) => defaultOrder.includes(key));
        const missing = defaultOrder.filter((key) => !known.includes(key));
        setColumnOrder([...known, ...missing]);
      }
      if (parsed.widths && typeof parsed.widths === 'object') setColumnWidths(parsed.widths as Record<string, number>);
      if (Array.isArray(parsed.hidden)) {
        setHiddenColumns(new Set(parsed.hidden.filter((value): value is string => typeof value === 'string' && defaultOrder.includes(value))));
      }
      if (typeof parsed.narrow === 'boolean') setNarrow(parsed.narrow);
      if (typeof parsed.pageSize === 'number' && DEFAULT_TABLE_PAGE_SIZE_OPTIONS.includes(parsed.pageSize as 50 | 100 | 200)) {
        setPageSize(parsed.pageSize);
      }
    } catch {
      // Ignore invalid saved table preferences.
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ANALYSIS_STORAGE_KEY, JSON.stringify({ order: columnOrder, widths: columnWidths, hidden: [...hiddenColumns], pageSize, narrow }));
  }, [columnOrder, columnWidths, hiddenColumns, pageSize, narrow]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const state = resizeRef.current;
      if (!state) return;
      setColumnWidths((previous) => ({
        ...previous,
        [state.key]: resizeTableColumn(state.startWidth, event.clientX - state.startX),
      }));
    }

    function onPointerUp() {
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

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

  function toggleColumn(key: string) {
    setHiddenColumns((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else if (analysisColumns.length - next.size > 1) next.add(key);
      return next;
    });
  }

  function resetAnalysisView() {
    setQuery('');
    setActiveRange('30d');
    setRange(rangeFromPreset('30d'));
    setPage(0);
  }

  return (
    <div className="portal-analysis-page">
      <div className="portal-analysis-head portal-analysis-head-modern">
        <div className="portal-analysis-title">
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
          <select aria-label="Client filter" defaultValue="all" className="portal-analysis-select">
            <option value="all">All stores</option>
          </select>
          <div className="portal-analysis-toolbar-spacer" />
          <div className="portal-analysis-column-tool">
            <button type="button" onClick={() => setColumnsOpen((current) => !current)}><Columns3 size={14} /> Columns <span className="portal-analysis-tool-count">{visibleColumnCount}/{analysisColumns.length}</span></button>
            {columnsOpen ? (
              <div className="portal-analysis-columns-menu">
                <div>
                  <strong>Table columns</strong>
                  <button type="button" onClick={() => setColumnsOpen(false)} aria-label="Close columns"><X size={14} /></button>
                </div>
                {analysisColumns.map((column) => (
                  <label key={column.key}>
                    <input type="checkbox" checked={!hiddenColumns.has(column.key)} onChange={() => toggleColumn(column.key)} />
                    {column.header}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
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
          <TrendChart rows={filteredRows} dateBuckets={dateBuckets} />

          <section className="portal-analysis-table-card">
            <div className="portal-analysis-table-wrap">
              <table className={`portal-analysis-table ${narrow ? 'is-narrow' : ''}`} style={{ width: tableWidth, minWidth: tableWidth }}>
                <colgroup>
                  {orderedColumns.map((column) => <col key={column.key} style={{ width: tableWidths[column.key] }} />)}
                </colgroup>
                <thead>
                  <tr>
                    {orderedColumns.map((column) => (
                      <th
                        key={column.key}
                        draggable
                        onDragStart={(event) => {
                          setDraggedColumn(column.key);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', column.key);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const dragged = draggedColumn ?? event.dataTransfer.getData('text/plain');
                          if (!dragged) return;
                          setColumnOrder((previous) => reorderTableColumns(previous, dragged, column.key));
                          setDraggedColumn(null);
                        }}
                        onDragEnd={() => setDraggedColumn(null)}
                        className={`${column.className ?? ''} ${draggedColumn === column.key ? 'dragging' : ''}`}
                        style={{ width: tableWidths[column.key] }}
                      >
                        {column.header}
                        <button
                          type="button"
                          aria-label={`Resize ${column.header} column`}
                          className="portal-table-resize-handle"
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            resizeRef.current = {
                              key: column.key,
                              startX: event.clientX,
                              startWidth: tableWidths[column.key] ?? event.currentTarget.parentElement?.getBoundingClientRect().width ?? MIN_TABLE_COLUMN_WIDTH,
                            };
                            document.body.style.cursor = 'col-resize';
                            document.body.style.userSelect = 'none';
                          }}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, index) => (
                    <tr key={`${row.sku}-${safePage}-${index}`} onClick={() => setSelectedSku(row)} className="is-clickable">
                      {orderedColumns.map((column) => (
                        <td
                          key={column.key}
                          className={column.className ?? ''}
                          style={{ width: tableWidths[column.key] }}
                        >
                          <AnalysisCell row={row} column={column} index={safePage * pageSize + index} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="portal-analysis-foot">
              <span>{analysis.isLoading ? 'Loading analysis...' : `Showing ${firstRow}-${lastRow} of ${safeNumber(filteredRows.length)} SKUs`}</span>
              <div>
                <label>Rows <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{DEFAULT_TABLE_PAGE_SIZE_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
                <button disabled={safePage <= 0} onClick={() => setPage(0)}>First</button>
                <button disabled={safePage <= 0} onClick={() => setPage((value) => Math.max(value - 1, 0))}>Prev</button>
                <button className="active">{safePage + 1}</button>
                <button disabled={safePage >= totalPages - 1} onClick={() => setPage((value) => Math.min(value + 1, totalPages - 1))}>Next</button>
                <button disabled={safePage >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>Last</button>
              </div>
            </div>
          </section>
        </>
      )}
      <SkuDetailDrawer row={selectedSku} range={range} onClose={() => setSelectedSku(null)} />
    </div>
  );
}
