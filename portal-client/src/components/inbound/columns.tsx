import { Chip } from '@/components/ui/Display';
import { type Column } from '@/components/ui/DataTable';
import { type PortalInbound, type PortalInboundReceipt } from '@/lib/api';
import { type Accent } from '@/lib/accents';
import { shortDate } from '@/lib/status';
import { STATUS_META } from '@/components/inbound/shared';

const CLIENT_ACCENTS: Accent[] = ['emerald', 'rose', 'indigo', 'amber', 'teal', 'violet', 'sky'];

function clientAccent(name: string): Accent {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash + name.charCodeAt(index)) % CLIENT_ACCENTS.length;
  }
  return CLIENT_ACCENTS[hash];
}

function ClientCell({ name }: { name: string | null }) {
  if (!name) return <span className="text-ink-3">—</span>;
  return (
    <Chip accent={clientAccent(name)} dot={false}>
      {name}
    </Chip>
  );
}

export const INBOUND_COLUMNS: Column<PortalInbound>[] = [
  {
    key: 'ref',
    header: 'Reference',
    defaultWidth: 150,
    render: (row) => (
      <span className="font-semibold text-ink">{row.reference ?? `#${row.id}`}</span>
    ),
    sortAccessor: (row) => row.reference ?? `#${row.id}`,
  },
  {
    key: 'supplier',
    header: 'Supplier',
    defaultWidth: 160,
    render: (row) => <span className="text-ink-2">{row.supplier ?? '—'}</span>,
    sortAccessor: (row) => row.supplier ?? '',
  },
  {
    key: 'client',
    header: 'Client',
    defaultWidth: 150,
    render: (row) => <ClientCell name={row.clientName} />,
    sortAccessor: (row) => row.clientName ?? '',
  },
  {
    key: 'status',
    header: 'Status',
    defaultWidth: 120,
    render: (row) => {
      const metadata = STATUS_META[row.status] ?? {
        label: row.status,
        accent: 'amber' as Accent,
      };
      return <Chip accent={metadata.accent}>{metadata.label}</Chip>;
    },
    sortAccessor: (row) => row.status,
  },
  {
    key: 'units',
    header: 'Units',
    defaultWidth: 110,
    className: 'text-right',
    render: (row) => (
      <span className="tnum text-ink-2">{row.receivedUnits}/{row.expectedUnits}</span>
    ),
    sortAccessor: (row) => row.expectedUnits,
  },
  {
    key: 'expected',
    header: 'Expected',
    defaultWidth: 130,
    render: (row) => <span className="text-ink-3 tnum">{shortDate(row.expectedDate)}</span>,
    sortAccessor: (row) => row.expectedDate ?? '',
  },
  {
    key: 'carrier',
    header: 'Carrier',
    defaultWidth: 130,
    render: (row) => <span className="text-ink-2">{row.carrier ?? '—'}</span>,
    sortAccessor: (row) => row.carrier ?? '',
  },
];

export const INBOUND_RECEIPT_COLUMNS: Column<PortalInboundReceipt>[] = [
  {
    key: 'receipt',
    header: 'Receipt',
    defaultWidth: 110,
    render: (row) => <span className="font-semibold text-ink">#{row.id}</span>,
    sortAccessor: (row) => row.id,
  },
  {
    key: 'sku',
    header: 'SKU',
    defaultWidth: 150,
    render: (row) => <span className="font-mono text-xs text-ink-2">{row.sku}</span>,
    sortAccessor: (row) => row.sku,
  },
  {
    key: 'product',
    header: 'Product',
    defaultWidth: 220,
    render: (row) => <span className="text-ink-2">{row.name ?? '—'}</span>,
    sortAccessor: (row) => row.name ?? '',
  },
  {
    key: 'client',
    header: 'Client',
    defaultWidth: 150,
    render: (row) => <ClientCell name={row.clientName} />,
    sortAccessor: (row) => row.clientName ?? '',
  },
  {
    key: 'units',
    header: 'Received units',
    defaultWidth: 140,
    className: 'text-right',
    render: (row) => (
      <span className="tnum font-semibold text-ink">{row.receivedUnits.toLocaleString()}</span>
    ),
    sortAccessor: (row) => row.receivedUnits,
  },
  {
    key: 'received',
    header: 'Received',
    defaultWidth: 130,
    render: (row) => <span className="text-ink-3 tnum">{shortDate(row.receivedAt)}</span>,
    sortAccessor: (row) => row.receivedAt,
  },
  {
    key: 'note',
    header: 'Note',
    defaultWidth: 220,
    render: (row) => <span className="text-ink-3">{row.note ?? '—'}</span>,
    sortAccessor: (row) => row.note ?? '',
  },
];
