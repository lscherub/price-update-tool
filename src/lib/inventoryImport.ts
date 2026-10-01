import Decimal from "decimal.js";
import { normalizeSku } from "./pricing";

/**
 * Server-side helpers for bulk inventory imports.
 *
 * The original importer issued one `UPDATE` statement per existing product
 * (~21,000 sequential round-trips for a weekly file), which timed out on
 * Vercel and left a partial import behind. This module keeps the logic pure
 * (no Prisma import) so it can be unit tested, and emits ONE
 * `INSERT ... ON CONFLICT ("sku") DO UPDATE` statement per batch that upserts
 * and reports inserted-vs-updated in a single round-trip.
 */

/** Rows per client -> server request. 1,000 rows = 12,000 bind parameters,
 *  comfortably under PostgreSQL's 65,535 parameter limit, and ~150 KB JSON. */
export const MAX_BATCH_ROWS = 1000;

/** Product.listCost / Product.price are NUMERIC(12,2). */
const MAX_AMOUNT = new Decimal("9999999999.99");
export type InventoryRow = {


sku: string;
  productNumber: string;
  description: string;
  vendor: string;
  brand: string;
  listCost: string;
  price: string;
  sizeDesc: string;
};

export type PreparedRow = InventoryRow & {
  normalizedSku: string;
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type RowFailure = { row: number; sku: string; reason: string };

export type PrepareResult = {
  rows: PreparedRow[];
  failures: RowFailure[];
  /** Rows dropped because an earlier row in the same batch had the same SKU. */
  duplicates: number;
};

type AmountResult = { ok: true; value: string } | { ok: false; reason: string };

/**
 * Coerce a spreadsheet cell to a NUMERIC(12,2) literal.
 * Blank -> "0" (matches the previous importer). A non-numeric or out-of-range
 * value fails only that row instead of aborting the whole import.
 */
export function parseAmount(value: unknown, field: string): AmountResult {
  const shown = String(value ?? "").trim();
  const raw = shown.replace(/[$,\s]/g, "");
  if (raw === "") return { ok: true, value: "0" };
  let d: Decimal;
  try {
    d = new Decimal(raw);
  } catch {
    return { ok: false, reason: `${field} "${shown}" is not a number` };
  }
  if (!d.isFinite()) return { ok: false, reason: `${field} "${shown}" is not a finite number` };
  if (d.abs().gt(MAX_AMOUNT)) return { ok: false, reason: `${field} "${shown}" exceeds the supported range` };
  return { ok: true, value: d.toFixed(2) };
}

export function chunk<T>(arr: T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
/**
 * Validate + normalize one batch of uploaded rows.
 *
 * - blank SKU               -> skipped (reported as a failure so it is visible)
 * - duplicate SKU in batch  -> collapsed, last occurrence wins
 * - bad List Cost / Price   -> failed row with a reason (no import abort)
 * - isInactive is NOT touched on update, so manual/imported inactive flags and
 *   every historical PriceUpdateItem survive a weekly re-import.
 *
 * @param raw  rows as parsed from the spreadsheet
 * @param opts.startRow 1-based sheet row number of raw[0] (2 = first data row)
 * @param opts.makeId  id factory (injected so tests stay deterministic)
 */
export function prepareBatch(
  raw: unknown[],
  opts: { startRow?: number; makeId: () => string; now?: Date },
): PrepareResult {
  const startRow = opts.startRow ?? 2;
  const stamp = (opts.now ?? new Date()).toISOString();
  const bySku = new Map<string, PreparedRow>();
  const order: string[] = [];
  const failures: RowFailure[] = [];
  let duplicates = 0;

  (raw ?? []).forEach((entry, idx) => {
    const sheetRow = startRow + idx;
    const r = (entry ?? {}) as Record<string, unknown>;
    const sku = String(r.sku ?? "").trim();
    if (!sku) {
      failures.push({ row: sheetRow, sku: "", reason: "Missing SKU" });
      return;
    }
    const cost = parseAmount(r.listCost, "List Cost");
    if (!cost.ok) { failures.push({ row: sheetRow, sku, reason: cost.reason }); return; }
    const price = parseAmount(r.price, "Price");
    if (!price.ok) { failures.push({ row: sheetRow, sku, reason: price.reason }); return; }

    const prepared: PreparedRow = {
      sku,
      normalizedSku: normalizeSku(sku) || sku.replace(/[\s-]+/g, ""),
      productNumber: String(r.productNumber ?? "").trim(),
      description: String(r.description ?? "").trim(),
      vendor: String(r.vendor ?? "").trim(),
      brand: String(r.brand ?? "").trim(),
      listCost: cost.value,
      price: price.value,
      sizeDesc: String(r.sizeDesc ?? "").trim(),
      id: opts.makeId(),
      createdAt: stamp,
      updatedAt: stamp,
    };
    if (bySku.has(sku)) duplicates++;
    else order.push(sku);
    bySku.set(sku, prepared);
  });

  return { rows: order.map((s) => bySku.get(s) as PreparedRow), failures, duplicates };
}
/**
 * Build a single upsert statement for the whole batch.
 *
 * `ON CONFLICT ("sku") DO UPDATE` keeps exactly one row per SKU (the schema
 * already has the unique index), and `RETURNING (xmax = 0)` distinguishes a
 * fresh INSERT from an UPDATE of an existing row.
 */
export function buildUpsertSql(rows: PreparedRow[]): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const tuples: string[] = [];
  for (const r of rows) {
    const i = params.length;
    params.push(
      r.sku, r.normalizedSku, r.productNumber, r.description, r.vendor, r.brand,
      r.listCost, r.price, r.sizeDesc, r.id, r.createdAt, r.updatedAt,
    );
    tuples.push(
      `($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5}, $${i + 6},` +
      ` $${i + 7}::numeric, $${i + 8}::numeric, $${i + 9}, $${i + 10},` +
      ` $${i + 11}::timestamptz, $${i + 12}::timestamptz)`,
    );
  }
  const sql =
    `INSERT INTO "Product" ("sku","normalizedSku","productNumber","description","vendor","brand",` +
    `"listCost","price","sizeDesc","id","createdAt","updatedAt") VALUES ${tuples.join(",")} ` +
    `ON CONFLICT ("sku") DO UPDATE SET ` +
    `"normalizedSku"=EXCLUDED."normalizedSku","productNumber"=EXCLUDED."productNumber",` +
    `"description"=EXCLUDED."description","vendor"=EXCLUDED."vendor","brand"=EXCLUDED."brand",` +
    `"listCost"=EXCLUDED."listCost","price"=EXCLUDED."price","sizeDesc"=EXCLUDED."sizeDesc",` +
    `"updatedAt"=EXCLUDED."updatedAt" ` +
    `RETURNING "sku", (xmax = 0) AS "inserted"`;
  return { sql, params };
}

/** Distinct SKUs from an export, for the optional "missing -> inactive" pass. */
export function normalizeSkuList(skus: unknown[]): string[] {
  const out = new Set<string>();
  for (const s of skus ?? []) {
    const v = String(s ?? "").trim();
    if (v) out.add(v);
  }
  return [...out];
}