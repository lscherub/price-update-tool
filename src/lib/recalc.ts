import Decimal from "decimal.js";
import { calculateRow, resolveNearest9 } from "./nearest9";
import { normalizeSku, normalizeVendor, normalizeBrand } from "./pricing";
import { getDiscountMaps, resolveDefaultDiscount, type DiscountMaps } from "./lookup";
import { getPrisma } from "./db";
import { loadFileStore } from "./store";

export type CurRow = {
  rawVendorSku: string; cleanedSku: string; cleanedOverridden: boolean;
  discount: string; vendorListPriceNew: string | null; marginDivisor: string; notes: string;
  /** Stored vendor/brand of the row (used to detect product changes for discount defaults). */
  vendor?: string; brand?: string;
  /** User's manually entered Nearest 9 (null = use the automatic calculation). */
  nearest9Custom?: string | null;
};

export type LookedUpProduct = {
  id: string;
  productNumber: string;
  description: string;
  brand: string;
  vendor: string;
  listCost: string;
  price: string;
  isInactive: boolean;
};

export type RecalcBatchContext = {
  discMaps?: DiscountMaps;
  productByKey?: Map<string, LookedUpProduct | null>;
};

export async function lookupProduct(cleanedSku: string): Promise<LookedUpProduct | null> {
  const stripped = cleanedSku.replace(/^0+/, "") || "0";
  const prisma = getPrisma();
  if (!prisma) {
    const products = loadFileStore().products;
    const hit = products.find((p) => p.normalizedSku === cleanedSku || p.sku === cleanedSku)
      ?? products.find((p) => p.normalizedSku.replace(/^0+/, "") === stripped || p.sku.replace(/^0+/, "") === stripped);
    return hit ? { id: hit.id, productNumber: hit.productNumber, description: hit.description, brand: hit.brand, vendor: hit.vendor, listCost: hit.listCost, price: hit.price, isInactive: hit.isInactive } : null;
  }
  const hit = await prisma.product.findFirst({ where: { OR: [{ normalizedSku: cleanedSku }, { sku: cleanedSku }, { normalizedSku: stripped }, { sku: stripped }] } });
  return hit ? { id: hit.id, productNumber: hit.productNumber, description: hit.description, brand: hit.brand, vendor: hit.vendor, listCost: String(hit.listCost), price: String(hit.price), isInactive: hit.isInactive } : null;
}

/**
 * Batch product lookup matching the exact semantics of `lookupProduct()` across
 * many lookup keys in minimal DB queries (eliminating N+1 queries on batch PATCH).
 */
export async function lookupProductsBatch(lookupKeys: string[]): Promise<Map<string, LookedUpProduct | null>> {
  const uniqueKeys = [...new Set(lookupKeys)];
  const out = new Map<string, LookedUpProduct | null>();
  if (!uniqueKeys.length) return out;
  const strip = (s: string) => s.replace(/^0+/, "") || "0";
  const prisma = getPrisma();

  if (!prisma) {
    const products = loadFileStore().products;
    const byExact = new Map<string, LookedUpProduct>();
    const byStripped = new Map<string, LookedUpProduct>();
    for (const p of products) {
      const mapped: LookedUpProduct = {
        id: p.id, productNumber: p.productNumber, description: p.description,
        brand: p.brand, vendor: p.vendor, listCost: p.listCost, price: p.price, isInactive: p.isInactive,
      };
      if (!byExact.has(p.normalizedSku)) byExact.set(p.normalizedSku, mapped);
      if (!byExact.has(p.sku)) byExact.set(p.sku, mapped);
      const sn = strip(p.normalizedSku);
      const ss = strip(p.sku);
      if (!byStripped.has(sn)) byStripped.set(sn, mapped);
      if (!byStripped.has(ss)) byStripped.set(ss, mapped);
    }
    for (const key of uniqueKeys) {
      out.set(key, byExact.get(key) ?? byStripped.get(strip(key)) ?? null);
    }
    return out;
  }

  const allCands = new Set<string>();
  for (const k of uniqueKeys) {
    allCands.add(k);
    allCands.add(strip(k));
  }
  const candArr = [...allCands];
  const byExact = new Map<string, LookedUpProduct>();
  const byStripped = new Map<string, LookedUpProduct>();
  for (let i = 0; i < candArr.length; i += 2000) {
    const chunk = candArr.slice(i, i + 2000);
    const hits = await prisma.product.findMany({
      where: { OR: [{ normalizedSku: { in: chunk } }, { sku: { in: chunk } }] },
      take: 50000,
    });
    for (const h of hits) {
      const mapped: LookedUpProduct = {
        id: h.id, productNumber: h.productNumber, description: h.description,
        brand: h.brand, vendor: h.vendor, listCost: String(h.listCost), price: String(h.price), isInactive: h.isInactive,
      };
      if (!byExact.has(h.normalizedSku)) byExact.set(h.normalizedSku, mapped);
      if (!byExact.has(h.sku)) byExact.set(h.sku, mapped);
      const sn = strip(h.normalizedSku);
      const ss = strip(h.sku);
      if (!byStripped.has(sn)) byStripped.set(sn, mapped);
      if (!byStripped.has(ss)) byStripped.set(ss, mapped);
    }
  }
  for (const key of uniqueKeys) {
    out.set(key, byExact.get(key) ?? byStripped.get(strip(key)) ?? null);
  }
  return out;
}

