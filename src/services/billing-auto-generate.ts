/**
 * PS-379: Client Portal no longer owns generated billing writes. PrepShip
 * Admin Billing is the single source-of-truth writer for billing_line_items;
 * this helper remains only so old worker wiring has a safe no-op target.
 */
export function startBillingAutoGenerate(): void {
  console.log('[worker] billing auto-generation parked: PrepShip Billing owns billing generation');
  return;
}

export function stopBillingAutoGenerate(): void {
  return;
}
