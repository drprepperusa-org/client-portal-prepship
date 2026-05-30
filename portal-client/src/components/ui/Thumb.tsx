import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Product thumbnail with a graceful fallback. If `src` is missing OR the image
 * fails to load (404 / broken remote URL), it swaps to a neutral ImageOff
 * placeholder instead of showing the browser's broken-image glyph. `onError`
 * stops React from re-attempting and keeps the UI clean.
 */
export function Thumb({
  src,
  alt = '',
  size = 36,
  rounded = 'rounded-md',
  iconSize,
  className,
}: {
  src?: string | null;
  alt?: string;
  size?: number;
  rounded?: string;
  iconSize?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const dim = { width: size, height: size };

  if (!src || failed) {
    return (
      <span
        className={cn('grid shrink-0 place-items-center bg-slate-100 text-slate-300 ring-1 ring-slate-200', rounded, className)}
        style={dim}
        aria-hidden
      >
        <ImageOff size={iconSize ?? Math.max(11, Math.round(size * 0.42))} />
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn('shrink-0 object-cover ring-1 ring-slate-200', rounded, className)}
      style={dim}
    />
  );
}
