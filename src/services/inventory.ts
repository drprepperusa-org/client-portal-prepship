import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { inventory } from '../db/schema/inventory';
import {
  applyInventoryMovement,
  applyInventoryMovementInTransaction,
  type InventoryMovementInput,
} from './inventory-movement';
import { inventoryQuantitySql } from './inventory-stock-math';

export type StockMovement = InventoryMovementInput;

export function applyMovement(move: StockMovement) {
  return applyInventoryMovement(move);
}

/** Apply one receive worksheet as a single canonical ledger transaction. */
export async function applyMovements(moves: StockMovement[]) {
  return db.transaction(async (tx) => {
    const results = [];
    for (const move of moves) results.push(await applyInventoryMovementInTransaction(tx, move));
    return results;
  });
}

export async function inventoryStats(clientId?: number, scopePredicate: SQL = sql`true`) {
  const where = clientId !== undefined ? sql`${inventory.clientId} = ${clientId}` : sql`true`;
  const quantity = inventoryQuantitySql(inventory.id);
  const rows = await db
    .select({ id: inventory.id, reorderLevel: inventory.reorderLevel, inventoryQuantity: quantity })
    .from(inventory)
    .where(sql`${where} and ${scopePredicate} and ${inventory.active} = true`);
  return {
    total: rows.length,
    low_stock: rows.filter((row) => row.inventoryQuantity > 0 && row.inventoryQuantity <= row.reorderLevel).length,
    out_of_stock: rows.filter((row) => row.inventoryQuantity <= 0).length,
    total_units: rows.reduce((sum, row) => sum + Number(row.inventoryQuantity), 0),
  };
}
