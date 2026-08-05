import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { portalApi } from '@/lib/api';

/**
 * CP-058 AC-3 / AC-4 — assign a return label bought OUTSIDE PrepShip.
 *
 * The second of the two later paths for a label-pending return. It never buys postage
 * and never calls a provider: it records a tracking number and what the label cost, and
 * the backend refuses outright if the return already has a shipment, so one return keeps
 * exactly one canonical label state.
 *
 * The form deliberately does NOT collect carrier, service or provider. Those are
 * server-internal; letting an operator type one here would make the portal a second
 * source of truth for label identity.
 *
 * The label cost entered here is what DR PREPPER paid. It is NOT the customer-billed
 * rate — PS-435/PS-487 keep that on return_customer_shipping_rate — which is why the
 * hint below says so out loud rather than leaving the operator to assume.
 */
const field =
  'min-h-11 w-full rounded-glass-sm bg-white/70 px-3 text-sm text-ink-1 ring-1 ring-slate-200/70 focus-ring';

export function ReturnExternalTrackingPanel({ returnId }: { returnId: number }) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [trackingNumber, setTrackingNumber] = useState('');
  const [labelCost, setLabelCost] = useState('');
  const [pdf, setPdf] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const ready = trackingNumber.trim().length > 0 && labelCost.trim().length > 0;

  async function assign() {
    if (!accessToken || !ready) return;
    setSaving(true);
    try {
      await portalApi.assignReturnExternalTracking(accessToken, returnId, {
        trackingNumber: trackingNumber.trim(),
        labelCost: labelCost.trim(),
      });

      // The PDF is optional and secondary: tracking is already recorded, so a failed
      // upload must not read as a failed assignment. It is reported separately.
      if (pdf) {
        try {
          await portalApi.uploadReturnExternalLabelPdf(accessToken, returnId, pdf);
        } catch (err) {
          toast.warning(
            'Tracking saved — PDF did not upload',
            err instanceof Error ? err.message : 'Retry the PDF from this panel.',
          );
        }
      }

      await qc.invalidateQueries({ queryKey: ['return', returnId] });
      await qc.invalidateQueries({ queryKey: ['returns'] });
      toast.success('External tracking assigned', 'No postage was purchased.');
      setTrackingNumber('');
      setLabelCost('');
      setPdf(null);
    } catch (err) {
      toast.error(
        'Could not assign tracking',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
        Assign external tracking
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className={field}
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
          placeholder="Tracking number"
          maxLength={120}
        />
        <input
          className={field}
          value={labelCost}
          onChange={(e) => setLabelCost(e.target.value)}
          placeholder="Label cost"
          inputMode="decimal"
        />
      </div>
      <input
        type="file"
        accept="application/pdf"
        className="block w-full text-xs text-ink-3"
        onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-3">
          Records a label bought elsewhere. No postage is purchased. The cost entered is
          what we paid, not the rate billed to the client.
        </p>
        <Button variant="secondary" onClick={assign} disabled={saving || !ready}>
          {saving ? 'Saving…' : 'Assign'}
        </Button>
      </div>
    </div>
  );
}
