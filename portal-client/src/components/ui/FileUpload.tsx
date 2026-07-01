import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UploadCloud, File as FileIcon, X, Check } from 'lucide-react';
import { cn } from '@/lib/cn';

interface UploadItem {
  id: number;
  name: string;
  size: number;
  progress: number;
  url?: string;
  type: string;
}

/** Drag-drop upload with preview + simulated progress (demo/showcase component). */
export function FileUpload({ label }: { label?: string }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Track created object URLs so previews don't leak (revoked on remove + unmount).
  const urlsRef = useRef<string[]>([]);
  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), []);

  function add(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((f) => {
      const id = Date.now() + Math.random();
      const url = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
      if (url) urlsRef.current.push(url);
      setItems((prev) => [...prev, { id, name: f.name, size: f.size, progress: 0, url, type: f.type }]);
      // simulate upload progress
      const tick = setInterval(() => {
        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== id) return it;
            const next = Math.min(100, it.progress + Math.random() * 26);
            if (next >= 100) clearInterval(tick);
            return { ...it, progress: next };
          }),
        );
      }, 240);
    });
  }

  function removeItem(item: UploadItem) {
    if (item.url) URL.revokeObjectURL(item.url);
    setItems((previous) => previous.filter((x) => x.id !== item.id));
  }

  return (
    <div className="flex flex-col gap-2">
      {label && <span className="text-[13px] font-semibold text-ink-2">{label}</span>}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'focus-ring flex cursor-pointer flex-col items-center justify-center gap-2 rounded-glass border-2 border-dashed px-6 py-8 text-center transition-all duration-200',
          drag ? 'border-brand-400 bg-brand-50/70' : 'border-slate-300 bg-white/50 hover:border-brand-300 hover:bg-brand-50/40',
        )}
      >
        <motion.span animate={drag ? { y: -4, scale: 1.1 } : { y: 0, scale: 1 }} className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glass">
          <UploadCloud size={22} />
        </motion.span>
        <p className="text-sm font-semibold text-ink">Drop files here, or <span className="text-brand-600">browse</span></p>
        <p className="text-xs text-ink-3">PNG, JPG, PDF or CSV up to 25MB</p>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => add(e.target.files)} />
      </div>
      <AnimatePresence>
        {items.map((it) => (
          <motion.div key={it.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }} className="glass flex items-center gap-3 rounded-glass-sm p-2.5">
            {it.url ? <img src={it.url} alt={it.name} className="h-10 w-10 rounded-md object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded-md bg-brand-100 text-brand-600"><FileIcon size={18} /></span>}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[13px] font-medium text-ink">{it.name}</p>
                <span className="shrink-0 text-xs text-ink-3">{(it.size / 1024).toFixed(0)} KB</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <motion.div className={cn('h-full rounded-full', it.progress >= 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-brand-400 to-brand-600')} animate={{ width: `${it.progress}%` }} transition={{ ease: 'easeOut' }} />
              </div>
            </div>
            {it.progress >= 100 ? (
              <Check size={16} className="text-emerald-500" />
            ) : (
              <button
                aria-label="Remove file"
                onClick={(event) => {
                  event.stopPropagation();
                  removeItem(it);
                }}
                className="focus-ring cursor-pointer rounded p-1 text-ink-3 hover:text-rose-500"
              >
                <X size={15} />
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
