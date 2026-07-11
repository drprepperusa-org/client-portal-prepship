import { Chip } from '@/components/ui/Display';
import type { PortalReturnInspection } from '@/lib/api';
import { ReturnAttachmentGallery } from './ReturnAttachmentGallery';

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function formatDateTime(value: string | null) {
  if (!value) return 'Date not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Date not recorded' : dateTime.format(parsed);
}

export function ReturnInspectionHistory({ inspections }: { inspections: PortalReturnInspection[] }) {
  if (!inspections.length) return <p className="text-sm text-ink-3">No inspection recorded yet.</p>;
  return (
    <ol className="space-y-4" aria-label="Inspection history">
      {inspections.map((inspection) => (
        <li key={inspection.id} className="space-y-3 rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Chip accent={inspection.status === 'failed' ? 'rose' : inspection.status === 'passed' ? 'teal' : 'amber'} dot={false}>
                {inspection.status}
              </Chip>
              {inspection.condition && <span className="text-xs font-medium text-ink-2">{inspection.condition.replace(/_/g, ' ')}</span>}
            </div>
            <span className="text-xs text-ink-3">{formatDateTime(inspection.receivedAt ?? inspection.createdAt)}</span>
          </div>
          <p className="text-xs text-ink-3">Recorded by {inspection.actorLabel}</p>
          {inspection.comments ? <p className="whitespace-pre-wrap text-sm text-ink-2">{inspection.comments}</p> : <p className="text-sm text-ink-3">No notes.</p>}
          <ReturnAttachmentGallery media={inspection.media} />
        </li>
      ))}
    </ol>
  );
}
