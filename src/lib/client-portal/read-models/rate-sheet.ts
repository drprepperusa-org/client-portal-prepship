import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '../../../db/client';
import { billingConfig, clientPackagePrices } from '../../../db/schema/billing';
import { clients } from '../../../db/schema/clients';
import { packages } from '../../../db/schema/packages';
import type { PortalRateSheet } from '../contracts/rate-sheet';
import { clientFilterPredicate } from '../predicates';
import type { ClientPortalScope } from '../scope';

/** Read the same saved configuration as PrepShip Billing. No pricing formula,
 * defaults, warehouse costs, markups or shipping/provider identities cross this DTO. */
export async function listPortalRateSheets(scope: ClientPortalScope, clientId?: number): Promise<PortalRateSheet[]> {
  if (!scope.canViewFinancials) throw new Error('financials:read required');
  const rows = await db.select({
    clientId: clients.id,
    clientName: clients.name,
    configuredClientId: billingConfig.clientId,
    active: billingConfig.active,
    pickPackFee: billingConfig.pickPackFee,
    includedUnits: billingConfig.pickPackMaxUnits,
    additionalUnitFee: billingConfig.additionalUnitFee,
    storageFeePerCuFt: billingConfig.storageFeePerCuFt,
    updatedAt: billingConfig.updatedAt,
  }).from(clients)
    .leftJoin(billingConfig, eq(billingConfig.clientId, clients.id))
    .where(and(eq(clients.active, true), clientFilterPredicate(scope, clientId),
      notInArray(clients.name, ['Manual Orders', 'Rate Browser', 'Api Shipments'])))
    .orderBy(asc(clients.name), asc(clients.id));
  if (!rows.length) return [];

  // The client IDs come only from the scoped selector above. Prices are the
  // explicit client configuration; catalog unit_cost is intentionally not read.
  const prices = await db.select({
    clientId: clientPackagePrices.clientId,
    packageId: clientPackagePrices.packageId,
    name: packages.name,
    length: packages.length,
    width: packages.width,
    height: packages.height,
    configuredPrice: clientPackagePrices.price,
    updatedAt: clientPackagePrices.updatedAt,
  }).from(clientPackagePrices)
    .innerJoin(packages, eq(packages.id, clientPackagePrices.packageId))
    .where(and(inArray(clientPackagePrices.clientId, rows.map((row) => row.clientId)), eq(packages.source, 'custom')))
    .orderBy(asc(packages.name), asc(packages.id));
  const byClient = new Map<number, PortalRateSheet['packages']>();
  for (const price of prices) {
    const entries = byClient.get(price.clientId) ?? [];
    entries.push({
      packageId: price.packageId,
      name: price.name,
      dimensions: price.length > 0 && price.width > 0 && price.height > 0
        ? `${price.length} × ${price.width} × ${price.height} in` : null,
      configuredPrice: price.configuredPrice,
      updatedAt: price.updatedAt.toISOString(),
    });
    byClient.set(price.clientId, entries);
  }
  return rows.map((row): PortalRateSheet => ({
    clientId: row.clientId,
    clientName: row.clientName,
    configurationStatus: row.configuredClientId == null ? 'not_configured' : row.active ? 'configured' : 'inactive',
    services: row.configuredClientId == null ? null : {
      pickPackFee: row.pickPackFee!,
      includedUnits: row.includedUnits!,
      additionalUnitFee: row.additionalUnitFee!,
      storageFeePerCuFt: row.storageFeePerCuFt!,
      updatedAt: row.updatedAt!.toISOString(),
    },
    packages: byClient.get(row.clientId) ?? [],
  }));
}
