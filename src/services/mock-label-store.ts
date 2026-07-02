import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import type { MockLabelData } from './mock-label-generator';

// ── Mock label store (DB-backed, with in-memory fast path) ────────────────────
// v2-parity: mock labels persist to the `mock_labels` table so dev labels
// survive server restarts. Keep a Map as a read-through cache so /mock/:id
// doesn't hit the DB on every render in dev.

const mockLabelStore = new Map<number, MockLabelData>();

export function getMockLabel(shipmentId: number): MockLabelData | null {
  return mockLabelStore.get(shipmentId) ?? null;
}

export async function getMockLabelAsync(shipmentId: number): Promise<MockLabelData | null> {
  const cached = mockLabelStore.get(shipmentId);
  if (cached) return cached;
  try {
    const { mockLabels } = await import('../db/schema/mock-labels');
    const [row] = await db
      .select()
      .from(mockLabels)
      .where(eq(mockLabels.shipmentId, shipmentId))
      .limit(1);
    if (!row) return null;
    const parse = <T>(v: string | null, fallback: T): T => {
      if (v == null) return fallback;
      try { return JSON.parse(v) as T; } catch { return fallback; }
    };
    const empty = { name: '', street1: '', city: '', state: '', postalCode: '' };
    const hydrated: MockLabelData = {
      shipmentId: row.shipmentId,
      orderNumber: row.orderNumber,
      trackingNumber: row.trackingNumber,
      serviceLabel: row.serviceLabel ?? '',
      weightOz: row.weightOz ? Number(row.weightOz) : 0,
      shipFrom: parse(row.shipFrom, empty),
      shipTo: parse(row.shipTo, empty),
      shipDate: row.shipDate ?? '',
      pdfBase64: row.pdfBase64 ?? undefined,
    };
    mockLabelStore.set(shipmentId, hydrated);
    return hydrated;
  } catch (err) {
    console.warn('[labels] getMockLabelAsync DB fetch failed:', err);
    return null;
  }
}

export function saveMockLabel(shipmentId: number, data: MockLabelData): void {
  mockLabelStore.set(shipmentId, data);
  // Fire-and-forget: persist to DB for restart-survival. The in-memory map
  // is authoritative for the current process; DB is the durable mirror.
  void (async () => {
    try {
      const { mockLabels } = await import('../db/schema/mock-labels');
      await db
        .insert(mockLabels)
        .values({
          shipmentId,
          orderNumber: data.orderNumber,
          trackingNumber: data.trackingNumber,
          serviceLabel: data.serviceLabel,
          weightOz: String(data.weightOz),
          shipFrom: JSON.stringify(data.shipFrom),
          shipTo: JSON.stringify(data.shipTo),
          shipDate: data.shipDate,
          pdfBase64: data.pdfBase64 ?? null,
        })
        .onConflictDoUpdate({
          target: mockLabels.shipmentId,
          set: {
            orderNumber: data.orderNumber,
            trackingNumber: data.trackingNumber,
            serviceLabel: data.serviceLabel,
            weightOz: String(data.weightOz),
            shipFrom: JSON.stringify(data.shipFrom),
            shipTo: JSON.stringify(data.shipTo),
            shipDate: data.shipDate,
            pdfBase64: data.pdfBase64 ?? null,
          },
        });
    } catch (err) {
      console.warn('[labels] saveMockLabel DB persist failed:', err);
    }
  })();
}
