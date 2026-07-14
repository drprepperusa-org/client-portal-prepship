import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { StorePlatform } from '@/data/storePlatforms';
import { cn } from '@/lib/cn';
import { StoreConnectionReview } from './connect/StoreConnectionReview';
import { StoreCredentialsForm } from './connect/StoreCredentialsForm';
import { StorePlatformList } from './connect/StorePlatformList';
import type {
  ConnectDraft,
  StoreConnectFilter,
  StoreValidationResult,
  StoreValidationState,
} from './connect/types';

export type { ConnectDraft } from './connect/types';

type Stage = 'list' | 'creds' | 'review';

interface StoreConnectModalProps {
  open: boolean;
  onClose: () => void;
  onConnect: (draft: ConnectDraft) => void;
  onValidate?: (draft: ConnectDraft) => Promise<StoreValidationResult>;
}

/** Store connector stage machine: discovery → credentials → review. */
export function StoreConnectModal({
  open,
  onClose,
  onConnect,
  onValidate,
}: StoreConnectModalProps) {
  const [stage, setStage] = useState<Stage>('list');
  const [filter, setFilter] = useState<StoreConnectFilter>('all');
  const [platform, setPlatform] = useState<StorePlatform | null>(null);
  const [storeName, setStoreName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<StoreValidationState | null>(null);

  function reset() {
    setStage('list');
    setFilter('all');
    setPlatform(null);
    setStoreName('');
    setValues({});
    setErrors({});
    setShown({});
    setValidating(false);
    setValidation(null);
  }

  function close() {
    onClose();
    window.setTimeout(reset, 200);
  }

  function choose(nextPlatform: StorePlatform) {
    setPlatform(nextPlatform);
    setStoreName(nextPlatform.name);
    setValues({});
    setErrors({});
    setValidation(null);
    setStage('creds');
  }

  function validate(): boolean {
    if (!platform) return false;
    const nextErrors: Record<string, string> = {};
    if (!storeName.trim()) nextErrors.__storeName = 'Store name is required';
    for (const field of platform.credentialFields) {
      if (field.required && !values[field.key]?.trim()) {
        nextErrors[field.key] = `${field.label} is required`;
      }
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function submitCreds(event: FormEvent) {
    event.preventDefault();
    if (!validate() || !platform) return;
    if (platform.id === 'shopify' && onValidate) {
      setValidating(true);
      setValidation(null);
      try {
        const result = await onValidate({ platform, storeName, values });
        if (!result.ok) {
          setValidation({
            ok: false,
            message: result.rateLimited
              ? 'Too many attempts — wait a minute and try again.'
              : result.message ?? "Couldn't connect — check your shop domain and app credentials.",
          });
          return;
        }
        setValidation({
          ok: true,
          message: `Connected to ${result.displayAccountIdentifier ?? 'your store'} — pending PrepShip approval after submit.`,
        });
        setStage('review');
      } finally {
        setValidating(false);
      }
      return;
    }
    setStage('review');
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            className="fixed inset-0 z-[70] bg-ink/40 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-[71] grid place-items-center p-4" onClick={close}>
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 240, damping: 26 }}
              onClick={(event) => event.stopPropagation()}
              className={cn(
                'glass-strong relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-glass-lg',
                'shadow-glass-lg',
                stage === 'list' ? 'h-[88vh] max-h-[640px] max-w-4xl' : 'max-w-lg',
              )}
              role="dialog"
              aria-modal="true"
              aria-label="Connect a store"
            >
              <button
                onClick={close}
                aria-label="Close"
                className={cn(
                  'focus-ring absolute right-4 top-4 z-10 grid h-9 w-9 cursor-pointer place-items-center',
                  'rounded-lg bg-white/80 text-ink-3 shadow-glass ring-1 ring-slate-200',
                  'transition-colors hover:text-ink',
                )}
              >
                <X size={18} />
              </button>
              {stage === 'list' ? (
                <StorePlatformList
                  filter={filter}
                  onFilterChange={setFilter}
                  onChoose={choose}
                />
              ) : stage === 'creds' && platform ? (
                <StoreCredentialsForm
                  platform={platform}
                  storeName={storeName}
                  values={values}
                  errors={errors}
                  shown={shown}
                  validating={validating}
                  validation={validation}
                  onStoreNameChange={setStoreName}
                  onValuesChange={setValues}
                  onShownChange={setShown}
                  onBack={() => setStage('list')}
                  onCancel={close}
                  onReview={submitCreds}
                />
              ) : stage === 'review' && platform ? (
                <StoreConnectionReview
                  platform={platform}
                  storeName={storeName}
                  values={values}
                  onBack={() => setStage('creds')}
                  onConfirm={() => {
                    onConnect({ platform, storeName: storeName.trim(), values });
                    close();
                  }}
                />
              ) : null}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
