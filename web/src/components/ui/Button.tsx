import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

const base =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-btn font-extrabold ' +
  'transition-all duration-200 ease-out cursor-pointer ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:brightness-100 ' +
  'motion-reduce:transform-none motion-reduce:transition-none';

const variants: Record<ButtonVariant, string> = {
  primary:
    'text-white shadow-[0_8px_18px_rgb(var(--brand-rgb)/0.22)] ' +
    'bg-[linear-gradient(135deg,rgb(var(--brand-rgb)),rgb(var(--brand-dark-rgb)))] ' +
    'hover:-translate-y-px hover:brightness-[1.03] active:translate-y-0 active:scale-[0.985] ' +
    'focus-visible:outline-brand/40',
  secondary:
    'bg-surface text-ink shadow-[inset_0_0_0_1px_rgb(var(--line-rgb))] ' +
    'hover:-translate-y-px hover:bg-surface-2 hover:shadow-sm active:translate-y-0 active:scale-[0.985] ' +
    'focus-visible:outline-brand/35',
  ghost:
    'bg-transparent text-ink-2 ' +
    'hover:bg-brand-bg hover:text-brand active:scale-[0.985] ' +
    'focus-visible:outline-brand/35',
  danger:
    'bg-danger text-white ' +
    'hover:-translate-y-px hover:bg-danger/90 hover:shadow-sm active:translate-y-0 active:scale-[0.985] ' +
    'focus-visible:outline-danger/35',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[12px]',
  md: 'h-10 px-4 text-[13px]',
  lg: 'h-11 px-5 text-[14px]',
};

const iconSize: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 16 };

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
    disabled,
    className = '',
    children,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`${base} ${variants[variant]} ${sizes[size]}${fullWidth ? ' w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? (
        <Loader2 size={iconSize[size]} className="animate-spin" aria-hidden />
      ) : (
        leftIcon
      )}
      {children}
      {!loading ? rightIcon : null}
    </button>
  );
});

export default Button;
