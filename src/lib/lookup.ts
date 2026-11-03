import Decimal from "decimal.js";
import { getPrisma } from "./db";
import { calculateRow } from "./nearest9";
import { skuCandidates, normalizeVendor, normalizeBrand } from "./pricing";
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

export type ItemLike = {
  productId?: string | null;
  cleanedSku?: string | null;
  rawVendorSku?: string | null;
};

/**
 * Bulk live-product resolver for exports.
 *
 * Looks up the live Product record for each worksheet item:
 * 1. Matches by item.cleanedSku against Product.sku if exact match exists.
 * 2. Matches by item.productId if present and valid.
 * 3. Falls back to normalized SKU / candidate SKUs of item.cleanedSku and item.rawVendorSku.
 *
 * This ensures Size Desc. (and live inactive status) are dynamically resolved
 * at export time from current inventory, even if productId was detached after
 * a full inventory reimport or clear.
 */
export async function resolveLiveProducts<T extends ItemLike>(
  items: T[],
  prismaClient?: ReturnType<typeof getPrisma>,
): Promise<(item: T) => ProductRow | undefined> {
  if (!items.length) return () => undefined;
  const prisma = prismaClient !== undefined ? prismaClient : getPrisma();
  const stripped = (v: string) => v.replace(/^0+/, "") || "0";

  if (!prisma) {
    const store = loadFileStore();
    const byId = new Map<string, ProductRow>();
    const bySku = new Map<string, ProductRow>();
    const byNorm = new Map<string, ProductRow>();
    const byStripped = new Map<string, ProductRow>();

    for (const p of store.products) {
      byId.set(p.id, p);
      if (!bySku.has(p.sku)) bySku.set(p.sku, p);
      if (!byNorm.has(p.normalizedSku)) byNorm.set(p.normalizedSku, p);
      const sn = stripped(p.normalizedSku);
      const ss = stripped(p.sku);
      if (!byStripped.has(sn)) byStripped.set(sn, p);
      if (!byStripped.has(ss)) byStripped.set(ss, p);
    }

    return (item: T): ProductRow | undefined => {
      if (item.cleanedSku && bySku.has(item.cleanedSku)) {
        return bySku.get(item.cleanedSku);
      }
      if (item.productId && byId.has(item.productId)) {
        return byId.get(item.productId);
      }
      if (item.cleanedSku) {
        const hit = byNorm.get(item.cleanedSku) ?? byStripped.get(stripped(item.cleanedSku));
        if (hit) return hit;
        for (const c of skuCandidates(item.cleanedSku)) {
          const h = bySku.get(c) ?? byNorm.get(c) ?? byStripped.get(stripped(c));
          if (h) return h;
        }
      }
      if (item.rawVendorSku) {
        for (const c of skuCandidates(item.rawVendorSku)) {
          const h = bySku.get(c) ?? byNorm.get(c) ?? byStripped.get(stripped(c));
          if (h) return h;
        }
      }
      return undefined;
    };
  }

  const pids = [...new Set(items.map((i) => i.productId).filter(Boolean))] as string[];
  const allCandidates = new Set<string>();

  for (const item of items) {
    if (item.cleanedSku) {
      allCandidates.add(item.cleanedSku);
      skuCandidates(item.cleanedSku).forEach((c) => allCandidates.add(c));
    }
    if (item.rawVendorSku) {
      allCandidates.add(item.rawVendorSku);
      skuCandidates(item.rawVendorSku).forEach((c) => allCandidates.add(c));
    }
  }

  const candList = [...allCandidates];
  candList.forEach((c) => allCandidates.add(stripped(c)));
  const finalCandList = [...allCandidates];

  const found: ProductRow[] = [];

  for (let i = 0; i < pids.length; i += 2000) {
    const chunk = pids.slice(i, i + 2000);
    const rows = await prisma.product.findMany({
      where: { id: { in: chunk } },
      take: 50000,
    });
    for (const r of rows) found.push(toProductRow(r as never));
  }

  for (let i = 0; i < finalCandList.length; i += 2000) {
    const chunk = finalCandList.slice(i, i + 2000);
    const rows = await prisma.product.findMany({
      where: { OR: [{ sku: { in: chunk } }, { normalizedSku: { in: chunk } }] },
      take: 50000,
    });
    for (const r of rows) found.push(toProductRow(r as never));
  }

  const byId = new Map<string, ProductRow>();
  const bySku = new Map<string, ProductRow>();
  const byNorm = new Map<string, ProductRow>();
  const byStripped = new Map<string, ProductRow>();

  for (const p of found) {
    byId.set(p.id, p);
    if (!bySku.has(p.sku)) bySku.set(p.sku, p);
    if (!byNorm.has(p.normalizedSku)) byNorm.set(p.normalizedSku, p);
    const sn = stripped(p.normalizedSku);
    const ss = stripped(p.sku);
    if (!byStripped.has(sn)) byStripped.set(sn, p);
    if (!byStripped.has(ss)) byStripped.set(ss, p);
  }

  return (item: T): ProductRow | undefined => {
    if (item.cleanedSku && bySku.has(item.cleanedSku)) {
      return bySku.get(item.cleanedSku);
    }
    if (item.productId && byId.has(item.productId)) {
      return byId.get(item.productId);
    }
    if (item.cleanedSku) {
      const hit = byNorm.get(item.cleanedSku) ?? byStripped.get(stripped(item.cleanedSku));
      if (hit) return hit;
      for (const c of skuCandidates(item.cleanedSku)) {
        const h = bySku.get(c) ?? byNorm.get(c) ?? byStripped.get(stripped(c));
        if (h) return h;
      }
    }
    if (item.rawVendorSku) {
      for (const c of skuCandidates(item.rawVendorSku)) {
        const h = bySku.get(c) ?? byNorm.get(c) ?? byStripped.get(stripped(c));
        if (h) return h;
      }
    }
    return undefined;
  };
}

