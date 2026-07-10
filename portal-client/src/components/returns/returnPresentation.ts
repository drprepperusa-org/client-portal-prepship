import type { Accent } from '@/lib/accents';

const CLIENT_ACCENTS: Accent[] = [
  'emerald',
  'rose',
  'indigo',
  'amber',
  'teal',
  'violet',
  'sky',
];

export function clientAccent(name: string | null): Accent {
  const value = name ?? '';
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash + value.charCodeAt(index)) % CLIENT_ACCENTS.length;
  }
  return CLIENT_ACCENTS[hash];
}

// Backend owns the CP-026 lifecycle enum. The client only maps presentation.
const STATUS_META: Record<string, { label: string; accent: Accent }> = {
  requested: { label: 'Requested', accent: 'amber' },
  label_created: { label: 'Label created', accent: 'sky' },
  label_failed: { label: 'Label needs attention', accent: 'rose' },
  in_transit: { label: 'In transit', accent: 'indigo' },
  received: { label: 'Received', accent: 'teal' },
  inspected: { label: 'Inspected', accent: 'violet' },
  closed: { label: 'Closed', accent: 'emerald' },
  cancelled: { label: 'Cancelled', accent: 'rose' },
};

export function returnStatusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, accent: 'amber' as Accent };
}

export const RETURN_STATUS_OPTIONS = [
  'requested',
  'label_created',
  'label_failed',
  'in_transit',
  'received',
  'inspected',
  'closed',
  'cancelled',
] as const;

export const RETURN_DELIVERY_LABEL: Record<string, string> = {
  manual_pdf: 'PDF download',
  shopify_native: 'Store delivery',
};
