import { Loader2 } from 'lucide-react';

/** Presentation only: the owning query reports when a read is in flight. */
export function TableUpdateStatus({ updating = false }: { updating?: boolean }) {
  if (!updating) return null;
  return (
    <div role="status" className="flex items-center justify-end gap-1.5 px-3 py-2 text-xs text-ink-3">
      <Loader2 size={13} className="animate-spin" aria-hidden="true" />
      Updating…
    </div>
  );
}
