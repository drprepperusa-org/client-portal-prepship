import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImageOff, ZoomIn } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Small product thumbnail that pops a large magnifier preview on hover.
 * The preview is portalled to <body> so the table's overflow can't clip it,
 * and positioned beside the thumbnail (flipping to the other side near edges).
 * Falls back to an ImageOff tile when the src is missing or fails to load.
 */
export function HoverZoomImage({
  src,
  alt = '',
  size = 28,
  zoom = 220,
  rounded = 'rounded',
  className,
}: {
  src?: string | null;
  alt?: string;
  size?: number;
  zoom?: number;
  rounded?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const ref = useRef<HTMLSpanElement>(null);
  const dim = { width: size, height: size };

  function onEnter() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const margin = 12;
    let left = r.right + margin;
    if (left + zoom > window.innerWidth - 8) left = r.left - zoom - margin; // flip to the left near the right edge
    let top = r.top + r.height / 2 - zoom / 2;
    top = Math.max(8, Math.min(top, window.innerHeight - zoom - 8));
    setPos({ top, left });
    setHover(true);
  }

  if (!src || failed) {
    return (
      <span className={cn('grid shrink-0 place-items-center bg-slate-100 text-slate-300 ring-1 ring-slate-200', rounded, className)} style={dim} aria-hidden>
        <ImageOff size={Math.max(11, Math.round(size * 0.42))} />
      </span>
    );
  }

  return (
    <span ref={ref} className="group relative inline-flex shrink-0" onMouseEnter={onEnter} onMouseLeave={() => setHover(false)}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={cn('shrink-0 cursor-zoom-in object-cover ring-1 ring-slate-200 transition-shadow group-hover:ring-brand-300', rounded, className)}
        style={dim}
      />
      <span className="pointer-events-none absolute -bottom-1 -right-1 hidden place-items-center rounded-full bg-brand-600 p-0.5 text-white shadow group-hover:grid">
        <ZoomIn size={8} />
      </span>

      {hover &&
        createPortal(
          <div className="pointer-events-none fixed z-[80]" style={{ top: pos.top, left: pos.left }}>
            <div className="overflow-hidden rounded-glass bg-white p-1.5 shadow-glass-lg ring-1 ring-slate-200">
              <img src={src} alt={alt} style={{ width: zoom, height: zoom }} className="rounded-md bg-slate-50 object-contain" />
              {alt && <p className="max-w-[220px] truncate px-1 pt-1 text-[11px] text-ink-3" title={alt}>{alt}</p>}
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
