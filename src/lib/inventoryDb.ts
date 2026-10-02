import type { PrismaClient } from "@prisma/client";
import { cuid } from "./store";
import {
  buildExactSkuFlagSql,
  buildUpsertSql,
  exactSkuList,
  normalizeSkuList,
  prepareBatch,
  REACTIVATE_ALL_SQL,
  type PreparedRow,
  type RowFailure,
} from "./inventoryImport";

/**
 * Bulk inventory import against PostgreSQL.
 *
 * Every batch is applied with ONE `INSERT ... ON CONFLICT DO UPDATE`
 * statement (single round-trip), instead of the previous
 * `findMany` + `$transaction([...50 update()])` loop that produced one
 * statement per product. If a batch statement fails, it is split in half
 * recursively so a single bad row can never discard the rest of the batch.
 */
export type BatchOutcome = {
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: RowFailure[];
};

export type DbLike = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe" | "product">;

type ReturningRow = { sku: string; inserted: boolean | number | string };

/** INSERT / UPDATE split counts straight from the RETURNING clause. */
function tallyReturning(rows: ReturningRow[]): { inserted: number; updated: number } {
  let inserted = 0;
  for (const r of rows) {
    const v = typeof r.inserted === "string" ? r.inserted === "t" || r.inserted === "true" : !!r.inserted;
    if (v) inserted++;
  }
  return { inserted, updated: rows.length - inserted };
}

/** Bisection depth cap. log2(MAX_BATCH_ROWS) is ~10, so 16 always reaches
 *  single-row granularity: a bad row is isolated, never a whole group. */
const MAX_SPLIT_DEPTH = 16;

async function applyRows(db: DbLike, rows: PreparedRow[], startRow: number, depth: number): Promise<BatchOutcome> {
  if (!rows.length) return { processed: 0, inserted: 0, updated: 0, skipped: 0, failed: [] };
  const { sql, params } = buildUpsertSql(rows);
  try {
    const returning = await db.$queryRawUnsafe<ReturningRow[]>(sql, ...params);
    const { inserted, updated } = tallyReturning(returning);
    return { processed: rows.length, inserted, updated, skipped: 0, failed: [] };
  } catch (e) {
    // A batch-level failure must not lose good rows: bisect until we isolate
    // the offending row(s).
    if (rows.length > 1 && depth < MAX_SPLIT_DEPTH) {
      const mid = Math.ceil(rows.length / 2);
      const left = await applyRows(db, rows.slice(0, mid), startRow, depth + 1);
      const right = await applyRows(db, rows.slice(mid), startRow + mid, depth + 1);
      return {
        processed: left.processed + right.processed,
        inserted: left.inserted + right.inserted,
        updated: left.updated + right.updated,
        skipped: left.skipped + right.skipped,
        failed: [...left.failed, ...right.failed],
      };
    }
    const reason = firstLine(e);
    return {
      processed: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: rows.map((r, i) => ({ row: startRow + i, sku: r.sku, reason })),
    };
  }
}

function firstLine(e: unknown): string {
  const msg = String((e as { message?: string })?.message ?? e ?? "Unknown database error").trim();
  return msg.split("\n")[0].slice(0, 300);
}

/**
 * Import one client batch of already-parsed rows.
 * @param rawRows parsed spreadsheet rows (JSON from the browser)
 * @param startRow 1-based sheet row number of rawRows[0] (2 = first data row)
 */
export async function importInventoryBatch(
  db: DbLike,
  rawRows: unknown[],
  startRow = 2,
): Promise<BatchOutcome> {
  const prepared = prepareBatch(rawRows, { startRow, makeId: () => cuid() });
  const applied = await applyRows(db, prepared.rows, startRow, 0);
  return {
    processed: applied.processed,
    inserted: applied.inserted,
    updated: applied.updated,
    // Duplicate SKUs inside one batch collapse to a single upsert, so they are
    // reported as skipped rather than silently counted twice.
    skipped: prepared.duplicates,
    failed: [...prepared.failures, ...applied.failed],
  };
}

