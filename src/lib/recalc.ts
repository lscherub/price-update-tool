import Decimal from "decimal.js";
import { calculateRow, resolveNearest9 } from "./nearest9";
import { normalizeSku, normalizeVendor, normalizeBrand } from "./pricing";
import { getDiscountMaps, resolveDefaultDiscount } from "./lookup";
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
  const discMaps = await getDiscountMaps();
  const overridden = patch.cleanedSku !== undefined ? true : cur.cleanedOverridden;
  const rawNext = patch.rawVendorSku !== undefined ? String(patch.rawVendorSku) : cur.rawVendorSku;
  const lookupKey = patch.cleanedSku !== undefined
    ? String(patch.cleanedSku).trim()
    : (overridden ? cur.cleanedSku : normalizeSku(rawNext));
  const prod = await lookupProduct(lookupKey);

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
