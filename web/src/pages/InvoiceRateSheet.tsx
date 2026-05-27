import { useMemo, useState } from 'react';
import { Calculator, FileSpreadsheet, PackageCheck, Warehouse } from 'lucide-react';
import { DataTable, PageHeader, Panel, StatusBadge } from '../components/PortalPrimitives';
import { safeMoney, safeNumber } from '../lib/api';
import {
  HERITAGE_BOX_RATES,
  HERITAGE_RATE_SHEET,
  HERITAGE_SKUS,
  calculateHeritageFulfillment,
} from '../lib/heritageRateSheet';
import type { HeritageBoxRate, HeritageSku } from '../lib/heritageRateSheet';

function parseNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function InvoiceRateSheet() {
  const [quantity, setQuantity] = useState('1');
  const [shippingCharge, setShippingCharge] = useState('5.97');
  const [storageFee, setStorageFee] = useState('0');
  const [boxIndex, setBoxIndex] = useState('1');

  const selectedBox = HERITAGE_BOX_RATES[Number(boxIndex)] ?? HERITAGE_BOX_RATES[0];
  const estimate = calculateHeritageFulfillment({
    quantity: parseNumber(quantity),
    shippingCharge: parseNumber(shippingCharge),
    boxFee: selectedBox?.fee ?? 0,
    storageFee: parseNumber(storageFee),
  });
  const skuCounts = useMemo(() => {
    return HERITAGE_SKUS.reduce<Record<string, number>>((counts, sku) => {
      counts[sku.type] = (counts[sku.type] ?? 0) + 1;
      return counts;
    }, {});
  }, []);

  return (
    <>
      <PageHeader
        title="Heritage rate sheet"
        subtitle="Extracted invoice and fulfillment rules from the Heritage Kids Press workbook."
      />

      <div className="portal-kpis mb-6">
        <div className="portal-kpi portal-kpi-blue">
          <div className="portal-kpi-icon"><Calculator size={18} /></div>
          <div className="portal-kpi-body">
            <div className="portal-kpi-label">Pick/pack base</div>
            <div className="portal-kpi-value">{safeMoney(HERITAGE_RATE_SHEET.prepFee.basePickPack)}</div>
            <div className="portal-kpi-hint">plus {safeMoney(HERITAGE_RATE_SHEET.prepFee.additionalUnitFee)} per extra unit</div>
          </div>
        </div>
        <div className="portal-kpi portal-kpi-green">
          <div className="portal-kpi-icon"><PackageCheck size={18} /></div>
          <div className="portal-kpi-body">
            <div className="portal-kpi-label">Box rates</div>
            <div className="portal-kpi-value">{safeNumber(HERITAGE_BOX_RATES.length)}</div>
            <div className="portal-kpi-hint">standard and manual packaging rows</div>
          </div>
        </div>
        <div className="portal-kpi portal-kpi-amber">
          <div className="portal-kpi-icon"><Warehouse size={18} /></div>
          <div className="portal-kpi-body">
            <div className="portal-kpi-label">Storage</div>
            <div className="portal-kpi-value">{safeMoney(HERITAGE_RATE_SHEET.storage.cubicFootRate)}</div>
            <div className="portal-kpi-hint">per cubic foot from $25 / 80 CF</div>
          </div>
        </div>
        <div className="portal-kpi portal-kpi-red">
          <div className="portal-kpi-icon"><FileSpreadsheet size={18} /></div>
          <div className="portal-kpi-body">
            <div className="portal-kpi-label">SKU catalog</div>
            <div className="portal-kpi-value">{safeNumber(HERITAGE_SKUS.length)}</div>
            <div className="portal-kpi-hint">items extracted from workbook</div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="Fee calculator" right={<span className="text-xs font-bold text-ink-3">Workbook formula preview</span>}>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-black uppercase text-ink-3">Quantity</span>
              <input className="mt-2 h-11 w-full rounded-card border border-line bg-surface px-3 text-sm font-bold text-ink outline-none focus:border-brand" value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="numeric" />
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase text-ink-3">Shipping charge</span>
              <input className="mt-2 h-11 w-full rounded-card border border-line bg-surface px-3 text-sm font-bold text-ink outline-none focus:border-brand" value={shippingCharge} onChange={(event) => setShippingCharge(event.target.value)} inputMode="decimal" />
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase text-ink-3">Box</span>
              <select className="mt-2 h-11 w-full rounded-card border border-line bg-surface px-3 text-sm font-bold text-ink outline-none focus:border-brand" value={boxIndex} onChange={(event) => setBoxIndex(event.target.value)}>
                {HERITAGE_BOX_RATES.map((box, index) => (
                  <option key={box.box} value={index}>{box.box} {box.fee === null ? '(manual)' : safeMoney(box.fee)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase text-ink-3">Storage fee</span>
              <input className="mt-2 h-11 w-full rounded-card border border-line bg-surface px-3 text-sm font-bold text-ink outline-none focus:border-brand" value={storageFee} onChange={(event) => setStorageFee(event.target.value)} inputMode="decimal" />
            </label>
          </div>
          <div className="grid gap-3 border-t border-line bg-surface-2 p-5 sm:grid-cols-3">
            <div>
              <div className="text-[10px] font-black uppercase text-ink-3">Pick/pack</div>
              <div className="mt-1 text-lg font-black text-ink">{safeMoney(estimate.pickPack)}</div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase text-ink-3">Box fee</div>
              <div className="mt-1 text-lg font-black text-ink">{selectedBox?.fee === null ? 'Manual' : safeMoney(selectedBox?.fee ?? 0)}</div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase text-ink-3">Total fulfillment</div>
              <div className="mt-1 text-lg font-black text-brand">{safeMoney(estimate.total)}</div>
            </div>
          </div>
        </Panel>

        <Panel title="Extracted workbook logic">
          <div className="grid gap-3 p-5">
            <div className="rounded-card border border-line bg-surface-2 p-4">
              <div className="text-xs font-black uppercase text-ink-3">Prep Fee sheet</div>
              <div className="mt-1 text-sm font-bold text-ink">{HERITAGE_RATE_SHEET.prepFee.formula}</div>
              <div className="mt-1 text-xs font-semibold text-ink-3">{HERITAGE_RATE_SHEET.prepFee.totalFormula}</div>
            </div>
            <div className="rounded-card border border-line bg-surface-2 p-4">
              <div className="text-xs font-black uppercase text-ink-3">Receiving sheet</div>
              <div className="mt-1 text-sm font-bold text-ink">{HERITAGE_RATE_SHEET.receiving.formula}</div>
              <div className="mt-1 text-xs font-semibold text-ink-3">{HERITAGE_RATE_SHEET.receiving.unitSizeFormula}</div>
            </div>
            <div className="rounded-card border border-line bg-surface-2 p-4">
              <div className="text-xs font-black uppercase text-ink-3">Storage Fee sheet</div>
              <div className="mt-1 text-sm font-bold text-ink">{HERITAGE_RATE_SHEET.storage.formula}</div>
              <div className="mt-1 text-xs font-semibold text-ink-3">Source workbook: {HERITAGE_RATE_SHEET.sourceWorkbook}</div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="h-5" />
      <Panel title="Packaging rates">
        <DataTable<HeritageBoxRate>
          tableId="heritage-box-rates"
          rows={HERITAGE_BOX_RATES}
          getRowKey={(row) => row.box}
          columns={[
            { key: 'box', header: 'Box / package', render: (row) => <span className="font-black text-ink">{row.box}</span> },
            { key: 'fee', header: 'Fee', className: 'right', width: '120px', render: (row) => <span className="font-black tabular-nums text-ink">{row.fee === null ? 'Manual' : safeMoney(row.fee)}</span> },
            { key: 'notes', header: 'Notes', render: (row) => <span className="font-semibold text-ink-3">{row.sourceLabel ?? 'Standard workbook box fee'}</span> },
          ]}
          initialPageSize={10}
        />
      </Panel>

      <div className="h-5" />
      <Panel
        title="SKU catalog"
        right={<span className="text-xs font-bold text-ink-3">{safeNumber(skuCounts['3-book set'] ?? 0)} sets / {safeNumber(skuCounts.Songbook ?? 0)} songbooks / {safeNumber(skuCounts['Single book'] ?? 0)} singles</span>}
      >
        <DataTable<HeritageSku>
          tableId="heritage-sku-catalog"
          rows={HERITAGE_SKUS}
          getRowKey={(row) => row.sku}
          columns={[
            { key: 'sku', header: 'SKU', width: '190px', render: (row) => <span className="font-black text-ink">{row.sku}</span> },
            { key: 'name', header: 'Item', render: (row) => <span className="font-semibold text-ink-2">{row.name}</span> },
            { key: 'type', header: 'Type', width: '150px', render: (row) => <StatusBadge value={row.type} /> },
            { key: 'notes', header: 'Notes', width: '260px', render: (row) => <span className="font-semibold text-ink-3">{row.notes ?? '-'}</span> },
          ]}
        />
      </Panel>
    </>
  );
}
