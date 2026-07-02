// @ts-nocheck
// Extracted verbatim from api/carriers/rates.ts (C1 decomposition). The rates
// endpoint handler dispatches here; behavior is unchanged.

// Synthetic rates for the simulator provider. Three service tiers, prices
// scale with weight + a small ZIP-based jitter so re-running the same
// request returns the same rates (deterministic), but two different
// shipments produce different prices.
export function simulatorRates(input: {
  weightOz: number;
  toZip?: string;
}): Array<{ service: string; cost: number; days: number; currency: string }> {
  const lb = Math.max(0.5, input.weightOz / 16);
  // Cheap ZIP-derived jitter so different ZIPs feel different.
  const zipJitter = (() => {
    if (!input.toZip) return 0;
    let h = 0;
    for (const ch of String(input.toZip)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return ((h % 100) - 50) / 100; // -0.5..+0.49
  })();
  const round = (n: number) => Math.round(n * 100) / 100;
  return [
    { service: 'Demo Standard', cost: round(4.95 + lb * 0.85 + zipJitter * 0.4), days: 5, currency: 'USD' },
    { service: 'Demo Priority', cost: round(8.95 + lb * 1.25 + zipJitter * 0.7), days: 2, currency: 'USD' },
    { service: 'Demo Express', cost: round(24.5 + lb * 2.1 + zipJitter * 1.2), days: 1, currency: 'USD' },
  ];
}
