export const INBOUND_IMPORT_MAX_CHARS = 1048576;
export const INBOUND_IMPORT_COLUMNS = ['client', 'reference', 'supplier', 'status', 'expected_date', 'carrier', 'tracking', 'sku', 'name', 'qty'] as const;
export interface InboundImportRow {
  line: number;
  values: Record<(typeof INBOUND_IMPORT_COLUMNS)[number], string>;
  clientName: string | null;
  errors: string[];
}
export interface InboundImportPreview {
  rows: InboundImportRow[];
  errors: string[];
  shipmentCount: number;
  itemCount: number;
  valid: boolean;
  fingerprint: string | null;
}
export interface InboundImportInput { csv: string; fingerprint: string; idempotencyKey: string }
export interface InboundImportResult { created: number; itemsCreated: number; skipped: number; replayed: boolean }