/**
 * Mark products that are absent from the newest POS export as inactive.
 *
 * Never deletes: PriceUpdateItem rows point at Product.id, and the existing
 * Store Count / POS exports rely on the inactive flag. SKUs are excluded in
 * parameter chunks so the statement stays under PostgreSQL's parameter cap.
 */
export async function markMissingProductsInactive(
  db: DbLike,
  allSkus: string[],
  chunkSize = 5000,
): Promise<{ markedInactive: number }> {
  const keys = normalizeSkuList(allSkus);
  if (!keys.length) return { markedInactive: 0 };
  let marked = 0;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    const placeholders = chunk.map((_, j) => `$${j + 1}`).join(",");
    const res = await db.$executeRawUnsafe(
      `UPDATE "Product" SET "isInactive" = true WHERE "sku" <> ALL (ARRAY[${placeholders}]::text[])`,
      ...chunk,
    );
    marked += typeof res === "number" ? res : 0;
  }
  return { markedInactive: marked };
}

/**
 * Apply an inactive-SKU list using EXACT SKU equality — the list is the only
 * source of truth for status.
 *
 * Two statements, in order:
 *   1. clear every Active/Inactive flag, so rows absent from the list return to
 *      Active instead of keeping a stale flag from a previous import;
 *   2. flag exactly the listed SKUs.
 *
 * Step 2 matches `"sku" = ANY(...)` on the unique column. There is deliberately
 * no `normalizedSku` comparison and no leading-zero stripping: those fuzzy
 * variants are what previously made a ~16k-SKU list mark ~18k products
 * Inactive, silently flagging ~2,400 products that were still on sale.
 *
 * Never inserts: a SKU that is not in inventory yet is simply not matched, so
 * importing a list can never create duplicate products.
 */
export async function applyInactiveSkuList(
  db: DbLike,
  skus: string[],
): Promise<{ skus: number; markedInactive: number }> {
  const keys = exactSkuList(skus);
  await db.$executeRawUnsafe(REACTIVATE_ALL_SQL);
  let marked = 0;
  for (const { sql, params } of buildExactSkuFlagSql(keys, true)) {
    const res = await db.$executeRawUnsafe(sql, ...params);
    marked += typeof res === "number" ? res : 0;
  }
  return { skus: keys.length, markedInactive: marked };
}

/**
 * Delete every product, leaving all other data alone.
 *
 * `PriceUpdateItem.productId` is declared ON DELETE SET NULL, so price update
 * history, sessions, export logs, vendor discounts and users all survive; the
 * item rows simply lose their product link. Detaching the references before the
 * delete makes that guarantee explicit rather than relying on the FK's
 * referential action, and means no history row can briefly point at a product
 * that is being removed.
 */
export async function clearProducts(
  db: DbLike,
): Promise<{ deletedProducts: number; detachedItems: number }> {
  // Detach history first so no item can point at a product being removed.
  const detached = await db.$executeRawUnsafe(
    `UPDATE "PriceUpdateItem" SET "productId" = NULL WHERE "productId" IS NOT NULL`,
  );
  const { count } = await db.product.deleteMany();
  return {
    deletedProducts: typeof count === "number" ? count : 0,
    detachedItems: typeof detached === "number" ? detached : 0,
  };
}

/**
 * Set one product's Active/Inactive flag by id.
 *
 * Targeted so a manual change costs a single indexed row update and never
 * re-uploads or recalculates the rest of the inventory.
 */
export async function setProductInactive(
  db: DbLike,
  id: string,
  isInactive: boolean,
): Promise<{ id: string; sku: string; isInactive: boolean } | null> {
  const row = await db.product.update({
    where: { id },
    data: { isInactive },
    select: { id: true, sku: true, isInactive: true },
  });
  return { id: row.id, sku: row.sku, isInactive: row.isInactive };
}