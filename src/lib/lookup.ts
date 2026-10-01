import Decimal from "decimal.js";
import { getPrisma } from "./db";
import { calculateRow } from "./nearest9";
import { normalizeVendor, skuCandidates } from "./pricing";
import { loadFileStore, type ProductRow } from "./store";

function toProductRow(p: {
  id: string; sku: string; normalizedSku: string;
  productNumber: string | null; description: string | null;
  vendor: string | null; brand: string | null;
  listCost: unknown; price: unknown; sizeDesc: string | null; isInactive: boolean;
}): ProductRow {
  const d = (v: unknown) => {
    try { return new Decimal(String(v ?? "0")).toFixed(2); } catch { return "0.00"; }
  };
  return {
    id: p.id, sku: p.sku, normalizedSku: p.normalizedSku,
    productNumber: p.productNumber ?? "", description: p.description ?? "",
    vendor: p.vendor ?? "", brand: p.brand ?? "",
    listCost: d(p.listCost), price: d(p.price),
    sizeDesc: p.sizeDesc ?? "", isInactive: !!p.isInactive,
  };
}

/** Bulk product lookup by raw vendor SKUs (single/few DB queries, indexed). */
export async function findProductsByRawSkus(rawSkus: string[]): Promise<Map<string, ProductRow>> {
  const out = new Map<string, ProductRow>();
  if (!rawSkus.length) return out;
  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    const byNorm = new Map(store.products.map((p) => [p.normalizedSku, p]));
    const bySku = new Map(store.products.map((p) => [p.sku, p]));
    const stripped = (v: string) => v.replace(/^0+/, "") || "0";
    const byStripped = new Map(store.products.map((p) => [stripped(p.normalizedSku), p]));
    const bySkuStripped = new Map(store.products.map((p) => [stripped(p.sku), p]));
    for (const raw of rawSkus) {
      for (const c of skuCandidates(raw)) {
        const hit = byNorm.get(c) ?? bySku.get(c) ?? byStripped.get(stripped(c)) ?? bySkuStripped.get(stripped(c));
        if (hit) { out.set(raw, hit); break; }
      }
    }
    return out;
  }
  const perRaw = rawSkus.map((r) => skuCandidates(r));
  const allCands = new Set<string>();
  perRaw.forEach((cs) => cs.forEach((c) => allCands.add(c)));
  // also query leading-zero-stripped variants so '0588...' matches '588...' rows
  const stripped = (v: string) => v.replace(/^0+/, "") || "0";
  const extra = [...allCands].map(stripped);
  extra.forEach((c) => allCands.add(c));
  const keys = [...allCands];
  const found: { id: string; sku: string; normalizedSku: string; productNumber: string | null; description: string | null; vendor: string | null; brand: string | null; listCost: unknown; price: unknown; sizeDesc: string | null; isInactive: boolean }[] = [];
  // Query in chunks so 20k-row imports don't exceed Postgres parameter limits.
  // Match both normalizedSku AND sku columns (stripped variants included).
  for (let i = 0; i < keys.length; i += 2000) {
    const chunk = keys.slice(i, i + 2000);
    const rows = await prisma.product.findMany({
      where: { OR: [{ normalizedSku: { in: chunk } }, { sku: { in: chunk } }] },
      take: 50000,
    });
    found.push(...(rows as unknown as typeof found));
  }
  const byNorm = new Map<string, ProductRow>();
  const bySku = new Map<string, ProductRow>();
  const byStripped = new Map<string, ProductRow>();
  for (const p of found) {
    const row = toProductRow(p as never);
    if (!byNorm.has(p.normalizedSku)) byNorm.set(p.normalizedSku, row);
    if (!bySku.has(p.sku)) bySku.set(p.sku, row);
    const sn = stripped(p.normalizedSku);
    const ss = stripped(p.sku);
    if (!byStripped.has(sn)) byStripped.set(sn, row);
    if (!byStripped.has(ss)) byStripped.set(ss, row);
  }
  rawSkus.forEach((raw, idx) => {
    for (const c of perRaw[idx]) {
      const hit = byNorm.get(c) ?? bySku.get(c) ?? byStripped.get(stripped(c));
      if (hit) { out.set(raw, hit); return; }
    }
  });
  return out;
}

export async function getDiscountMap(): Promise<Map<string, string>> {
  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    return new Map(store.vendorDiscounts.map((d) => [d.normalizedVendor, d.defaultDiscount]));
  }
  const all = await prisma.vendorDiscount.findMany({ take: 10000 });
  return new Map(all.map((d) => [d.normalizedVendor, new Decimal(d.defaultDiscount.toString()).toFixed(2)]));
}

export async function computeRowsForImport(
  raws: { raw: string; price: string | null }[],
  overrides?: Map<string, { discount?: string; margin?: string }>
): Promise<{ raw: string; price: string | null; calc: ReturnType<typeof calculateRow>; productId: string | null }[]> {
  const prodMap = await findProductsByRawSkus(raws.map((r) => r.raw));
  const discMap = await getDiscountMap();
  return raws.map(({ raw, price }) => {
    const prod = prodMap.get(raw) ?? null;
    const ov = overrides?.get(raw);
    const defaultDiscount = prod ? discMap.get(normalizeVendor(prod.vendor)) ?? "0.00" : "0.00";
    const calc = calculateRow({
      rawVendorSku: raw,
      discount: ov?.discount && ov.discount !== "" ? ov.discount : undefined,
      vendorListPriceNew: price,
      marginDivisor: ov?.margin && ov.margin !== "" ? ov.margin : undefined,
      product: prod ? {
        productNumber: prod.productNumber, description: prod.description,
        brand: prod.brand, vendor: prod.vendor, listCost: prod.listCost,
        price: prod.price, isInactive: prod.isInactive,
      } : null,
      defaultDiscount,
    });
    return { raw, price, calc, productId: prod?.id ?? null };
  });
}
