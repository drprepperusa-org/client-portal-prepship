const DAY_MS = 24 * 60 * 60 * 1000;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type StorageMovement = {
  qty: number | string | null;
  effectiveAt: Date | string;
};

export type StorageSku = {
  inventoryId: number;
  sku: string;
  cuFtPerUnit: number;
  movements: StorageMovement[];
};

export type StorageSkuProof = {
  inventoryId: number;
  sku: string;
  cuFtPerUnit: number;
  cuFtDays: number;
  amount: number;
  hadNegativeBalance: boolean;
};

function dayStart(value: Date | string): number {
  const date = value instanceof Date ? value : new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Integrate one immutable signed movement history across [periodStart, periodEnd). */
export function computeSkuCuFtDays(input: {
  sku: StorageSku;
  periodStart: Date | string;
  periodEnd: Date | string;
}) {
  const start = dayStart(input.periodStart);
  const end = dayStart(input.periodEnd);
  const volume = Number(input.sku.cuFtPerUnit);
  if (!(volume > 0) || end <= start) {
    return { cuFtDays: 0, hadNegativeBalance: false };
  }

  let balance = 0;
  const deltaByDay = new Map<number, number>();
  for (const movement of input.sku.movements) {
    const day = dayStart(movement.effectiveAt);
    const qty = Number(movement.qty ?? 0);
    if (!Number.isFinite(qty)) continue;
    if (day < start) balance += qty;
    else if (day < end) deltaByDay.set(day, (deltaByDay.get(day) ?? 0) + qty);
  }

  let cursor = start;
  let cuFtDays = 0;
  let hadNegativeBalance = balance < 0;
  for (const eventDay of [...deltaByDay.keys()].sort((a, b) => a - b)) {
    const days = Math.max(0, Math.round((eventDay - cursor) / DAY_MS));
    cuFtDays += Math.max(0, balance) * volume * days;
    balance += deltaByDay.get(eventDay) ?? 0;
    hadNegativeBalance ||= balance < 0;
    cursor = eventDay;
  }
  cuFtDays += Math.max(0, balance) * volume * Math.max(0, Math.round((end - cursor) / DAY_MS));
  return { cuFtDays: Math.round(cuFtDays * 1e6) / 1e6, hadNegativeBalance };
}

/** One monthly frozen amount; only the billing calculation clamps negatives to zero. */
export function computeClientStorageBilling(input: {
  skus: StorageSku[];
  monthlyRatePerCuFt: number;
  periodStart: Date | string;
  periodEnd: Date | string;
}) {
  const start = dayStart(input.periodStart);
  const end = dayStart(input.periodEnd);
  const daysInPeriod = Math.max(0, Math.round((end - start) / DAY_MS));
  const monthlyRate = Number(input.monthlyRatePerCuFt);
  const dailyRate = daysInPeriod > 0 && monthlyRate > 0 ? monthlyRate / daysInPeriod : 0;
  const proofs: StorageSkuProof[] = [];
  let totalCuFtDays = 0;
  let amount = 0;

  for (const sku of input.skus) {
    const result = computeSkuCuFtDays({ sku, periodStart: input.periodStart, periodEnd: input.periodEnd });
    if (result.cuFtDays <= 0 && !result.hadNegativeBalance) continue;
    const skuAmount = roundMoney(result.cuFtDays * dailyRate);
    totalCuFtDays += result.cuFtDays;
    amount += skuAmount;
    proofs.push({
      inventoryId: sku.inventoryId,
      sku: sku.sku,
      cuFtPerUnit: sku.cuFtPerUnit,
      cuFtDays: result.cuFtDays,
      amount: skuAmount,
      hadNegativeBalance: result.hadNegativeBalance,
    });
  }

  return {
    daysInPeriod,
    monthlyRatePerCuFt: monthlyRate,
    dailyRatePerCuFt: dailyRate,
    totalCuFtDays: Math.round(totalCuFtDays * 1e6) / 1e6,
    amount: roundMoney(amount),
    proofs,
  };
}
