import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/cn';
import { staggerItem } from '@/lib/motion';

interface GlassPanelProps extends HTMLMotionProps<'div'> {
  /** Adds a soft hover lift. */
  hover?: boolean;
  strong?: boolean;
  /** Use as a stagger item inside a stagger container. */
  asItem?: boolean;
  children?: ReactNode;
}

export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(function GlassPanel(
  { hover = false, strong = false, asItem = false, className, children, ...rest },
  ref,
) {
  return (
    <motion.div
      ref={ref}
      variants={asItem ? staggerItem : undefined}
      whileHover={hover ? { y: -3, boxShadow: '0 12px 36px rgba(15,23,42,0.12), 0 4px 12px rgba(15,23,42,0.06)' } : undefined}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      className={cn(
        strong ? 'glass-strong' : 'glass',
        'rounded-glass',
        hover && 'cursor-pointer',
        className,
      )}
      {...rest}
    >
      {children}
    </motion.div>
  );
});

/** Section heading used on every page. */
export function SectionTitle({
  title,
  subtitle,
  right,
  className,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Divider(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('h-px w-full bg-slate-200/70', props.className)} />;
}
