/**
 * Shared WHERE/orderBy builder for the Inventory table.
 * Pure helper (no Prisma import) so it can be unit tested.
 */
export type InventoryQuery = {
  q: string; sku: string; productNumber: string; description: string;
  vendor: string; brand: string; vendorExact: string; brandExact: string;
  inactive: string; sort: string; sortDir: string;
};
export function parseInventoryQuery(sp: URLSearchParams): InventoryQuery {
  return {
    q: (sp.get("q") ?? "").trim(),
    sku: (sp.get("sku") ?? "").trim(),
    productNumber: (sp.get("productNumber") ?? "").trim(),
    description: (sp.get("description") ?? "").trim(),
    vendor: (sp.get("vendorFilter") ?? "").trim() || (sp.get("vendorContains") ?? "").trim(),
    brand: (sp.get("brandFilter") ?? "").trim() || (sp.get("brandContains") ?? "").trim(),
    vendorExact: (sp.get("vendorExact") ?? "").trim() || (sp.get("vendor") ?? "").trim(),
    brandExact: (sp.get("brandExact") ?? "").trim(),
    inactive: (sp.get("inactive") ?? "").trim(),
    sort: (sp.get("sort") ?? "").trim(),
    sortDir: (sp.get("sortDir") ?? "").trim(),
  };
}
const SORTABLE = new Set(["sku","productNumber","description","vendor","brand","listCost","price","sizeDesc","status"]);
export function parseInventorySort(sort: unknown, dir: unknown): { key: string; dir: "asc" | "desc" } | null {
  if (typeof sort !== "string" || !SORTABLE.has(sort)) return null;
  if (dir !== "asc" && dir !== "desc") return null;
  return { key: sort, dir };
}
type PrismaWhere = Record<string, unknown>;
/** Prisma where: global search ANDed with every active column filter. */
export function buildInventoryWhere(q: InventoryQuery): PrismaWhere {
  const where: PrismaWhere = {};
  const and: PrismaWhere[] = [];
  if (q.vendorExact) where.vendor = q.vendorExact;
  if (q.brandExact) where.brand = q.brandExact;
  if (q.inactive === "true") where.isInactive = true;
  else if (q.inactive === "false") where.isInactive = false;
  if (q.q) {
    and.push({ OR: [
      { sku: { contains: q.q, mode: "insensitive" } },
      { normalizedSku: { contains: q.q, mode: "insensitive" } },
      { productNumber: { contains: q.q, mode: "insensitive" } },
      { description: { contains: q.q, mode: "insensitive" } },
      { brand: { contains: q.q, mode: "insensitive" } },
      { vendor: { contains: q.q, mode: "insensitive" } },
    ]});
  }
  if (q.sku) and.push({ sku: { contains: q.sku, mode: "insensitive" } });
  if (q.productNumber) and.push({ productNumber: { contains: q.productNumber, mode: "insensitive" } });
  if (q.description) and.push({ description: { contains: q.description, mode: "insensitive" } });
  if (q.vendor) and.push({ vendor: { contains: q.vendor, mode: "insensitive" } });
  if (q.brand) and.push({ brand: { contains: q.brand, mode: "insensitive" } });
  if (and.length) where.AND = and;
  return where;
}
export type FileProductLike = {
  sku: string; normalizedSku: string; productNumber: string; description: string;
  vendor: string; brand: string; isInactive: boolean; listCost: string; price: string; sizeDesc: string;
};
/** Same predicate as buildInventoryWhere, for the dev JSON file-store. */
export function matchesInventoryFilters(p: FileProductLike, q: InventoryQuery): boolean {
  if (q.vendorExact && p.vendor !== q.vendorExact) return false;
  if (q.brandExact && p.brand !== q.brandExact) return false;
  if (q.inactive === "true" && !p.isInactive) return false;
  if (q.inactive === "false" && p.isInactive) return false;
  if (q.q) {
    const needle = q.q.toLowerCase();
    const hay = [p.sku, p.normalizedSku, p.productNumber, p.description, p.brand, p.vendor].join(" ").toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (q.sku && !p.sku.toLowerCase().includes(q.sku.toLowerCase())) return false;
  if (q.productNumber && !p.productNumber.toLowerCase().includes(q.productNumber.toLowerCase())) return false;
  if (q.description && !p.description.toLowerCase().includes(q.description.toLowerCase())) return false;
  if (q.vendor && !p.vendor.toLowerCase().includes(q.vendor.toLowerCase())) return false;
  if (q.brand && !p.brand.toLowerCase().includes(q.brand.toLowerCase())) return false;
  return true;
}
function numVal(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function strVal(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}
/** Comparator matching buildInventoryOrderBy, for file-store + tests. */
export function compareInventoryRows(a: FileProductLike, b: FileProductLike, sort: string, dir: string): number {
  const p = parseInventorySort(sort, dir);
  if (!p) return a.sku.localeCompare(b.sku);
  const m = p.dir === "desc" ? -1 : 1;
  if (p.key === "status") {
    const x = a.isInactive ? 1 : 0;
    const y = b.isInactive ? 1 : 0;
    return (x - y) * m;
  }
  if (p.key === "listCost" || p.key === "price") {
    const x = numVal(a[p.key]);
    const y = numVal(b[p.key]);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    if (x === y) return 0;
    return (x < y ? -1 : 1) * m;
  }
  const x = strVal(a[p.key as keyof FileProductLike]);
  const y = strVal(b[p.key as keyof FileProductLike]);
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return x.localeCompare(y, undefined, { sensitivity: "base", numeric: true }) * m;
}
/** Stable sort. Returns rows untouched when unsorted/invalid. */
export function sortInventoryRows<T extends FileProductLike>(rows: T[], sort: string, dir: string): T[] {
  if (!parseInventorySort(sort, dir)) return rows;
  return rows.map((r, i) => ({ r, i }))
    .sort((x, y) => compareInventoryRows(x.r, y.r, sort, dir) || x.i - y.i)
    .map((x) => x.r);
}
/** Prisma orderBy for the column dropdowns. */
export function buildInventoryOrderBy(sort: string, dir: string): Record<string, "asc" | "desc"> {
  const p = parseInventorySort(sort, dir);
  if (!p) return { sku: "asc" };
  if (p.key === "status") return { isInactive: p.dir };
  return { [p.key]: p.dir } as Record<string, "asc" | "desc">;
}
