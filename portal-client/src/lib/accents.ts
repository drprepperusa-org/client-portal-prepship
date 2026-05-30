/** Cohesive accent palette used across icons + status chips. */
export type Accent = 'indigo' | 'teal' | 'amber' | 'rose' | 'emerald' | 'sky' | 'violet';

interface AccentTokens {
  text: string;
  bg: string;
  ring: string;
  solid: string; // hex for charts / inline svg
  grad: string; // gradient for icon tiles
}

export const ACCENTS: Record<Accent, AccentTokens> = {
  indigo: {
    // Repurposed as the brand accent → sky blue (#03A9F4) to match the rebrand.
    text: 'text-brand-600',
    bg: 'bg-brand-50',
    ring: 'ring-brand-100',
    solid: '#03A9F4',
    grad: 'from-brand-400 to-brand-600',
  },
  teal: {
    text: 'text-teal-600',
    bg: 'bg-teal-50',
    ring: 'ring-teal-200',
    solid: '#14B8A6',
    grad: 'from-teal-400 to-teal-600',
  },
  amber: {
    text: 'text-amber-600',
    bg: 'bg-amber-50',
    ring: 'ring-amber-200',
    solid: '#F59E0B',
    grad: 'from-amber-400 to-orange-500',
  },
  rose: {
    text: 'text-rose-600',
    bg: 'bg-rose-50',
    ring: 'ring-rose-200',
    solid: '#F43F5E',
    grad: 'from-rose-400 to-rose-600',
  },
  emerald: {
    text: 'text-emerald-600',
    bg: 'bg-emerald-50',
    ring: 'ring-emerald-200',
    solid: '#10B981',
    grad: 'from-emerald-400 to-emerald-600',
  },
  sky: {
    text: 'text-sky-600',
    bg: 'bg-sky-50',
    ring: 'ring-sky-200',
    solid: '#0EA5E9',
    grad: 'from-sky-400 to-sky-600',
  },
  violet: {
    text: 'text-violet-600',
    bg: 'bg-violet-50',
    ring: 'ring-violet-200',
    solid: '#8B5CF6',
    grad: 'from-violet-400 to-violet-600',
  },
};

export const CHART_COLORS = ['#03A9F4', '#14B8A6', '#F59E0B', '#F43F5E', '#10B981', '#0EA5E9', '#8B5CF6'];