// Discount lookup tables: vendor defaults keyed by normalized vendor, plus
// brand-specific overrides keyed by "normalizedVendor|normalizedBrand".
export type DiscountMaps = { vendors: Map<string, string>; brands: Map<string, string> };

export function discountKey(vendor: string | null | undefined, brand: string | null | undefined): string {
  return `${normalizeVendor(vendor)}|${normalizeBrand(brand)}`;
}

/**
 * Brand-first discount lookup shared by import + recalc:
 *  1. exact Vendor+Brand override,
 *  2. otherwise the vendor default,
 *  3. otherwise 0%.
 */
export function resolveDefaultDiscount(maps: DiscountMaps, vendor: string | null | undefined, brand: string | null | undefined): string {
  const nv = normalizeVendor(vendor);
  if (nv && normalizeBrand(brand)) {
    const hit = maps.brands.get(discountKey(vendor, brand));
    if (hit !== undefined) return hit;
  }
  return maps.vendors.get(nv) ?? "0.00";
}

export async function getDiscountMap(): Promise<Map<string, string>> {
  return (await getDiscountMaps()).vendors;
}

export async function getDiscountMaps(): Promise<DiscountMaps> {
  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    const vendors = new Map(store.vendorDiscounts.map((d) => [d.normalizedVendor, d.defaultDiscount]));
    const brands = new Map(
      (store.brandDiscounts ?? []).map((d) => [discountKey(d.vendor || d.normalizedVendor, d.brand), d.defaultDiscount]),
    );
    return { vendors, brands };
  }
  const [vendorRows, brandRows] = await Promise.all([
    prisma.vendorDiscount.findMany({ take: 10000 }),
    // BrandDiscount is new (migration 0005): tolerate databases that have not
    // migrated yet so vendor defaults keep working on older schemas.
    (async () => {
      try {
        return await (prisma as unknown as {
          brandDiscount: { findMany: (a: unknown) => Promise<{ normalizedVendor: string; normalizedBrand: string; defaultDiscount: string }[]> };
        }).brandDiscount.findMany({ take: 10000 });
      } catch {
        return [] as { normalizedVendor: string; normalizedBrand: string; defaultDiscount: string }[];
      }
    })(),
  ]);
  return {
    vendors: new Map(vendorRows.map((d) => [d.normalizedVendor, new Decimal(d.defaultDiscount.toString()).toFixed(2)])),
    brands: new Map(
      brandRows.map((d) => [
        `${String(d.normalizedVendor ?? "")}|${String(d.normalizedBrand ?? "")}`,
        new Decimal(d.defaultDiscount.toString()).toFixed(2),
      ]),
    ),
  };
}

export async function computeRowsForImport(
  raws: { raw: string; price: string | null }[],
  overrides?: Map<string, { discount?: string; margin?: string }>
): Promise<{ raw: string; price: string | null; calc: ReturnType<typeof calculateRow>; productId: string | null }[]> {
  const prodMap = await findProductsByRawSkus(raws.map((r) => r.raw));
  const discMaps = await getDiscountMaps();
  return raws.map(({ raw, price }) => {
    const prod = prodMap.get(raw) ?? null;
    const ov = overrides?.get(raw);
    const defaultDiscount = prod ? resolveDefaultDiscount(discMaps, prod.vendor, prod.brand) : "0.00";
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
