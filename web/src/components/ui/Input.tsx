import React, {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle, ChevronDown, Eye, EyeOff, Lock, Mail } from 'lucide-react';

function FieldError({ error }: { error?: string | null }) {
  return (
    <div
      className={`grid transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
        error ? 'mt-1.5 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="overflow-hidden">
        <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-danger">
          <AlertCircle size={14} strokeWidth={2.5} />
          <span>{error}</span>
        </div>
      </div>
    </div>
  );
}

export interface BaseInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'placeholder'> {
  label: string;
  error?: string | null;
}

export const EmailInput = React.forwardRef<HTMLInputElement, BaseInputProps>(
  ({ label, error, id, className, ...props }, ref) => {
    const inputId = id || 'email-input';
    
    return (
      <div className={`relative w-full ${props.disabled ? 'opacity-60' : ''} ${className || ''}`}>
        <div className="relative group">
          <input
            ref={ref}
            id={inputId}
            type="email"
            placeholder=" "
            className={`
              peer w-full rounded-[10px] border bg-surface pb-2 pt-[22px] text-[14px] text-ink outline-none transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]
              pl-10 pr-4
              ${error 
                ? 'border-danger/60 focus:border-danger focus:ring-[4px] focus:ring-danger/10' 
                : 'border-line hover:border-line-2 focus:border-brand focus:ring-[4px] focus:ring-brand/15'
              }
              disabled:cursor-not-allowed disabled:bg-surface-2
            `}
            {...props}
          />
          <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 transition-colors duration-200 peer-focus:text-brand">
            <Mail size={18} strokeWidth={2} />
          </div>
          <label
            htmlFor={inputId}
            className={`
              absolute left-10 pointer-events-none transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]
              /* Floating state */
              top-[7px] text-[11px] font-medium text-ink-3
              /* Resting state */
              peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-[14px] peer-placeholder-shown:font-normal
              /* Focused state */
              peer-focus:top-[7px] peer-focus:-translate-y-0 peer-focus:text-[11px] peer-focus:font-medium peer-focus:text-brand
              ${error ? 'peer-focus:text-danger text-danger' : ''}
            `}
          >
            {label}
          </label>
        </div>
        
        {/* Error message slide down */}
        <div
          className={`grid transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
            error ? 'grid-rows-[1fr] opacity-100 mt-1.5' : 'grid-rows-[0fr] opacity-0 mt-0'
          }`}
        >
          <div className="overflow-hidden">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-danger">
              <AlertCircle size={14} strokeWidth={2.5} />
              <span>{error}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
);
EmailInput.displayName = 'EmailInput';

export const PasswordInput = React.forwardRef<HTMLInputElement, BaseInputProps>(
  ({ label, error, id, className, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);
    const inputId = id || 'password-input';
    
    return (
      <div className={`relative w-full ${props.disabled ? 'opacity-60' : ''} ${className || ''}`}>
        <div className="relative group">
          <input
            ref={ref}
            id={inputId}
            type={showPassword ? 'text' : 'password'}
            placeholder=" "
            className={`
              peer w-full rounded-[10px] border bg-surface pb-2 pt-[22px] text-[14px] text-ink outline-none transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]
              pl-10 pr-10
              ${error 
                ? 'border-danger/60 focus:border-danger focus:ring-[4px] focus:ring-danger/10' 
                : 'border-line hover:border-line-2 focus:border-brand focus:ring-[4px] focus:ring-brand/15'
              }
              disabled:cursor-not-allowed disabled:bg-surface-2
            `}
            {...props}
          />
          <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 transition-colors duration-200 peer-focus:text-brand">
            <Lock size={18} strokeWidth={2} />
          </div>
          <label
            htmlFor={inputId}
            className={`
              absolute left-10 pointer-events-none transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]
              /* Floating state */
              top-[7px] text-[11px] font-medium text-ink-3
              /* Resting state */
              peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-[14px] peer-placeholder-shown:font-normal
              /* Focused state */
              peer-focus:top-[7px] peer-focus:-translate-y-0 peer-focus:text-[11px] peer-focus:font-medium peer-focus:text-brand
              ${error ? 'peer-focus:text-danger text-danger' : ''}
            `}
          >
            {label}
          </label>
          
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            tabIndex={-1}
            disabled={props.disabled}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 -translate-y-1/2 grid h-8 w-8 place-items-center rounded-md text-ink-3 outline-none transition-colors duration-200 hover:bg-surface-2 hover:text-ink-2 focus-visible:bg-surface-2 focus-visible:text-brand disabled:pointer-events-none"
          >
            {showPassword ? (
              <EyeOff size={16} strokeWidth={2} className="animate-fadeIn" />
            ) : (
              <Eye size={16} strokeWidth={2} className="animate-fadeIn" />
            )}
          </button>
        </div>
        
        {/* Error message slide down */}
        <div
          className={`grid transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
            error ? 'grid-rows-[1fr] opacity-100 mt-1.5' : 'grid-rows-[0fr] opacity-0 mt-0'
          }`}
        >
          <div className="overflow-hidden">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-danger">
              <AlertCircle size={14} strokeWidth={2.5} />
              <span>{error}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
);
PasswordInput.displayName = 'PasswordInput';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'placeholder'> {
  label: string;
  error?: string | null;
  leftIcon?: ReactNode;
}

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, error, id, className, leftIcon, type = 'text', ...props }, ref) => {
    const reactId = useId();
    const inputId = id || reactId;
    const pad = leftIcon ? 'pl-10' : 'pl-4';
    const labelLeft = leftIcon ? 'left-10' : 'left-4';

    return (
      <div className={`relative w-full ${props.disabled ? 'opacity-60' : ''} ${className || ''}`}>
        <div className="group relative">
          <input
            ref={ref}
            id={inputId}
            type={type}
            placeholder=" "
            aria-invalid={error ? true : undefined}
            className={`
              peer w-full rounded-[10px] border bg-surface pb-2 pt-[22px] pr-4 ${pad} text-[14px] text-ink outline-none transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]
              ${error
                ? 'border-danger/60 focus:border-danger focus:ring-[4px] focus:ring-danger/10'
                : 'border-line hover:border-line-2 focus:border-brand focus:ring-[4px] focus:ring-brand/15'
              }
              disabled:cursor-not-allowed disabled:bg-surface-2
            `}
            {...props}
          />
          {leftIcon ? (
            <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 transition-colors duration-200 peer-focus:text-brand">
              {leftIcon}
            </div>
          ) : null}
          <label
            htmlFor={inputId}
            className={`
              pointer-events-none absolute ${labelLeft} transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]
              top-[7px] text-[11px] font-medium text-ink-3
              peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-[14px] peer-placeholder-shown:font-normal
              peer-focus:top-[7px] peer-focus:-translate-y-0 peer-focus:text-[11px] peer-focus:font-medium peer-focus:text-brand
              ${error ? 'text-danger peer-focus:text-danger' : ''}
            `}
          >
            {label}
          </label>
        </div>
        <FieldError error={error} />
      </div>
    );
  },
);
TextField.displayName = 'TextField';

export interface TextareaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'placeholder'> {
  label: string;
  error?: string | null;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaFieldProps>(
  ({ label, error, id, className, rows = 4, ...props }, ref) => {
    const reactId = useId();
    const inputId = id || reactId;

    return (
      <div className={`relative w-full ${props.disabled ? 'opacity-60' : ''} ${className || ''}`}>
        <div className="group relative">
          <textarea
            ref={ref}
            id={inputId}
            rows={rows}
            placeholder=" "
            aria-invalid={error ? true : undefined}
            className={`
              peer w-full resize-y rounded-[10px] border bg-surface px-4 pb-2 pt-[24px] text-[14px] text-ink outline-none transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]
              ${error
                ? 'border-danger/60 focus:border-danger focus:ring-[4px] focus:ring-danger/10'
                : 'border-line hover:border-line-2 focus:border-brand focus:ring-[4px] focus:ring-brand/15'
              }
              disabled:cursor-not-allowed disabled:bg-surface-2
            `}
            {...props}
          />
          <label
            htmlFor={inputId}
            className={`
              pointer-events-none absolute left-4 top-[8px] transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]
              text-[11px] font-medium text-ink-3
              peer-placeholder-shown:top-[18px] peer-placeholder-shown:text-[14px] peer-placeholder-shown:font-normal
              peer-focus:top-[8px] peer-focus:text-[11px] peer-focus:font-medium peer-focus:text-brand
              ${error ? 'text-danger peer-focus:text-danger' : ''}
            `}
          >
            {label}
          </label>
        </div>
        <FieldError error={error} />
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string | null;
}

export const SelectField = React.forwardRef<HTMLSelectElement, SelectFieldProps>(
  ({ label, error, id, className, children, ...props }, ref) => {
    const reactId = useId();
    const inputId = id || reactId;

    return (
      <div className={`relative w-full ${props.disabled ? 'opacity-60' : ''} ${className || ''}`}>
        <div className="group relative">
          <select
            ref={ref}
            id={inputId}
            aria-invalid={error ? true : undefined}
            className={`
              peer w-full appearance-none rounded-[10px] border bg-surface px-4 pb-2 pr-10 pt-[22px] text-[14px] text-ink outline-none transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]
              ${error
                ? 'border-danger/60 focus:border-danger focus:ring-[4px] focus:ring-danger/10'
                : 'border-line hover:border-line-2 focus:border-brand focus:ring-[4px] focus:ring-brand/15'
              }
              disabled:cursor-not-allowed disabled:bg-surface-2
            `}
            {...props}
          >
            {children}
          </select>
          <label
            htmlFor={inputId}
            className={`pointer-events-none absolute left-4 top-[7px] text-[11px] font-medium transition-colors duration-200 ${
              error ? 'text-danger' : 'text-ink-3 peer-focus:text-brand'
            }`}
          >
            {label}
          </label>
          <ChevronDown
            size={16}
            className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-3 transition-colors duration-200 peer-focus:text-brand"
          />
        </div>
        <FieldError error={error} />
      </div>
    );
  },
);
SelectField.displayName = 'SelectField';
