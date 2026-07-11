import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Copy, Download, ExternalLink, MapPin, PackageCheck, ShoppingBag } from 'lucide-react';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Display';
import { Drawer } from '@/components/ui/Drawer';
import { useToast } from '@/components/ui/Toast';
import { API_BASE, portalApi, type PortalReturnDetail } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useReturnDetail } from '@/lib/hooks';
import { money, shortDate } from '@/lib/status';
import { ReturnDrawerTabs, type ReturnDrawerTab } from './ReturnDrawerTabs';
import { ReturnHistoryTimeline } from './ReturnHistoryTimeline';
import { ReturnInspectionEditor } from './ReturnInspectionEditor';
import { ReturnInspectionHistory } from './ReturnInspectionHistory';
import { RETURN_DELIVERY_LABEL, returnStatusMeta } from './returnPresentation';

export function ReturnDetailDrawer({ id, onClose, canInspect = false }: {
  id: number | null;
  onClose: () => void;
  canInspect?: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const query = useReturnDetail(id);
  const detail = query.data?.data;
  const [tab, setTab] = useState<ReturnDrawerTab>('overview');
  const [creatingLabel, setCreatingLabel] = useState(false);

  useEffect(() => setTab('overview'), [id]);

  async function createLabel() {
    if (!accessToken || id == null || creatingLabel) return;
    setCreatingLabel(true);
    try {
      const result = await portalApi.createReturnLabel(accessToken, id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['returns'] }),
        queryClient.invalidateQueries({ queryKey: ['return', id] }),
      ]);
      await query.refetch();
      result.data.pdfAvailable
        ? toast.success('Return label ready', 'The PDF is ready to download.')
        : toast.warning('Label still pending', 'PrepShip created the return, but no PDF is available yet.');
    } catch (error) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['returns'] }),
        queryClient.invalidateQueries({ queryKey: ['return', id] }),
      ]);
      await query.refetch();
      toast.error('Could not create return label', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setCreatingLabel(false);
    }
  }

  return (
    <Drawer open={id != null} onClose={onClose} title={detail?.returnReference ?? 'Return'} width={620}>
      {query.isLoading ? <p className="text-sm text-ink-3">Loading...</p> : query.isError || !detail ? (
        <p className="text-sm text-ink-3">Couldn’t load this return.</p>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <Chip accent={returnStatusMeta(detail.status).accent}>{returnStatusMeta(detail.status).label}</Chip>
            <span className="flex min-w-0 items-center gap-1 truncate text-sm text-ink-3"><MapPin size={14} /> {detail.clientName ?? '—'}</span>
          </div>
          <div className="sticky -top-5 z-10 -mx-1 bg-white/85 px-1 py-2 backdrop-blur-md">
            <ReturnDrawerTabs value={tab} onChange={setTab} />
          </div>
          {tab === 'overview' && (
            <section id="return-panel-overview" role="tabpanel" aria-labelledby="return-tab-overview">
              <ReturnOverview detail={detail} creatingLabel={creatingLabel} accessToken={accessToken} onCreateLabel={createLabel} onClose={onClose} />
            </section>
          )}
          {tab === 'inspection' && (
            <section id="return-panel-inspection" role="tabpanel" aria-labelledby="return-tab-inspection" className="space-y-5">
              {canInspect && <ReturnInspectionEditor returnId={detail.id} />}
              <ReturnInspectionHistory inspections={detail.inspections} />
            </section>
          )}
          {tab === 'history' && (
            <section id="return-panel-history" role="tabpanel" aria-labelledby="return-tab-history">
              <ReturnHistoryTimeline detail={detail} />
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}

function ReturnOverview({ detail, creatingLabel, accessToken, onCreateLabel, onClose }: {
  detail: PortalReturnDetail;
  creatingLabel: boolean;
  accessToken: string | null;
  onCreateLabel: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const labelFailed = detail.status === 'label_failed';
  const canCreateLabel = detail.status === 'requested' || labelFailed;
  const pdfHref = detail.pdfUrl ? (detail.pdfUrl.startsWith('http') ? detail.pdfUrl : `${API_BASE}${detail.pdfUrl}`) : null;
  const orderLabel = detail.orderNumber ?? (detail.orderId ? `#${detail.orderId}` : '—');
  const orderHref = `/orders?q=${encodeURIComponent(detail.orderNumber ?? String(detail.orderId ?? ''))}&tab=all`;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <DetailField label="Return ref" value={detail.returnReference} />
        <DetailField label="Order" value={orderLabel} />
        <DetailField label="Started by" value={detail.initiatedBy === 'three_pl' ? 'Warehouse' : 'Client'} />
        <DetailField label="Delivery" value={detail.deliveryMethod ? RETURN_DELIVERY_LABEL[detail.deliveryMethod] ?? detail.deliveryMethod : '—'} />
        <DetailField label="Delivery status" value={detail.deliveryStatus ?? '—'} />
        <DetailField label="Created" value={shortDate(detail.createdAt)} />
        {detail.returnCustomerShippingRate != null && <DetailField label="Return postage" value={money(detail.returnCustomerShippingRate)} />}
      </div>

      <Link
        to={orderHref}
        onClick={onClose}
        className="focus-ring flex min-h-11 items-center justify-center gap-2 rounded-glass-sm bg-white/60 px-3 text-sm font-semibold text-brand-700 ring-1 ring-slate-200/70 hover:bg-white"
      >
        <ShoppingBag size={16} /> View original order
      </Link>

      <div className="flex items-center justify-between rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
        <div className="min-w-0">
          <p className="text-xs text-ink-3">Tracking number</p>
          <p className="truncate font-mono text-sm text-ink">{detail.trackingNumber ?? '—'}</p>
          {detail.trackingStatus && <p className="text-xs text-ink-3">{detail.trackingStatus}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {detail.trackingUrl && (
            <a
              href={detail.trackingUrl}
              target="_blank"
              rel="noreferrer"
              className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-glass-sm bg-brand-50 px-2.5 text-xs font-semibold text-brand-700 hover:bg-brand-100"
            >
              <ExternalLink size={13} /> Track
            </a>
          )}
          {detail.trackingNumber && (
            <Button
              variant="icon"
              size="sm"
              aria-label="Copy tracking number"
              onClick={() => {
                navigator.clipboard?.writeText(detail.trackingNumber!);
                toast.success('Copied', 'Tracking number copied to clipboard');
              }}
            >
              <Copy size={15} />
            </Button>
          )}
        </div>
      </div>

      {pdfHref ? (
        <a
          href={pdfHref}
          target="_blank"
          rel="noreferrer"
          className="focus-ring flex min-h-11 w-full items-center justify-center gap-2 rounded-glass-sm bg-gradient-to-br from-brand-400 to-brand-600 py-2.5 text-sm font-semibold text-white shadow-glass hover:opacity-95"
        >
          <Download size={15} /> Download return label
        </a>
      ) : (
        <div className={cn('space-y-3 rounded-glass-sm p-3 text-sm ring-1', labelFailed ? 'bg-rose-50/80 text-rose-800 ring-rose-200' : 'bg-amber-50/80 text-amber-800 ring-amber-200')}>
          <div>
            <p className="font-semibold">{labelFailed ? 'Label needs attention.' : 'Return label PDF is not ready yet.'}</p>
            <p className={cn('mt-1 text-xs', labelFailed ? 'text-rose-700' : 'text-amber-700')}>
              {labelFailed
                ? detail.deliveryError ?? 'PrepShip could not create the label yet. Correct the return-label inputs and retry.'
                : 'PrepShip has the return request, but no label PDF has been created.'}
            </p>
          </div>
          {canCreateLabel && (
            <Button
              leadingIcon={<PackageCheck size={16} />}
              onClick={onCreateLabel}
              disabled={creatingLabel || !accessToken}
            >
              {creatingLabel ? 'Creating label...' : labelFailed ? 'Retry return label' : 'Create return label'}
            </Button>
          )}
        </div>
      )}

      {detail.reason && <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70"><p className="text-xs font-medium text-ink-3">Reason</p><p className="mt-1 text-sm text-ink-2">{detail.reason}</p></div>}
      <div className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">Returned items</p>
        <ul className="space-y-2">
          {!detail.items.length && <li className="text-sm text-ink-3">No items.</li>}
          {detail.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink" title={item.name ?? ''}>{item.name ?? item.sku}</p>
                {item.sku && <p className="truncate font-mono text-[11px] text-ink-3">{item.sku}</p>}
              </div>
              <span className="shrink-0 text-sm tnum text-ink-2">×{item.quantity}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink" title={value}>{value}</p>
    </div>
  );
}
