import { FileWarning, Image as ImageIcon, Video } from 'lucide-react';
import type { PortalReturnInspectionMedia } from '@/lib/api';

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function bytes(value: number | null) {
  if (value == null) return null;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function mediaDate(media: PortalReturnInspectionMedia) {
  const value = media.capturedAt ?? media.uploadedAt;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : dateTime.format(parsed);
}

export function ReturnAttachmentGallery({ media }: { media: PortalReturnInspectionMedia[] }) {
  if (!media.length) return null;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Inspection attachments">
      {media.map((item, index) => {
        const name = item.fileName || `${item.mediaType === 'video' ? 'Video' : 'Photo'} ${index + 1}`;
        return (
          <li key={item.id} className="overflow-hidden rounded-glass-sm bg-slate-50 ring-1 ring-slate-200/70">
            {item.url ? (
              item.mediaType === 'video' ? (
                <video className="aspect-video w-full bg-ink object-contain" controls preload="metadata" aria-label={name}>
                  <source src={item.url} type={item.contentType ?? undefined} />
                </video>
              ) : (
                <img className="aspect-video w-full bg-slate-100 object-cover" src={item.url} alt={name} loading="lazy" />
              )
            ) : (
              <div className="grid aspect-video place-items-center bg-slate-100 text-ink-3">
                <span className="flex items-center gap-2 text-xs"><FileWarning size={18} /> Attachment unavailable</span>
              </div>
            )}
            <div className="space-y-1 p-2.5">
              <p className="flex items-center gap-1.5 truncate text-xs font-medium text-ink" title={name}>
                {item.mediaType === 'video' ? <Video size={14} /> : <ImageIcon size={14} />} {name}
              </p>
              <p className="text-[11px] text-ink-3">
                {[bytes(item.sizeBytes), mediaDate(item)].filter(Boolean).join(' · ') || 'Saved attachment'}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
