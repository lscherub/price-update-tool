import { calculateRow, resolveNearest9 } from "./nearest9";
import { normalizeSku, normalizeVendor } from "./pricing";
import { getDiscountMap } from "./lookup";
import { getPrisma } from "./db";
import { loadFileStore } from "./store";

export type CurRow = {
  rawVendorSku: string; cleanedSku: string; cleanedOverridden: boolean;
  discount: string; vendorListPriceNew: string | null; marginDivisor: string; notes: string;
  /** User's manually entered Nearest 9 (null = use the automatic calculation). */
  nearest9Custom?: string | null;
};

export async function lookupProduct(cleanedSku: string) {
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

export async function recalcRow(cur: CurRow, patch: Record<string, unknown>) {
  const discMap = await getDiscountMap();
  const overridden = patch.cleanedSku !== undefined ? true : cur.cleanedOverridden;
  const rawNext = patch.rawVendorSku !== undefined ? String(patch.rawVendorSku) : cur.rawVendorSku;
  const lookupKey = patch.cleanedSku !== undefined
    ? String(patch.cleanedSku).trim()
    : (overridden ? cur.cleanedSku : normalizeSku(rawNext));
  const prod = await lookupProduct(lookupKey);
  const defaultDiscount = prod ? discMap.get(normalizeVendor(prod.vendor)) ?? "0.00" : "0.00";
  const calc = calculateRow({
    rawVendorSku: rawNext,
    cleanedSku: patch.cleanedSku !== undefined ? String(patch.cleanedSku).trim() : cur.cleanedSku,
    cleanedOverridden: overridden,
    discount: patch.discount !== undefined ? String(patch.discount ?? "") : cur.discount,
    vendorListPriceNew: patch.vendorListPriceNew !== undefined ? (patch.vendorListPriceNew ? String(patch.vendorListPriceNew) : null) : cur.vendorListPriceNew,
    marginDivisor: patch.marginDivisor !== undefined ? String(patch.marginDivisor ?? "") : cur.marginDivisor,
    product: prod, defaultDiscount,
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
