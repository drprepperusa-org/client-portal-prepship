import type { NewInboundInput, PortalClientRow } from '@/lib/api';

/** CSV → grouped inbound shipments. Columns (any order, header row required):
 *  client, reference, supplier, status, expected_date, carrier, tracking, sku, name, qty */
export function parseCsv(text: string, clients: PortalClientRow[]): { shipments: NewInboundInput[]; items: number } {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { shipments: [], items: 0 };
  // Quote-aware splitter: a field wrapped in double quotes may contain commas,
  // and "" is an escaped quote. Plain l.split(',') corrupted any such row.
  const split = (line: string): string[] => {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
          else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  };
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const at = (cells: string[], name: string) => { const i = header.indexOf(name); return i >= 0 ? (cells[i] ?? '') : ''; };
  const byName = new Map(clients.map((c) => [(c.name ?? '').toLowerCase(), c.id]));
  const groups = new Map<string, NewInboundInput & { items: NonNullable<NewInboundInput['items']> }>();
  let items = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i]);
    const clientRaw = at(cells, 'client');
    const clientId = clientRaw ? (Number(clientRaw) || byName.get(clientRaw.toLowerCase())) : undefined;
    const reference = at(cells, 'reference');
    const key = `${clientId ?? ''}|${reference}`;
    if (!groups.has(key)) {
      groups.set(key, {
        clientId: clientId || undefined,
        reference: reference || undefined,
        supplier: at(cells, 'supplier') || undefined,
        status: at(cells, 'status') || undefined,
        carrier: at(cells, 'carrier') || undefined,
        trackingNumber: at(cells, 'tracking') || undefined,
        expectedDate: at(cells, 'expected_date') || undefined,
        items: [],
      });
    }
    const g = groups.get(key)!;
    const sku = at(cells, 'sku');
    const name = at(cells, 'name');
    if (sku || name) {
      g.items.push({ sku: sku || undefined, name: name || undefined, expectedQty: Number(at(cells, 'qty')) || 0 });
      items++;
    }
  }
  return { shipments: [...groups.values()], items };
}