/** Resolve the inventory lookup key for a row + patch (shared by recalcRow & batch prefetcher). */
export function resolveRecalcLookupKey(cur: Pick<CurRow, "rawVendorSku" | "cleanedSku" | "cleanedOverridden">, patch: Record<string, unknown>): string {
  const overridden = patch.cleanedSku !== undefined ? true : cur.cleanedOverridden;
  const rawNext = patch.rawVendorSku !== undefined ? String(patch.rawVendorSku) : cur.rawVendorSku;
  return patch.cleanedSku !== undefined
    ? String(patch.cleanedSku).trim()
    : (overridden || !rawNext.trim() ? cur.cleanedSku : normalizeSku(rawNext));
}

export async function recalcRow(cur: CurRow, patch: Record<string, unknown>, ctx?: RecalcBatchContext) {
  const discMaps = ctx?.discMaps ?? await getDiscountMaps();
  const overridden = patch.cleanedSku !== undefined ? true : cur.cleanedOverridden;
  const rawNext = patch.rawVendorSku !== undefined ? String(patch.rawVendorSku) : cur.rawVendorSku;
  const lookupKey = resolveRecalcLookupKey(cur, patch);
  const prod = ctx?.productByKey && ctx.productByKey.has(lookupKey)
    ? (ctx.productByKey.get(lookupKey) ?? null)
    : await lookupProduct(lookupKey);

  // ---- Discount: automatic default vs manual override ----
  // Clearing the cell ("") restores the automatic default (existing nearest-9
  // pattern). The product identity changed if the SKU lookup moved to a
  // different vendor/brand (or matched/unmatched flipped): then the automatic
  // default is re-applied so the row tracks the new product. Otherwise the
  // stored discount is a manual override and survives edits to other fields
  // (pricing Math unchanged — calculateRow still receives one discount value).
  const patchHasDiscount = patch.discount !== undefined;
  const clearedDiscount = patchHasDiscount && String(patch.discount ?? "").trim() === "";
  const newDefault = prod ? resolveDefaultDiscount(discMaps, prod.vendor, prod.brand) : "0.00";
  const oldDefault = resolveDefaultDiscount(
    discMaps,
    (cur as CurRow).vendor ?? "",
    (cur as CurRow).brand ?? "",
  );
  const curDiscount = String(cur.discount ?? "");
  const productIdentityChanged =
    normalizeVendor(prod?.vendor ?? "") !== normalizeVendor((cur as CurRow).vendor ?? "") ||
    normalizeBrand(prod?.brand ?? "") !== normalizeBrand((cur as CurRow).brand ?? "");
  const curLooksAutomatic =
    curDiscount.trim() === "" ||
    (() => { try {
      return new Decimal(curDiscount || "0").eq(new Decimal(oldDefault || "0"));
    } catch { return curDiscount === oldDefault; } })();
  // discountInput: explicit edit wins; cleared cell or fresh/product-changed
  // automatic value falls through to the default (undefined => use default);
  // a stored manual override is passed through untouched.
  // NOTE: callers must pass cur.vendor/cur.brand (the row's stored values) so
  // manual overrides are not mistaken for automatic values.
  const useDefault = clearedDiscount || productIdentityChanged || curLooksAutomatic;
  const discountInput = patchHasDiscount && !clearedDiscount ? String(patch.discount ?? "") : (useDefault ? undefined : curDiscount);
  const defaultDiscount = useDefault ? newDefault : curDiscount;
  const calc = calculateRow({
    rawVendorSku: rawNext,
    cleanedSku: patch.cleanedSku !== undefined ? String(patch.cleanedSku).trim() : cur.cleanedSku,
    cleanedOverridden: overridden,
    discount: discountInput,
    vendorListPriceNew: patch.vendorListPriceNew !== undefined ? (patch.vendorListPriceNew ? String(patch.vendorListPriceNew) : null) : cur.vendorListPriceNew,
    marginDivisor: patch.marginDivisor !== undefined ? String(patch.marginDivisor ?? "") : cur.marginDivisor,
    product: prod, defaultDiscount: defaultDiscount ?? curDiscount,
  });
  const newPrice = patch.vendorListPriceNew !== undefined
    ? (patch.vendorListPriceNew ? String(patch.vendorListPriceNew) : null)
    : cur.vendorListPriceNew;
  // Nearest 9: the automatic calculation stays exactly as it is; the user's
  // custom value (when present) is layered on top. Editing ANY other field
  // recalculates the automatic value but never overwrites a custom override,
  // and clearing the cell (nearest9: "") removes the override so the automatic
  // value comes back.
  const nearest9Custom = patch.nearest9 !== undefined
    ? (String(patch.nearest9 ?? "").trim() === "" ? null : String(patch.nearest9).trim())
    : (cur.nearest9Custom ?? null);
  return {
    rawVendorSku: rawNext, cleanedSku: calc.cleanedSku, cleanedOverridden: overridden,
    productId: prod?.id ?? null, productNumber: calc.productNumber, productName: calc.productName,
    brand: calc.brand, vendor: calc.vendor, discount: calc.discount,
    currentListPrice: calc.currentListPrice, vendorListPriceNew: newPrice,
    ourNewListPrice: calc.ourNewListPrice, marginDivisor: calc.marginDivisor,
    ourNewRetailPrice: calc.ourNewRetailPrice, oldRetailPrice: calc.oldRetailPrice,
    nearest9: resolveNearest9(calc.nearest9, nearest9Custom), nearest9Custom,
    notes: patch.notes !== undefined ? String(patch.notes) : cur.notes,
    isInactive: calc.isInactive, matched: calc.matched,
  };
}
