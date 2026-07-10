import { Chip } from '@/components/ui/Display';
import { Drawer } from '@/components/ui/Drawer';
import { QueryState } from '@/components/ui/QueryState';
import { ItemNameLines, SkuLines } from '@/components/ItemIdentityLines';
import { useOrderShipments } from '@/lib/hooks';
import { money, shipmentStatusMeta, shortDate } from '@/lib/status';

export interface InvoiceShipmentSelection {
  orderId: number;
  orderNumber: string | null;
  shippingTotal: number | string | null;
}

export function InvoiceShipmentDrawer({
  selection,
  onClose,
}: {
  selection: InvoiceShipmentSelection | null;
  onClose: () => void;
}) {
  const query = useOrderShipments(selection?.orderId ?? null);
  return (
    <Drawer
      open={!!selection}
      onClose={onClose}
      title={selection
        ? `Shipments — Order ${selection.orderNumber ?? `#${selection.orderId}`}`
        : 'Shipments'}
    >
      {selection && (
        <div className="space-y-4">
          {selection.shippingTotal != null && Number(selection.shippingTotal) > 0 && (
            <ShipmentField label="Shipping (billed)" value={money(selection.shippingTotal)} />
          )}
          <QueryState
            isLoading={query.isLoading}
            isError={query.isError}
            error={query.error}
            isEmpty={(query.data?.data ?? []).length === 0}
            onRetry={() => query.refetch()}
            emptyTitle="No shipment yet"
            emptyMessage="No shipment record found for this billing line."
          >
            <div className="space-y-4">
              {(query.data?.data ?? []).map((shipment) => {
                const status = shipmentStatusMeta(shipment);
                return (
                  <div
                    key={shipment.id}
                    className="space-y-3 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70"
                  >
                    <div className="flex items-center justify-between">
                      <Chip accent={status.accent}>{status.label}</Chip>
                      <span className="text-xs text-ink-3">Shipment #{shipment.id}</span>
                    </div>
                    <div className="rounded-glass-sm bg-white/70 p-3 ring-1 ring-slate-200/70">
                      <p className="text-xs text-ink-3">Tracking number</p>
                      <p className="truncate font-mono text-sm text-ink">
                        {shipment.trackingNumber ?? shipment.labelTracking ?? '—'}
                      </p>
                    </div>
                    {/* CP-009: no Carrier / Service — customer-facing shipment info only. */}
                    <div className="grid grid-cols-2 gap-3">
                      <ShipmentField label="Ship date" value={shortDate(shipment.shipDate)} />
                      <ShipmentField
                        label="Delivered"
                        value={shipment.deliveredAt ? shortDate(shipment.deliveredAt) : '—'}
                      />
                    </div>
                    {(shipment.items?.length ?? 0) > 0 && (
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(120px,0.5fr)]">
                        <ItemNameLines items={shipment.items} limit={6} />
                        <SkuLines items={shipment.items} limit={6} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </QueryState>
        </div>
      )}
    </Drawer>
  );
}

function ShipmentField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink" title={value}>{value}</p>
    </div>
  );
}
