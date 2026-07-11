/**
 * Stable customer-facing reference for a return workflow.
 *
 * The persisted returns.returnReference remains authoritative when present.
 * The derived fallback keeps legacy rows created before that column was added
 * identifiable as ORDER-RETURN instead of leaking an internal row id.
 */
export function baseReturnReference(orderNumber: string | null, orderId: number): string {
  const base = (orderNumber?.trim() || String(orderId)).replace(/\s+/g, '-');
  return `${base}-RETURN`;
}

export function resolveReturnReference(
  persistedReference: string | null | undefined,
  orderNumber: string | null,
  orderId: number,
): string {
  return persistedReference?.trim() || baseReturnReference(orderNumber, orderId);
}
