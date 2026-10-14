/**
 * Price synchronization from a Price Update sheet into the Inventory.
 *
 * Pure helpers (no Prisma import) so they can be unit tested:
 * - Selection mirrors the existing POS CSV export exactly: every
 *   PriceUpdateItem row with a non-blank Cleaned SKU is exported, in the same
 *   order. The CSV writer (`toPosCsv` in the export route) then writes
 *   "Cleaned SKU,Our New List Price,Nearest 9" per row.
 * - Matching uses the app's reliable SKU logic: trimmed Cleaned SKU matched
 *   against inventory `sku` first, then `normalizedSku`, then leading-zero
 *   stripped variants. Ambiguous matches (multiple products) are skipped.
 * - Only `Product.price` (= Nearest 9) and `Product.listCost` (= Our New List
 *   Price) are ever written. No inserts, no other field changes.
 */
import Decimal from "decimal.js";

export type PosSyncInputRow = {
  cleanedSku: string;
  ourNewListPrice: string | null;
  nearest9: string | null;
};

export type SkuIndexEntry = { id: string; sku: string; normalizedSku: string };

export type PriceValidation =
  | { ok: true; value: string }
  | { ok: false; reason: "blank" | "invalid" };

const MAX_AMOUNT = new Decimal("9999999999.99");

/** Validate a price cell: blank/null -> blank, non-numeric or out of range -> invalid. */
export function validateSyncPrice(raw: string | null | undefined): PriceValidation {
  const s = String(raw ?? "").trim().replace(/[$,\s]/g, "");
  if (!s) return { ok: false, reason: "blank" };
  let d: Decimal;
  try {
    d = new Decimal(s);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!d.isFinite()) return { ok: false, reason: "invalid" };
  if (d.isNegative()) return { ok: false, reason: "invalid" };
  if (d.abs().gt(MAX_AMOUNT)) return { ok: false, reason: "invalid" };
  return { ok: true, value: d.toFixed(2) };
}

/** Rows the POS CSV export includes: every row with a non-blank Cleaned SKU. */
export function selectPosSyncRows<T extends PosSyncInputRow>(rows: T[]): T[] {
  return (rows ?? []).filter((r) => String(r.cleanedSku ?? "").trim() !== "");
}

/** De-duplicate by trimmed Cleaned SKU (first occurrence wins); returns dup SKUs. */
export function dedupeSyncRows<T extends PosSyncInputRow>(
  rows: T[],
): { unique: T[]; duplicateSkus: string[] } {
  const seen = new Set<string>();
  const unique: T[] = [];
  const dupSet = new Set<string>();
  for (const r of rows) {
    const key = String(r.cleanedSku ?? "").trim();
    if (seen.has(key)) {
      dupSet.add(key);
      continue;
    }
    seen.add(key);
    unique.push(r);
  }
  return { unique, duplicateSkus: [...dupSet] };
}

const stripped = (v: string): string => v.replace(/^0+/, "") || "0";

export type SkuMatch =
  | { kind: "matched"; productId: string }
  | { kind: "unmatched" }
  | { kind: "ambiguous" };

/**
 * Match one trimmed Cleaned SKU against the inventory index.
 * Order: exact `sku`, exact `normalizedSku`, stripped `sku`, stripped
 * `normalizedSku`. More than one distinct product at any tier -> ambiguous.
 */
export function matchSku(cleanedSku: string, index: SkuIndexEntry[]): SkuMatch {
  const key = String(cleanedSku ?? "").trim();
  if (!key) return { kind: "unmatched" };
  const tiers: ((p: SkuIndexEntry) => string)[] = [
    (p) => p.sku,
    (p) => p.normalizedSku,
    (p) => stripped(p.sku),
    (p) => stripped(p.normalizedSku),
  ];
  const keys = [key, key, stripped(key), stripped(key)];
  for (let t = 0; t < tiers.length; t++) {
    const want = keys[t] as string;
    const hits = index.filter((p) => (tiers[t] as (x: SkuIndexEntry) => string)(p) === want);
    const ids = [...new Set(hits.map((h) => h.id))];
    if (ids.length === 1) return { kind: "matched", productId: ids[0] as string };
    if (ids.length > 1) return { kind: "ambiguous" };
  }
  return { kind: "unmatched" };
}

/** Collect the SKU keys needed to resolve a batch (exact + stripped). */
export function collectSyncKeys(cleanedSkus: string[]): string[] {
  const out = new Set<string>();
  for (const raw of cleanedSkus) {
    const key = String(raw ?? "").trim();
    if (!key) continue;
    out.add(key);
    out.add(stripped(key));
  }
  return [...out];
}

/** Chunk keys so statements stay under PostgreSQL's 65,535 parameter cap. */
export const PRICE_SYNC_LOOKUP_CHUNK = 2000;

/** Rows per price UPDATE statement (3 binds per row: id, price, listCost). */
export const PRICE_SYNC_UPDATE_CHUNK = 1000;

export type PriceUpdate = { productId: string; price: string; listCost: string | null };

/**
 * Build chunked UPDATE statements that write ONLY price + listCost.
 * listCost uses COALESCE so a blank Our New List Price keeps the stored value
 * while the valid Nearest 9 still updates the retail price.
 */
export function buildPriceUpdateSql(
  updates: PriceUpdate[],
  chunkSize = PRICE_SYNC_UPDATE_CHUNK,
): { sql: string; params: unknown[] }[] {
  const out: { sql: string; params: unknown[] }[] = [];
  for (let i = 0; i < updates.length; i += chunkSize) {
    const part = updates.slice(i, i + chunkSize);
    const params: unknown[] = [];
    const cases: string[] = [];
    const listCases: string[] = [];
    const ids: string[] = [];
    for (const u of part) {
      const base = params.length;
      params.push(u.productId, u.price, u.listCost);
      ids.push(`$${base + 1}`);
      cases.push(`WHEN $${base + 1} THEN $${base + 2}::numeric`);
      listCases.push(`WHEN $${base + 1} THEN $${base + 3}::numeric`);
    }
    out.push({
      sql:
        `UPDATE "Product" SET "price" = CASE "id" ${cases.join(" ")} END, ` +
        `"listCost" = COALESCE(CASE "id" ${listCases.join(" ")} END, "listCost"), ` +
        `"updatedAt" = now() WHERE "id" IN (${ids.join(",")})`,
      params,
    });
  }
  return out;
}
