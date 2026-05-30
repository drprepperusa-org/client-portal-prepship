import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ACCENTS, type Accent } from '@/lib/accents';

interface AnimatedIconProps {
  icon: LucideIcon;
  accent?: Accent;
  active?: boolean;
  size?: number;
  /** Renders a colored gradient tile behind the icon. */
  tile?: boolean;
  className?: string;
}

/**
 * Colored, animated icon. On hover it gently wiggles/scales; the gradient
 * tile variant is used for KPI cards & connection logos.
 */
export function AnimatedIcon({
  icon: Icon,
  accent = 'indigo',
  active = false,
  size = 18,
  tile = false,
  className,
}: AnimatedIconProps) {
  const a = ACCENTS[accent];

  if (tile) {
    return (
      <motion.span
        whileHover={{ scale: 1.06, rotate: -3 }}
        transition={{ type: 'spring', stiffness: 400, damping: 18 }}
        className={cn(
          'inline-flex h-11 w-11 items-center justify-center rounded-glass-sm bg-gradient-to-br text-white shadow-glass',
          a.grad,
          className,
        )}
      >
        <Icon size={size} strokeWidth={2.1} />
      </motion.span>
    );
  }

  return (
    <motion.span
      whileHover={{ scale: 1.18, rotate: active ? 0 : -6 }}
      transition={{ type: 'spring', stiffness: 500, damping: 14 }}
      className={cn('inline-flex', active ? a.text : 'text-ink-3', className)}
      style={active ? { color: a.solid } : undefined}
    >
      <Icon size={size} strokeWidth={active ? 2.4 : 2} />
    </motion.span>
  );
}
