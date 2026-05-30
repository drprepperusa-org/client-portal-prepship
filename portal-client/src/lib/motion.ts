import type { Variants, Transition } from 'framer-motion';

/** Liquid spring — soft, never snappy. */
export const liquidSpring: Transition = {
  type: 'spring',
  stiffness: 320,
  damping: 30,
  mass: 0.8,
};

export const easeLiquid: Transition = {
  duration: 0.32,
  ease: [0.22, 1, 0.36, 1],
};

/** Page route transition (fade + slide). */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 14, filter: 'blur(4px)' },
  enter: { opacity: 1, y: 0, filter: 'blur(0px)', transition: easeLiquid },
  exit: { opacity: 0, y: -10, filter: 'blur(4px)', transition: { duration: 0.2 } },
};

/** Staggered container + item for lists / card grids. */
export const staggerContainer: Variants = {
  initial: {},
  enter: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 16 },
  enter: { opacity: 1, y: 0, transition: easeLiquid },
};

/** Press feedback for buttons — gentle squash. */
export const pressTap = { scale: 0.97 } as const;
export const pressHover = { y: -1 } as const;
