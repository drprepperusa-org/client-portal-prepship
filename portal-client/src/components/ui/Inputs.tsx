import { useState, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FieldShell, inputClasses } from './Field';

interface BaseProps {
  label?: string;
  helper?: string;
  error?: string;
  success?: string;
  required?: boolean;
  icon?: ReactNode;
  containerClassName?: string;
}

type InputAttrs = Omit<InputHTMLAttributes<HTMLInputElement>, 'children'>;

function LeadingIcon({ icon }: { icon: ReactNode }) {
  return (
    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">{icon}</span>
  );
}

/* ---------- Text ---------- */
export function TextInput({ label, helper, error, success, required, icon, containerClassName, className, ...rest }: BaseProps & InputAttrs) {
  return (
    <FieldShell label={label} helper={helper} error={error} success={success} required={required} className={containerClassName}>
      {(id, describedBy, invalid) => (
        <div className="relative">
          {icon && <LeadingIcon icon={icon} />}
          <input id={id} aria-describedby={describedBy} aria-invalid={invalid} className={cn(inputClasses(invalid, Boolean(icon)), className)} {...rest} />
        </div>
      )}
    </FieldShell>
  );
}

/* ---------- Email (validates @) ---------- */
export function EmailInput(props: BaseProps & InputAttrs) {
  const [touched, setTouched] = useState(false);
  const val = String(props.value ?? '');
  const auto = touched && val.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) ? 'Enter a valid email address' : undefined;
  return (
    <TextInput
      type="email"
      inputMode="email"
      {...props}
      error={props.error ?? auto}
      onBlur={(e) => {
        setTouched(true);
        props.onBlur?.(e);
      }}
    />
  );
}

/* ---------- URL (validates web address) ---------- */
export function UrlInput(props: BaseProps & InputAttrs) {
  const [touched, setTouched] = useState(false);
  const val = String(props.value ?? '');
  const ok = /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/i.test(val);
  const auto = touched && val.length > 0 && !ok ? 'Enter a valid URL' : undefined;
  return (
    <TextInput
      type="url"
      inputMode="url"
      placeholder="https://example.com"
      {...props}
      error={props.error ?? auto}
      onBlur={(e) => {
        setTouched(true);
        props.onBlur?.(e);
      }}
    />
  );
}

/* ---------- Password (show/hide) ---------- */
export function PasswordInput({ label, helper, error, success, required, icon, containerClassName, className, ...rest }: BaseProps & InputAttrs) {
  const [show, setShow] = useState(false);
  return (
    <FieldShell label={label} helper={helper} error={error} success={success} required={required} className={containerClassName}>
      {(id, describedBy, invalid) => (
        <div className="relative">
          {icon && <LeadingIcon icon={icon} />}
          <input
            id={id}
            type={show ? 'text' : 'password'}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            className={cn(inputClasses(invalid, Boolean(icon), true), className)}
            {...rest}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="focus-ring absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1.5 text-ink-3 transition-colors hover:text-brand-600"
          >
            {show ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
      )}
    </FieldShell>
  );
}

/* ---------- Number (with optional steppers) ---------- */
interface NumberProps extends BaseProps, Omit<InputAttrs, 'type'> {
  stepper?: boolean;
  min?: number;
  max?: number;
  step?: number;
  onValueChange?: (n: number) => void;
}
export function NumberInput({ label, helper, error, success, required, containerClassName, className, stepper, min, max, step = 1, value, onValueChange, ...rest }: NumberProps) {
  const num = Number(value ?? 0);
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  return (
    <FieldShell label={label} helper={helper} error={error} success={success} required={required} className={containerClassName}>
      {(id, describedBy, invalid) => (
        <div className="relative flex items-center">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            value={value}
            min={min}
            max={max}
            step={step}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(e) => onValueChange?.(Number(e.target.value))}
            className={cn(inputClasses(invalid, false, stepper), '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none', className)}
            {...rest}
          />
          {stepper && (
            <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 flex-col gap-0.5">
              <button type="button" aria-label="Increment" onClick={() => onValueChange?.(clamp(num + step))} className="focus-ring cursor-pointer rounded bg-slate-100 px-1 py-0.5 text-ink-3 transition-colors hover:bg-brand-100 hover:text-brand-600">
                <Plus size={12} />
              </button>
              <button type="button" aria-label="Decrement" onClick={() => onValueChange?.(clamp(num - step))} className="focus-ring cursor-pointer rounded bg-slate-100 px-1 py-0.5 text-ink-3 transition-colors hover:bg-brand-100 hover:text-brand-600">
                <Minus size={12} />
              </button>
            </div>
          )}
        </div>
      )}
    </FieldShell>
  );
}

/* ---------- Textarea (auto-growing) ---------- */
type AreaAttrs = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'children'>;
export function TextArea({ label, helper, error, success, required, containerClassName, className, onChange, ...rest }: BaseProps & AreaAttrs) {
  return (
    <FieldShell label={label} helper={helper} error={error} success={success} required={required} className={containerClassName}>
      {(id, describedBy, invalid) => (
        <textarea
          id={id}
          rows={3}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onChange={(e) => {
            e.currentTarget.style.height = 'auto';
            e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
            onChange?.(e);
          }}
          className={cn(inputClasses(invalid), 'h-auto min-h-[88px] resize-none py-3 leading-relaxed', className)}
          {...rest}
        />
      )}
    </FieldShell>
  );
}
