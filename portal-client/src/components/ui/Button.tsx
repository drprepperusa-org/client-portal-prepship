import { forwardRef, type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { pressTap } from '@/lib/motion';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  children?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'text-white bg-gradient-to-br from-brand-400 to-brand-600 shadow-[0_8px_22px_rgba(3, 169, 244,0.32)] hover:shadow-[0_12px_30px_rgba(3, 169, 244,0.42)] hover:brightness-[1.04]',
  secondary:
    'text-ink glass-strong hover:bg-white/90 ring-1 ring-white/70',
  ghost:
    'text-ink-2 hover:bg-brand-50/80 hover:text-brand-600',
  danger:
    'text-white bg-gradient-to-br from-rose-400 to-rose-600 shadow-[0_8px_22px_rgba(244,63,94,0.3)] hover:brightness-[1.04]',
  icon: 'text-ink-2 glass-strong ring-1 ring-white/70 hover:text-brand-600',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-[13px] gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2.5',
};

const ICON_SIZES: Record<Size, string> = {
  sm: 'h-9 w-9',
  md: 'h-11 w-11',
  lg: 'h-12 w-12',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leadingIcon,
    trailingIcon,
    disabled,
    className,
    children,
    ...rest
  },
  ref,
) {
  const isIconOnly = variant === 'icon';
  const isDisabled = disabled || loading;

  return (
    <motion.button
      ref={ref}
      whileTap={isDisabled ? undefined : pressTap}
      whileHover={isDisabled ? undefined : { y: -1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      disabled={isDisabled}
      className={cn(
        'focus-ring relative inline-flex select-none items-center justify-center rounded-glass-sm font-semibold tracking-tight transition-[background,box-shadow,color,filter] duration-200 motion-reduce:transform-none',
        'cursor-pointer disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none disabled:saturate-50',
        isIconOnly ? ICON_SIZES[size] : SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="absolute h-[1.15em] w-[1.15em] animate-spin" aria-hidden />}
      <span className={cn('inline-flex items-center', isIconOnly ? '' : 'gap-2', loading && 'opacity-0')}>
        {leadingIcon}
        {children}
        {trailingIcon}
      </span>
    </motion.button>
  );
});
