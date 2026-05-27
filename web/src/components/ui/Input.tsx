import React, { useState, type InputHTMLAttributes } from 'react';
import { Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';

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
