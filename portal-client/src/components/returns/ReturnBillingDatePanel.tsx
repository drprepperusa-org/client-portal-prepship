import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { portalApi } from '@/lib/api';
import { useMe } from '@/lib/hooks';
import { shortDay } from '@/lib/status';

/**
 * CP-058 AC-6 — staff-only correction of a return's billing date.
 *
 * The portal owns this SURFACE; PrepShip (PS-487) owns the RULE. Nothing here decides
 * which period is affected, whether it is finalized, or what adjustment results — it
 * collects the new day and a reason, and renders whatever the backend answers.
 *
 * It is not rendered at all for client users, matching the backend, which answers 404
 * rather than 403 so a client cannot learn the endpoint or the return exists.
 *
 * A 409 means the affected period is finalized and needs a DJ-approved reference. That
 * is surfaced verbatim rather than reworded, because the reason a correction was refused
 * is the useful part.
 */
const field =
  'min-h-11 w-full rounded-glass-sm bg-white/70 px-3 text-sm text-ink-1 ring-1 ring-slate-200/70 focus-ring';

export function ReturnBillingDatePanel({
  returnId,
  currentBillingDate,
}: {
  returnId: number;
  currentBillingDate: string | null;
}) {
  const { accessToken } = useAuth();
  const me = useMe().data;
  const toast = useToast();
  const qc = useQueryClient();
  // CP-063: the backend's current effective billing date as a YYYY-MM-DD the date input
  // accepts. Derived from the read-model value — the panel does not own the billing date.
  const currentDay = currentBillingDate ? currentBillingDate.slice(0, 10) : '';
  const [newBillingDay, setNewBillingDay] = useState(currentDay);
  const [reason, setReason] = useState('');
  const [approval, setApproval] = useState('');
  const [saving, setSaving] = useState(false);

  // CP-063: re-sync the input to the backend's current billing date whenever it changes —
  // on first load, and after a successful correction refetches the new value — so the panel
  // reflects the saved date instead of clearing to a blank form.
  useEffect(() => {
    setNewBillingDay(currentDay);
  }, [currentDay]);

  // Staff only. AC-6: clients can neither edit the date nor see the audit.
  if (!me?.isAdmin && !me?.isGlobal) return null;

  const ready = newBillingDay.trim().length > 0 && reason.trim().length >= 3;

  async function apply() {
    if (!accessToken || !ready) return;
    setSaving(true);
    try {
      const res = await portalApi.updateReturnBillingDate(accessToken, returnId, {
        newBillingDay: newBillingDay.trim(),
        reason: reason.trim(),
        djApprovalReference: approval.trim() || null,
      });
      await qc.invalidateQueries({ queryKey: ['return', returnId] });
      await qc.invalidateQueries({ queryKey: ['returns'] });
      toast.success(
        'Billing date corrected',
        res.data?.adjustmentPending
          ? 'An adjustment will post to the next open billing period.'
          : 'The return now bills in the corrected period.',
      );
      setReason('');
      setApproval('');
    } catch (err) {
      toast.error(
        'Could not correct the billing date',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
        Correct billing date (staff only)
      </p>
      <p className="text-xs text-ink-2">
        Current billing date:{' '}
        <span className="font-semibold text-ink">{shortDay(currentBillingDate)}</span>
      </p>
      <input
        type="date"
        className={field}
        value={newBillingDay}
        onChange={(e) => setNewBillingDay(e.target.value)}
      />
      <input
        className={field}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required)"
        maxLength={500}
      />
      <input
        className={field}
        value={approval}
        onChange={(e) => setApproval(e.target.value)}
        placeholder="DJ approval reference (finalized periods only)"
        maxLength={200}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-3">
          Moves which period this return bills in. A finalized period is refused unless a
          DJ approval reference is supplied, and the original invoice is never rewritten.
        </p>
        <Button variant="secondary" onClick={apply} disabled={saving || !ready}>
          {saving ? 'Saving…' : 'Correct'}
        </Button>
      </div>
    </div>
  );
}
