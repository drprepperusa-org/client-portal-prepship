import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Download, ExternalLink, MapPin, PackageCheck } from 'lucide-react';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Display';
import { Drawer } from '@/components/ui/Drawer';
import { useToast } from '@/components/ui/Toast';
import { API_BASE, portalApi } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useReturnDetail } from '@/lib/hooks';
import { money, shortDate } from '@/lib/status';
import { RETURN_DELIVERY_LABEL, returnStatusMeta } from './returnPresentation';

export function ReturnDetailDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const query = useReturnDetail(id);
  const detail = query.data?.data;
  const [creatingLabel, setCreatingLabel] = useState(false);
  const labelFailed = detail?.status === 'label_failed';
  const canCreateLabel = detail?.status === 'requested' || labelFailed;
  const pdfHref = detail?.pdfUrl
    ? detail.pdfUrl.startsWith('http') ? detail.pdfUrl : `${API_BASE}${detail.pdfUrl}`
    : null;

  async function createLabel() {
    if (!accessToken || id == null || creatingLabel) return;
    setCreatingLabel(true);
    try {
      const result = await portalApi.createReturnLabel(accessToken, id);
      await queryClient.invalidateQueries({ queryKey: ['returns'] });
      await queryClient.invalidateQueries({ queryKey: ['return', id] });
      await query.refetch();
      if (result.data.pdfAvailable) {
        toast.success('Return label ready', 'The PDF is ready to download.');
      } else {
        toast.warning('Label still pending', 'PrepShip created the return, but no PDF is available yet.');
      }
    } catch (error) {
      await queryClient.invalidateQueries({ queryKey: ['returns'] });
      await queryClient.invalidateQueries({ queryKey: ['return', id] });
      await query.refetch();
      toast.error(
        'Could not create return label',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setCreatingLabel(false);
    }
  }

  return (
    <Drawer
      open={id != null}
      onClose={onClose}
      title={detail ? (detail.returnReference ?? `Return #${detail.id}`) : 'Return'}
    >
      {query.isLoading ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : query.isError || !detail ? (
        <p className="text-sm text-ink-3">Couldn’t load this return.</p>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <Chip accent={returnStatusMeta(detail.status).accent}>
              {returnStatusMeta(detail.status).label}
            </Chip>
            <span className="flex items-center gap-1 text-sm text-ink-3">
              <MapPin size={14} /> {detail.clientName ?? '—'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DetailField label="Return ref" value={detail.returnReference ?? `Return #${detail.id}`} />
            <DetailField label="Order" value={detail.orderNumber ?? (detail.orderId ? `#${detail.orderId}` : '—')} />
            <DetailField label="Started by" value={detail.initiatedBy === 'three_pl' ? 'Warehouse' : 'Client'} />
            <DetailField label="Delivery" value={detail.deliveryMethod ? RETURN_DELIVERY_LABEL[detail.deliveryMethod] ?? detail.deliveryMethod : '—'} />
            <DetailField label="Delivery status" value={detail.deliveryStatus ?? '—'} />
            <DetailField label="Created" value={shortDate(detail.createdAt)} />
            {detail.returnCustomerShippingRate != null && (
              <DetailField label="Return postage" value={money(detail.returnCustomerShippingRate)} />
            )}
          </div>

          <div className="flex items-center justify-between rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
            <div className="min-w-0">
              <p className="text-xs text-ink-3">Tracking number</p>
              <p className="truncate font-mono text-sm text-ink">{detail.trackingNumber ?? '—'}</p>
              {detail.trackingStatus && <p className="text-xs text-ink-3">{detail.trackingStatus}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* CP-034: the backend supplies the real carrier URL; identity remains redacted. */}
              {detail.trackingUrl && (
                <a
                  href={detail.trackingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-glass-sm bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-100 sm:min-h-8"
                  title="Track on carrier site"
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

          {pdfHref && (
            <a
              href={pdfHref}
              target="_blank"
              rel="noreferrer"
              className={cn(
                'focus-ring flex min-h-11 w-full items-center justify-center gap-2 rounded-glass-sm',
                'bg-gradient-to-br from-brand-400 to-brand-600 py-2.5 text-sm font-semibold',
                'text-white shadow-glass transition-opacity hover:opacity-95',
              )}
            >
              <Download size={15} /> Download return label
            </a>
          )}

          {!pdfHref && (
            <div className={cn(
              'space-y-3 rounded-glass-sm p-3 text-sm ring-1',
              labelFailed
                ? 'bg-rose-50/80 text-rose-800 ring-rose-200'
                : 'bg-amber-50/80 text-amber-800 ring-amber-200',
            )}>
              <div>
                <p className="font-semibold">
                  {labelFailed ? 'Label needs attention.' : 'Return label PDF is not ready yet.'}
                </p>
                <p className={cn('mt-1 text-xs', labelFailed ? 'text-rose-700' : 'text-amber-700')}>
                  {labelFailed
                    ? detail.deliveryError ?? 'PrepShip could not create the label yet. Correct the return-label inputs and retry.'
                    : 'PrepShip has the return request, but no label PDF has been created.'}
                </p>
              </div>
              {canCreateLabel && (
                <Button
                  leadingIcon={<PackageCheck size={16} />}
                  onClick={createLabel}
                  disabled={creatingLabel || !accessToken}
                >
                  {creatingLabel ? 'Creating label...' : labelFailed ? 'Retry return label' : 'Create return label'}
                </Button>
              )}
            </div>
          )}

          {detail.reason && (
            <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
              <p className="text-xs font-medium text-ink-3">Reason</p>
              <p className="mt-1 text-sm text-ink-2">{detail.reason}</p>
            </div>
          )}

          <div className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">Returned items</p>
            <ul className="space-y-2">
              {detail.items.length === 0 && <li className="text-sm text-ink-3">No items.</li>}
              {detail.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink" title={item.name ?? ''}>
                      {item.name ?? item.sku}
                    </p>
                    {item.sku && <p className="truncate font-mono text-[11px] text-ink-3">{item.sku}</p>}
                  </div>
                  <span className="shrink-0 text-sm tnum text-ink-2">×{item.quantity}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">Inspection</p>
            {detail.inspections.length === 0 ? (
              <p className="text-sm text-ink-3">No inspection recorded yet.</p>
            ) : (
              <ul className="space-y-3">
                {detail.inspections.map((inspection) => (
                  <li key={inspection.id} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Chip accent="teal" dot={false}>{inspection.status}</Chip>
                      {inspection.condition && <span className="text-xs text-ink-3">{inspection.condition}</span>}
                      {inspection.receivedAt && <span className="text-xs text-ink-3">· {shortDate(inspection.receivedAt)}</span>}
                    </div>
                    {inspection.comments && <p className="text-sm text-ink-2">{inspection.comments}</p>}
                    {inspection.media.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {inspection.media.map((media) => media.url ? (
                          <a
                            key={media.id}
                            href={media.url}
                            target="_blank"
                            rel="noreferrer"
                            className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs text-ink-2 hover:bg-slate-200 sm:min-h-8"
                          >
                            {media.mediaType === 'video' ? 'Video' : 'Photo'}
                          </a>
                        ) : (
                          <span
                            key={media.id}
                            title="Media unavailable"
                            className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs text-ink-3 opacity-60 sm:min-h-8"
                          >
                            {media.mediaType === 'video' ? 'Video' : 'Photo'} · unavailable
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Drawer>
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
