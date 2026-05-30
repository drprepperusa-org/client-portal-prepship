import { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, RefreshCw, Settings2, Unplug, Plug } from 'lucide-react';
import { BrandMark } from './StoreLogo';
import type { PortalIntegration } from '@/lib/api';
import { staggerItem } from '@/lib/motion';
import { shortDate } from '@/lib/status';
import { cn } from '@/lib/cn';

const FACE = 'absolute inset-0 flex flex-col rounded-glass p-5';
// backface-visibility hidden so only the forward-facing side is visible mid-flip.
const backface = { backfaceVisibility: 'hidden' as const, WebkitBackfaceVisibility: 'hidden' as const };

/**
 * Connection tile that gently floats and flips on click to reveal connection
 * details. The flip is CSS-driven (transform + transition) rather than via
 * Framer so it still works when `prefers-reduced-motion` is set (Framer
 * suppresses transform animations there); under reduced motion the global CSS
 * zeroes the duration → an instant, accessible flip.
 */
export function ConnectionCard({
  integration,
  index = 0,
  onReconfigure,
  onDisconnect,
}: {
  integration: PortalIntegration;
  index?: number;
  onReconfigure?: (c: PortalIntegration) => void;
  onDisconnect?: (c: PortalIntegration) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const c = integration;
  const name = c.label ?? c.provider ?? 'Integration';
  const typeLabel = c.type === 'carrier' ? 'Carrier' : 'Store';
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <motion.div variants={staggerItem}>
      {/* Floating wrapper — staggered via animation-delay so cards don't bob in unison.
          `perspective` lives here (the flip container's DIRECT parent) so the
          rotateY reads as a real 3D flip, not a flat mirror. */}
      <div className="animate-floaty" style={{ animationDelay: `${(index % 6) * 0.45}s`, perspective: 1400 }}>
        {/* Flip container — CSS rotateY toggled by `flipped`. */}
        <div
          onClick={() => setFlipped((f) => !f)}
          role="button"
          tabIndex={0}
          aria-label={`${name} connection — click to flip`}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setFlipped((f) => !f)}
          className="relative h-60 cursor-pointer rounded-glass transition-[transform,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:shadow-glass-lg [transform-style:preserve-3d]"
          style={{ transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
        >
          {/* ---- FRONT ---- */}
          <div className={cn(FACE, 'glass')} style={backface}>
            <div className="flex items-start justify-between">
              <BrandMark provider={c.provider} label={c.label} name={name} size={48} />
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', c.active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-ink-3')}>
                {c.active ? <CheckCircle2 size={13} /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />}
                {c.active ? 'Connected' : 'Inactive'}
              </span>
            </div>

            <h3 className="mt-3 font-display text-base font-bold capitalize text-ink">{name}</h3>
            <p className="text-sm capitalize text-ink-3">{typeLabel}{c.provider ? ` · ${c.provider}` : ''}</p>

            <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Last sync</p>
                <p className="text-sm font-semibold text-emerald-600">Live</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Connected</p>
                <p className="text-sm font-semibold text-ink tnum">{shortDate(c.createdAt ?? c.updatedAt)}</p>
              </div>
            </div>

            <div className="mt-3 flex gap-2">
              <button onClick={(e) => { stop(e); onReconfigure?.(c); }} className="focus-ring flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-glass-sm bg-white/70 py-2 text-xs font-semibold text-ink-2 ring-1 ring-slate-200/70 transition-colors hover:bg-white">
                <Settings2 size={14} /> Reconfigure
              </button>
              <button onClick={(e) => { stop(e); onDisconnect?.(c); }} className="focus-ring flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-glass-sm bg-rose-50 py-2 text-xs font-semibold text-rose-600 ring-1 ring-rose-200 transition-colors hover:bg-rose-100">
                <Unplug size={14} /> Disconnect
              </button>
            </div>
          </div>

          {/* ---- BACK (pre-rotated 180°) ---- */}
          <div className={cn(FACE, 'glass-strong')} style={{ ...backface, transform: 'rotateY(180deg)' }}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-ink">Connection details</h3>
              <RefreshCw size={15} className="text-ink-3" aria-hidden />
            </div>

            <p className="mt-4 text-[10px] font-bold uppercase tracking-wider text-ink-3">Account identifier</p>
            <div className="mt-1 rounded-glass-sm bg-white/70 px-3 py-2 ring-1 ring-slate-200/70">
              <code className="block break-all font-mono text-[12px] text-ink-2">{c.accountIdentifier ?? '—'}</code>
            </div>

            <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Provider</p>
                <p className="text-sm font-semibold capitalize text-ink">{name}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Connected</p>
                <p className="text-sm font-semibold text-ink tnum">{shortDate(c.createdAt ?? c.updatedAt)}</p>
              </div>
            </div>

            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-3"><Plug size={12} /> Tap card to flip back</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
