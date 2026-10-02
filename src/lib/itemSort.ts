/**
 * Shared sorting for the Price Update Items table and the Store Count PDF.
 *
 * Pure helpers only — no pricing, matching, or flags logic lives here. Both
 * the client table and the PDF route use the same comparator so the PDF
 * preserves the table's order exactly.
 */
export type SortDir = "asc" | "desc";

export const SORTABLE_ITEM_KEYS = [
  "rawVendorSku", "cleanedSku", "productNumber", "productName", "brand",
  "vendor", "discount", "currentListPrice", "vendorListPriceNew",
  "ourNewListPrice", "marginDivisor", "ourNewRetailPrice", "oldRetailPrice",
  "nearest9", "notes", "flags",
] as const;

export type SortableItemKey = (typeof SORTABLE_ITEM_KEYS)[number];

const NUMBER_KEYS = new Set<string>([
  "discount", "currentListPrice", "vendorListPriceNew", "ourNewListPrice",
  "marginDivisor", "ourNewRetailPrice", "oldRetailPrice", "nearest9",
]);

export type ItemLike = {
  matched?: unknown; isInactive?: unknown; cleanedOverridden?: unknown;
  nearest9?: unknown; oldRetailPrice?: unknown;
  [k: string]: unknown;
};

/** Text shown in the Flags column, mirrored for sorting by flags. */
export function flagsText(r: ItemLike): string {
  const parts: string[] = [];
  if (!r.matched) parts.push("Not Found");
  if (r.isInactive) parts.push("Inactive");
  if (r.cleanedOverridden) parts.push("Manual SKU");
  const n9 = r.nearest9 === null || r.nearest9 === undefined ? "" : String(r.nearest9);
  const old = r.oldRetailPrice === null || r.oldRetailPrice === undefined ? "" : String(r.oldRetailPrice);
  if (r.matched && n9 && old) parts.push(n9 !== old ? "Changed" : "No change");
  return parts.join(", ");
}

function numVal(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/[$,%\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Validate an untrusted sort descriptor (e.g. from the PDF request body). */
export function parseSortParam(key: unknown, dir: unknown): { key: SortableItemKey; dir: SortDir } | null {
  if ((dir !== "asc" && dir !== "desc") || typeof key !== "string") return null;
  if (!(SORTABLE_ITEM_KEYS as readonly string[]).includes(key)) return null;
  return { key: key as SortableItemKey, dir };
}

export function compareItemValues(a: ItemLike, b: ItemLike, key: SortableItemKey, dir: SortDir): number {
  const m = dir === "desc" ? -1 : 1;
  if (key === "flags") {
    const x = flagsText(a);
    const y = flagsText(b);
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return x.localeCompare(y, undefined, { sensitivity: "base", numeric: true }) * m;
  }
  if (NUMBER_KEYS.has(key)) {
    const x = numVal(a[key]);
    const y = numVal(b[key]);
    if (x === null && y === null) return 0;
    if (x === null) return 1; // blanks last in both directions (Excel-like)
    if (y === null) return -1;
    if (x === y) return 0;
    return (x < y ? -1 : 1) * m;
  }
  const x = a[key] === null || a[key] === undefined ? "" : String(a[key]);
  const y = b[key] === null || b[key] === undefined ? "" : String(b[key]);
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return x.localeCompare(y, undefined, { sensitivity: "base", numeric: true }) * m;
}

/** Stable sort of a full row array. Returns the input untouched when unsorted/invalid. */
export function sortItems<T extends ItemLike>(rows: T[], key: string | null, dir: SortDir | null): T[] {
  if (!key || !dir) return rows;
  const p = parseSortParam(key, dir);
  if (!p) return rows;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => compareItemValues(x.r, y.r, p.key, p.dir) || x.i - y.i)
    .map((x) => x.r);
}
