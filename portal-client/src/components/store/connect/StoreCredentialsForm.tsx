import type { FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, ShieldCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { StorePlatform } from '@/data/storePlatforms';
import { cn } from '@/lib/cn';
import { StoreLogo } from '../StoreLogo';
import { ConnectField, connectInputClass } from './ConnectField';
import type { StoreValidationState } from './types';

interface StoreCredentialsFormProps {
  platform: StorePlatform;
  storeName: string;
  values: Record<string, string>;
  errors: Record<string, string>;
  shown: Record<string, boolean>;
  validating: boolean;
  validation: StoreValidationState | null;
  onStoreNameChange: (value: string) => void;
  onValuesChange: (values: Record<string, string>) => void;
  onShownChange: (shown: Record<string, boolean>) => void;
  onBack: () => void;
  onCancel: () => void;
  onReview: (event: FormEvent) => void;
}

export function StoreCredentialsForm(props: StoreCredentialsFormProps) {
  function toggleShown(key: string, reveal: boolean) {
    props.onShownChange({ ...props.shown, [key]: !reveal });
  }

  return (
    <form onSubmit={props.onReview} className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-white/60 p-5">
        <button
          type="button"
          onClick={props.onBack}
          className="focus-ring -ml-1 inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium text-ink-3 transition-colors hover:text-brand-600"
        >
          <ArrowLeft size={15} /> Platforms
        </button>
        <p className="mt-2 text-xs font-bold uppercase tracking-wider text-brand-600">Connect a store</p>
        <h2 className="font-display text-2xl font-bold tracking-tight text-ink">{props.platform.name}</h2>
        <p className="mt-0.5 text-sm text-ink-3">
          Enter the credentials PrepShip should use for this store connection.
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <div className="flex items-center gap-3 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
          <StoreLogo platform={props.platform} />
          <div>
            <p className="text-sm font-bold text-ink">{props.platform.name}</p>
            <p className="text-xs text-ink-3">{props.platform.description}</p>
          </div>
        </div>
        <ConnectField label="Store name" error={props.errors.__storeName}>
          <input
            value={props.storeName}
            onChange={(event) => props.onStoreNameChange(event.target.value)}
            className={connectInputClass(Boolean(props.errors.__storeName))}
            placeholder={props.platform.name}
          />
        </ConnectField>
        {props.platform.id === 'shopify' && (
          <div className="rounded-glass-sm bg-brand-50/70 p-3 text-xs leading-relaxed text-ink-3">
            <p className="font-semibold text-ink">How to get your app credentials</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              <li>Go to <span className="font-medium text-ink-2">dev.shopify.com</span> and sign in with your store's account</li>
              <li>Create an app (name it e.g. "PrepShip") and add the Admin API scopes below before installing it on your store</li>
              <li>Open the app's <span className="font-medium text-ink-2">Settings</span> page and copy the <span className="font-medium text-ink-2">Client ID</span> and <span className="font-medium text-ink-2">Client secret</span></li>
              <li>Paste them below with your <span className="font-medium text-ink-2">.myshopify.com</span> domain</li>
            </ol>
            <p className="mt-2 break-words rounded bg-white/70 p-2 font-mono text-[11px] leading-relaxed text-ink-2">
              read_customers, read_draft_orders, read_fulfillments, write_fulfillments, read_locations, read_merchant_managed_fulfillment_orders, write_merchant_managed_fulfillment_orders, read_orders, write_orders, read_products
            </p>
            <p className="mt-1.5 flex items-center gap-1 text-ink-3">
              <ShieldCheck size={13} className="shrink-0 text-brand-600" />
              PrepShip uses these scopes to read orders, products, customers, and locations, then send fulfillment and tracking updates.
            </p>
          </div>
        )}
        {props.platform.credentialFields.map((field) => {
          const isPassword = field.type === 'password';
          const reveal = props.shown[field.key];
          return (
            <ConnectField key={field.key} label={field.label} error={props.errors[field.key]}>
              <div className="relative">
                <input
                  type={isPassword && !reveal ? 'password' : field.type === 'url' ? 'url' : 'text'}
                  value={props.values[field.key] ?? ''}
                  onChange={(event) => props.onValuesChange({
                    ...props.values,
                    [field.key]: event.target.value,
                  })}
                  placeholder={field.placeholder}
                  className={cn(connectInputClass(Boolean(props.errors[field.key])), isPassword && 'pr-10')}
                  autoComplete="off"
                />
                {isPassword && (
                  <button
                    type="button"
                    onClick={() => toggleShown(field.key, Boolean(reveal))}
                    aria-label={reveal ? 'Hide' : 'Show'}
                    className="focus-ring absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1.5 text-ink-3 hover:text-brand-600"
                  >
                    {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                )}
              </div>
            </ConnectField>
          );
        })}
        {props.validation && (
          <p className={cn(
            'flex items-start gap-1.5 rounded-glass-sm px-3 py-2 text-xs font-medium',
            props.validation.ok ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600',
          )}>
            {props.validation.ok
              ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              : <XCircle size={14} className="mt-0.5 shrink-0" />}
            {props.validation.message}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 border-t border-white/60 p-4">
        <Button type="button" variant="ghost" className="flex-1" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" disabled={props.validating}>
          {props.validating ? 'Validating…' : 'Review connection'}
        </Button>
      </div>
    </form>
  );
}
