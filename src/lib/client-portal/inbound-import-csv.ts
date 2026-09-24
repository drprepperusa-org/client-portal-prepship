import { createHash } from 'node:crypto';
import { INBOUND_IMPORT_COLUMNS, INBOUND_IMPORT_MAX_CHARS, type InboundImportPreview, type InboundImportRow } from './contracts/inbound-import';
import type { NewInboundInput } from './contracts/inbound';

type Client = { id: number; name: string | null };
/** CSV syntax, including quoted commas, escaped quotes and multiline fields; retain physical line numbers. */
function records(text: string) {
  const rows: Array<{ line: number; cells: string[] }> = [];
  const errors: string[] = [];
  let cells: string[] = [], cell = '', quoted = false, closed = false, line = 1, start = 1;
  const finishCell = () => { cells.push(cell.trim()); cell = ''; closed = false; };
  const finishRow = () => {
    finishCell(); if (cells.some(value => value !== '')) rows.push({ line: start, cells }); cells = [];
  };
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else { cell += ch; if (ch === '\n') line++; }
    } else if (ch === ',') finishCell();
    else if (ch === '\n') { finishRow(); line++; start = line; }
    else if (ch === '"' && !cell.trim() && !closed) { cell = ''; quoted = true; }
    else if ((closed && ch.trim()) || ch === '"') { errors.push(`Row ${line}: invalid quoting.`); return { rows, errors }; }
    else if (!closed) cell += ch;
    if (rows.length > 5001) { errors.push('Use no more than 5,000 item rows.'); return { rows, errors }; }
  }
  if (quoted) errors.push(`Row ${start}: close the quoted field.`);
  else if (cell || cells.length || closed) finishRow();
  return { rows, errors };
}

/** Backend-owned preview; supplied clients have already been restricted to the caller's allowed clients. */
export function parseInboundImport(csv: string, clients: Client[]): { preview: InboundImportPreview; shipments: NewInboundInput[] } {
  const preview: InboundImportPreview = { rows: [], errors: [], shipmentCount: 0, itemCount: 0, valid: false, fingerprint: null };
  const reject = (message: string) => { preview.errors.push(message); return { preview, shipments: [] }; };
  if (csv.length > INBOUND_IMPORT_MAX_CHARS || Buffer.byteLength(csv, 'utf8') > INBOUND_IMPORT_MAX_CHARS) return reject('CSV must be 1 MiB or smaller.');
  const parsed = records(csv);
  if (parsed.errors.length) { preview.errors = parsed.errors; return { preview, shipments: [] }; }
  if (parsed.rows.length < 2) return reject('Paste a header and at least one item row.');
  if (parsed.rows.length > 5001) return reject('Use no more than 5,000 item rows.');
  const headers = parsed.rows[0]!.cells.map(value => value.toLowerCase());
  if (new Set(headers).size !== headers.length) return reject('Remove duplicate column headers.');
  const unknown = headers.filter(value => !INBOUND_IMPORT_COLUMNS.includes(value as (typeof INBOUND_IMPORT_COLUMNS)[number]));
  if (unknown.length) return reject(`Unknown columns: ${unknown.join(', ')}.`);
  if (['client', 'reference', 'qty'].some(value => !headers.includes(value)) || (!headers.includes('sku') && !headers.includes('name'))) {
    return reject('Required columns: client, reference, qty, and sku or name.');
  }
  const groups = new Map<string, { shipment: NewInboundInput; header: string; conflict: boolean; rows: InboundImportRow[] }>();
  for (const source of parsed.rows.slice(1)) {
    const values = Object.fromEntries(INBOUND_IMPORT_COLUMNS.map(key => [key, source.cells[headers.indexOf(key)] ?? ''])) as InboundImportRow['values'];
    const row: InboundImportRow = { line: source.line, values, clientName: null, errors: [] };
    preview.rows.push(row);
    if (source.cells.length !== headers.length) row.errors.push('Column count does not match the header.');
    const matches = !values.client ? [] : /^\d+$/.test(values.client) ? clients.filter(client => client.id === Number(values.client))
      : clients.filter(client => client.name?.toLowerCase() === values.client.toLowerCase());
    const client = matches.length === 1 ? matches[0] : undefined;
    if (!client) row.errors.push(matches.length > 1 ? 'Client name is ambiguous; use its ID.' : 'Choose a valid client name or ID within your access.');
    row.clientName = client?.name ?? null;
    if (!values.reference) row.errors.push('Reference / PO is required.');
    if (!values.sku && !values.name) row.errors.push('SKU or item name is required.');
    const qty = Number(values.qty);
    if (!values.qty || !/^\d+$/.test(values.qty) || !Number.isInteger(qty) || qty > 2147483647) row.errors.push('Quantity must be a whole number from 0 to 2,147,483,647.');
    const status = values.status || 'expected';
    values.status = status;
    if (!['expected', 'in_transit', 'received', 'cancelled'].includes(status)) row.errors.push('Status must be expected, in_transit, received or cancelled.');
    const date = values.expected_date;
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
      row.errors.push('Expected date must be a valid YYYY-MM-DD date.');
    }
    if (!client || !values.reference) continue;
    const header = { clientId: client.id, reference: values.reference, supplier: values.supplier || undefined, status,
      expectedDate: date || undefined, carrier: values.carrier || undefined, trackingNumber: values.tracking || undefined };
    const key = JSON.stringify([client.id, values.reference]);
    let group = groups.get(key);
    if (!group) { group = { shipment: { ...header, items: [] }, header: JSON.stringify(header), conflict: false, rows: [] }; groups.set(key, group); }
    group.rows.push(row);
    if (group.header !== JSON.stringify(header)) group.conflict = true;
    group.shipment.items!.push({ sku: values.sku || undefined, name: values.name || undefined, expectedQty: qty });
  }
  for (const group of groups.values()) for (const row of group.rows) {
    if (group.conflict) row.errors.push('Shipment details conflict for this client and reference.');
    if (group.rows.length > 200) row.errors.push('Use no more than 200 items per shipment.');
  }
  const shipments = [...groups.values()].map(group => group.shipment);
  preview.shipmentCount = shipments.length; preview.itemCount = preview.rows.length;
  if (shipments.length > 500) preview.errors.push('Use no more than 500 shipments per import.');
  preview.valid = shipments.length > 0 && !preview.errors.length && preview.rows.every(row => !row.errors.length);
  if (preview.valid) preview.fingerprint = createHash('sha256').update(JSON.stringify(shipments)).digest('hex');
  return { preview, shipments };
}
