import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, RotateCcw, Trash2 } from 'lucide-react';
import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { safeDate } from '../../lib/api';
import type { CarrierAccount } from '../../types/portal';
import { StoreLogo } from './StoreLogo';
import { findConnectionPlatform } from './storePlatforms';

export function StoreConnectionCard({
  account,
  busy,
  onEdit,
  onDisconnect,
}: {
  account: CarrierAccount;
  busy: boolean;
  onEdit: () => void;
  onDisconnect: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const name = account.label ?? account.provider ?? 'Store connection';
  const platform = findConnectionPlatform(account.provider, name);
  const identifier = account.accountIdentifier ?? account.account_identifier ?? 'Connected account';
  const providerLabel = platform.name;
  const connectedDate = safeDate(account.createdAt);

  function toggleCard() {
    setFlipped((value) => !value);
  }

  function stopCardToggle(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleCard();
    }
  }

  const buttonMotion = prefersReducedMotion
    ? undefined
    : { y: -1, scale: 1.015 };
  const pressMotion = prefersReducedMotion ? undefined : { scale: 0.98 };

  return (
    <motion.div
      className="portal-store-card glass-panel group relative flex min-h-[220px] w-full flex-col outline-none cursor-pointer"
      role="button"
      tabIndex={0}
      aria-expanded={flipped}
      aria-label={`${name} connection card`}
      onClick={toggleCard}
      onKeyDown={onKeyDown}
      whileHover={prefersReducedMotion ? undefined : { y: -4, scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 350, damping: 25, mass: 0.7 }}
      style={{ perspective: 1200 }}
    >
      <motion.div
        className="relative w-full flex-1"
        initial={false}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={
          prefersReducedMotion
            ? { duration: 0 }
            : { type: 'spring', stiffness: 230, damping: 24, mass: 0.82 }
        }
        style={{ transformStyle: 'preserve-3d' }}
      >
        <div
          className="portal-store-card-front flex w-full flex-1 flex-col p-5 bg-white/50 backdrop-blur"
          aria-hidden={flipped}
          style={{ backfaceVisibility: 'hidden', borderRadius: 'inherit', minHeight: '100%' }}
        >
          <div className="flex items-center justify-between">
            <StoreLogo platform={platform} provider={account.provider} label={name} />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 px-2.5 py-1 text-[11px] font-bold text-ok ring-1 ring-inset ring-ok/20">
              <CheckCircle2 size={13} strokeWidth={2.5} /> Connected
            </span>
          </div>
          <div className="mt-4 flex flex-1 flex-col justify-center">
            <h2 className="text-[17px] font-black text-ink">{name}</h2>
            <p className="text-[13px] font-semibold text-ink-3">{providerLabel}</p>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-line/60 pt-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-ink-3">Last Sync</span>
              <strong className="text-[12px] text-ink">Live</strong>
            </div>
            <div className="flex flex-col gap-0.5 text-right">
              <span className="text-[10px] font-bold uppercase tracking-widest text-ink-3">Connected</span>
              <strong className="text-[12px] text-ink">{connectedDate}</strong>
            </div>
          </div>

          <div
            className="mt-4 flex gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100"
            onClick={stopCardToggle}
          >
            <motion.button
              type="button"
              className="flex-1 rounded-md bg-surface-2 py-1.5 text-[12px] font-bold text-ink-2 ring-1 ring-inset ring-line hover:bg-surface-3 hover:text-ink disabled:opacity-50"
              disabled={busy || flipped}
              onClick={onEdit}
              whileHover={buttonMotion}
              whileTap={pressMotion}
              transition={{ type: 'spring', stiffness: 420, damping: 24 }}
            >
              Reconfigure
            </motion.button>
            <motion.button
              type="button"
              className="flex-1 rounded-md bg-danger/10 py-1.5 text-[12px] font-bold text-danger ring-1 ring-inset ring-danger/20 hover:bg-danger hover:text-white disabled:opacity-50 flex items-center justify-center gap-1.5"
              disabled={busy || flipped}
              onClick={onDisconnect}
              whileHover={buttonMotion}
              whileTap={pressMotion}
              transition={{ type: 'spring', stiffness: 420, damping: 24 }}
            >
              <Trash2 size={13} /> {busy ? 'Working...' : 'Disconnect'}
            </motion.button>
          </div>
        </div>

        <div
          className="portal-store-card-back absolute inset-0 flex flex-col p-5 bg-surface-2/80 backdrop-blur"
          aria-hidden={!flipped}
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', borderRadius: 'inherit' }}
        >
          <div className="flex items-center justify-between border-b border-line/60 pb-3">
            <h2 className="text-[13px] font-bold text-ink">Connection details</h2>
            <motion.button
              type="button"
              className="grid h-7 w-7 place-items-center rounded-full bg-surface ring-1 ring-line text-ink-3 hover:bg-surface-3 hover:text-ink disabled:opacity-50"
              disabled={!flipped}
              onClick={(event) => {
                stopCardToggle(event);
                toggleCard();
              }}
              whileHover={buttonMotion}
              whileTap={pressMotion}
              transition={{ type: 'spring', stiffness: 420, damping: 24 }}
            >
              <RotateCcw size={13} strokeWidth={2.5} />
            </motion.button>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-ink-3 mb-1">Account identifier</span>
              <strong className="block w-full truncate rounded bg-surface px-2 py-1.5 font-mono text-[11px] text-ink ring-1 ring-line">
                {identifier}
              </strong>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-widest text-ink-3 mb-0.5">Provider</span>
                <strong className="text-[12px] text-ink">{providerLabel}</strong>
              </div>
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-widest text-ink-3 mb-0.5">Connected</span>
                <strong className="text-[12px] text-ink">{connectedDate}</strong>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
