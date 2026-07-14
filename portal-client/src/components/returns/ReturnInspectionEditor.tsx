import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, PackageCheck, X } from 'lucide-react';
import { useAuth } from '@/auth';
import { field, Labeled } from '@/components/inbound/shared';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { portalApi, type ReturnInspectionCondition } from '@/lib/api';

const CONDITIONS: Array<{ value: ReturnInspectionCondition; label: string }> = [
  { value: 'sealed_new', label: 'Sealed / new' },
  { value: 'opened_good', label: 'Opened / good' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'missing_item', label: 'Missing item' },
  { value: 'wrong_item', label: 'Wrong item' },
  { value: 'other', label: 'Other' },
];
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const VIDEO_MAX_BYTES = 25 * 1024 * 1024;

interface CapturedMedia {
  id: string;
  mediaType: 'photo' | 'video';
  file: File;
  name: string;
  status: 'queued' | 'uploading' | 'saved' | 'failed';
}

interface ReturnInspectionEditorProps {
  returnId: number;
  onSaved?: () => void;
  onCancel?: () => void;
}

/** Shared inspection editor. The backend scopes every write to the caller's returns. */
export function ReturnInspectionEditor({
  returnId,
  onSaved,
  onCancel,
}: ReturnInspectionEditorProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const [condition, setCondition] = useState<ReturnInspectionCondition | ''>('');
  const [receivedAt, setReceivedAt] = useState(() => toLocalInput(new Date()));
  const [comments, setComments] = useState('');
  const [media, setMedia] = useState<CapturedMedia[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedInspectionId, setSavedInspectionId] = useState<number | null>(null);
  const canSave = useMemo(
    () => Boolean(accessToken && receivedAt) && !saving,
    [accessToken, receivedAt, saving],
  );

  function captureFiles(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files);
    const next: CapturedMedia[] = [];
    let skipped = 0;
    for (const file of selected) {
      const mediaType = file.type.startsWith('image/')
        ? 'photo'
        : file.type.startsWith('video/')
          ? 'video'
          : null;
      if (!mediaType) {
        skipped += 1;
        continue;
      }
      const maxBytes = mediaType === 'photo' ? PHOTO_MAX_BYTES : VIDEO_MAX_BYTES;
      if (file.size > maxBytes) {
        skipped += 1;
        continue;
      }
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        mediaType,
        file,
        name: file.name,
        status: 'queued',
      });
    }
    if (skipped > 0) {
      toast.warning(
        'Some files were skipped',
        'Use image or video files only. Images can be up to 15 MB and videos up to 25 MB.',
      );
    }
    setMedia((current) => [...current, ...next]);
  }

  async function submit() {
    if (!accessToken || !canSave) return;
    setSaving(true);
    try {
      let inspectionId = savedInspectionId;
      if (inspectionId == null) {
        const result = await portalApi.recordInspection(accessToken, returnId, {
          receivedAt: fromLocalInput(receivedAt),
          condition: condition || undefined,
          comments: comments.trim() || undefined,
        });
        inspectionId = result.data.id;
        setSavedInspectionId(inspectionId);
      }

      const uploads = media.filter((item) => item.status !== 'saved');
      const failedIds = new Set<string>();
      for (const item of uploads) {
        setMedia((current) => current.map((file) => file.id === item.id ? { ...file, status: 'uploading' } : file));
        try {
          await portalApi.uploadInspectionMedia(accessToken, returnId, inspectionId, item.file, item.mediaType);
          setMedia((current) => current.map((file) => file.id === item.id ? { ...file, status: 'saved' } : file));
        } catch (error) {
          console.error('[returns] inspection media upload failed:', error);
          failedIds.add(item.id);
          setMedia((current) => current.map((file) => file.id === item.id ? { ...file, status: 'failed' } : file));
        }
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['returns'] }),
        queryClient.invalidateQueries({ queryKey: ['return', returnId] }),
        queryClient.invalidateQueries({ queryKey: ['returns-receiving'] }),
      ]);

      if (failedIds.size > 0) {
        setMedia((current) => current.filter((file) => failedIds.has(file.id)));
        toast.warning(
          'Notes saved; some files failed',
          `${failedIds.size} file${failedIds.size === 1 ? '' : 's'} did not upload. Retry below.`,
        );
      } else {
        const uploadSummary = uploads.length
          ? ` ${uploads.length} file${uploads.length === 1 ? '' : 's'} uploaded.`
          : '';
        toast.success('Inspection saved', uploadSummary || 'The return inspection was recorded.');
        setCondition('');
        setComments('');
        setMedia([]);
        setReceivedAt(toLocalInput(new Date()));
        setSavedInspectionId(null);
        onSaved?.();
      }
    } catch (error) {
      toast.error('Could not save inspection', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-glass-sm bg-brand-50/50 p-3 ring-1 ring-brand-100">
      <Labeled label="Received date/time">
        <input
          type="datetime-local"
          className={`${field} h-12 text-base`}
          value={receivedAt}
          onChange={(event) => setReceivedAt(event.target.value)}
          disabled={saving || savedInspectionId != null}
        />
      </Labeled>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-ink-2">Condition</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CONDITIONS.map((item) => {
            const active = condition === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setCondition(active ? '' : item.value)}
                aria-pressed={active}
                disabled={saving || savedInspectionId != null}
                className={
                  'focus-ring min-h-11 rounded-glass-sm px-2 py-2 text-sm font-medium ring-1 transition-colors ' +
                  (active
                    ? 'bg-brand-600 text-white ring-brand-600'
                    : 'bg-white/70 text-ink-2 ring-slate-200/70 hover:bg-white')
                }
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <Labeled label="Inspection notes (optional)">
        <textarea
          className={`${field} min-h-24 py-2`}
          value={comments}
          onChange={(event) => setComments(event.target.value)}
          placeholder="Add notes about the returned goods..."
          disabled={saving || savedInspectionId != null}
        />
      </Labeled>

      <div>
        <span className="mb-1 block text-xs font-medium text-ink-2">Pictures or video (optional)</span>
        <p className="mb-2 text-xs text-ink-3">Images up to 15 MB. Videos up to 25 MB.</p>
        <label
          className={
            'focus-within:ring-2 focus-within:ring-brand-400 flex min-h-12 cursor-pointer items-center ' +
            'justify-center gap-2 rounded-glass-sm border border-dashed border-slate-300 bg-white/70 ' +
            'px-3 py-3 text-sm font-medium text-ink-2 hover:bg-white'
          }
        >
          <Camera size={18} /> Add pictures or video
          <input
            type="file"
            accept="image/*,video/*"
            capture="environment"
            multiple
            className="sr-only"
            disabled={saving || savedInspectionId != null}
            onChange={(event) => {
              captureFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
        {media.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Files ready to upload" aria-live="polite">
            {media.map((item) => (
              <li key={item.id} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-white px-2 py-1 text-xs text-ink-2 ring-1 ring-slate-200/70">
                <span>{item.mediaType === 'video' ? 'Video' : 'Photo'}</span>
                <span className="max-w-32 truncate text-ink-3">{item.name}</span>
                <span className={item.status === 'failed' ? 'text-rose-600' : item.status === 'saved' ? 'text-teal-600' : 'text-ink-3'}>
                  {item.status === 'uploading' ? 'Uploading...' : item.status === 'failed' ? 'Failed' : item.status === 'saved' ? 'Saved' : 'Ready'}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => setMedia((current) => current.filter((file) => file.id !== item.id))}
                  disabled={saving}
                  className="focus-ring grid h-9 w-9 place-items-center rounded text-ink-3 hover:text-ink"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sticky -bottom-3 flex flex-col-reverse gap-2 bg-brand-50/95 py-3 backdrop-blur sm:flex-row sm:justify-end">
        {onCancel && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
        <Button
          leadingIcon={<PackageCheck size={16} />}
          onClick={submit}
          disabled={!canSave}
        >
          {saving ? 'Saving...' : savedInspectionId ? 'Retry failed uploads' : condition ? 'Save inspection' : 'Mark received'}
        </Button>
      </div>
    </div>
  );
}

function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
