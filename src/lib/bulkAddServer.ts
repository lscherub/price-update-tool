import { DEFAULT_DIVISOR, normalizeSku, skuCandidates } from "./pricing";
import { calculateRow } from "./nearest9";
import { findProductsByRawSkus, getDiscountMaps, resolveDefaultDiscount } from "./lookup";
import type { ProductRow } from "./store";
import {
  validateBulkRow,
  type BulkAddInputRow,
  type BulkAddParsedItem,
} from "./bulkAdd";

/**
 * Server-side computation of the full preview for a list of input rows.
 * Reuses existing product lookup and worksheet calculation formulas.
 */
export async function computeBulkAddPreview(
  inputRows: BulkAddInputRow[],
  existingSkus?: string[],
): Promise<BulkAddParsedItem[]> {
  // 1. Gather all candidate SKUs to perform a single batch lookup
  const allLookupKeys: string[] = [];
  for (const r of inputRows) {
    const clean = String(r.cleanedSku ?? "").trim();
    const raw = String(r.rawVendorSku ?? "").trim();
    if (clean) allLookupKeys.push(clean);
    if (raw) allLookupKeys.push(raw);
  }

  // Single batch product lookup (single/few queries, indexed)
  const productMap = await findProductsByRawSkus(allLookupKeys);
  const discMaps = await getDiscountMaps();

  // Existing worksheet SKUs and identifiers for duplicate detection
  const existingNorm = new Set(
    (existingSkus ?? []).map((s) => {
      const trimmed = String(s ?? "").trim().replace(/[\s-]+/g, "");
      return trimmed.replace(/^0+/, "") || trimmed;
    }).filter(Boolean)
  );
  // Also keep raw normalized variants
  for (const s of existingSkus ?? []) {
    const n = normalizeSku(s);
    if (n) existingNorm.add(n.replace(/^0+/, "") || n);
  }

  const seenClean = new Set<string>();
  const seenRawNorm = new Set<string>();
  const seenProductIds = new Set<string>();

  const results: BulkAddParsedItem[] = [];

  for (let i = 0; i < inputRows.length; i++) {
    const row = inputRows[i];
    const validation = validateBulkRow(row);

    const rawIn = String(row.rawVendorSku ?? "").trim();
    const cleanIn = String(row.cleanedSku ?? "").trim();

    // Cleaned SKU key (stripped of spaces/hyphens and leading zeroes)
    const cleanKey = cleanIn ? (cleanIn.replace(/[\s-]+/g, "").replace(/^0+/, "") || cleanIn) : "";
    const rawNormKey = rawIn ? (normalizeSku(rawIn).replace(/^0+/, "") || normalizeSku(rawIn)) : "";

    let isDuplicateInWorksheet = false;
    if (cleanKey && existingNorm.has(cleanKey)) isDuplicateInWorksheet = true;
    if (rawNormKey && existingNorm.has(rawNormKey)) isDuplicateInWorksheet = true;

    let isDuplicateInBatch = false;
    if (cleanKey && seenClean.has(cleanKey)) isDuplicateInBatch = true;
    if (rawNormKey && seenRawNorm.has(rawNormKey)) isDuplicateInBatch = true;

    if (cleanKey) seenClean.add(cleanKey);
    if (rawNormKey) seenRawNorm.add(rawNormKey);

    if (!validation.isValid) {
      results.push({
        index: i,
        rawVendorSku: rawIn,
        cleanedSku: cleanIn,
        cleanedOverridden: !!cleanIn,
        productId: null,
        productNumber: "",
        productName: "",
        brand: "",
        vendor: "",
        discount: row.discount ? String(row.discount).trim() : "0.00",
        currentListPrice: null,
        vendorListPriceNew: row.vendorListPriceNew ? String(row.vendorListPriceNew).trim() : null,
        ourNewListPrice: null,
        marginDivisor: row.marginDivisor ? String(row.marginDivisor).trim() : DEFAULT_DIVISOR,
        ourNewRetailPrice: null,
        oldRetailPrice: null,
        nearest9: null,
        notes: String(row.notes ?? ""),
        matched: false,
        isInactive: false,
        isValid: false,
        validationError: validation.error,
        isDuplicateInBatch,
        isDuplicateInWorksheet,
      });
      continue;
    }

    // Lookup product: Cleaned SKU takes precedence; fallback to Raw SKU
    let prod: ProductRow | null = null;
    if (cleanIn) {
      prod = productMap.get(cleanIn) ?? null;
      if (!prod) {
        // Also check stripped leading zeroes variant
        const strippedClean = cleanIn.replace(/^0+/, "") || "0";
        prod = productMap.get(strippedClean) ?? null;
      }
    }
    if (!prod && rawIn) {
      prod = productMap.get(rawIn) ?? null;
      if (!prod) {
        for (const cand of skuCandidates(rawIn)) {
          const hit = productMap.get(cand);
          if (hit) { prod = hit; break; }
        }
      }
    }

    if (prod?.id) {
      if (seenProductIds.has(prod.id)) isDuplicateInBatch = true;
      seenProductIds.add(prod.id);
    }

    const cleanedOverridden = !!cleanIn;
    const defaultDiscount = prod ? resolveDefaultDiscount(discMaps, prod.vendor, prod.brand) : "0.00";

    const discInput = row.discount && String(row.discount).trim() !== "" ? String(row.discount).trim() : undefined;
    const priceInput = row.vendorListPriceNew && String(row.vendorListPriceNew).trim() !== ""
      ? String(row.vendorListPriceNew).trim().replace(/[$,]/g, "")
      : null;
    const divisorInput = row.marginDivisor && String(row.marginDivisor).trim() !== ""
      ? String(row.marginDivisor).trim()
      : undefined;

    const calc = calculateRow({
      rawVendorSku: rawIn,
      cleanedSku: cleanIn,
      cleanedOverridden,
      discount: discInput,
      vendorListPriceNew: priceInput,
      marginDivisor: divisorInput,
      product: prod ? {
        productNumber: prod.productNumber,
        description: prod.description,
        brand: prod.brand,
        vendor: prod.vendor,
        listCost: prod.listCost,
        price: prod.price,
        isInactive: prod.isInactive,
      } : null,
      defaultDiscount,
    });

    results.push({
      index: i,
      rawVendorSku: rawIn,
      cleanedSku: calc.cleanedSku,
      cleanedOverridden,
      productId: prod?.id ?? null,
      productNumber: calc.productNumber,
      productName: calc.productName,
      brand: calc.brand,
      vendor: calc.vendor,
      discount: calc.discount,
      currentListPrice: calc.currentListPrice,
      vendorListPriceNew: priceInput,
      ourNewListPrice: calc.ourNewListPrice,
      marginDivisor: calc.marginDivisor,
      ourNewRetailPrice: calc.ourNewRetailPrice,
      oldRetailPrice: calc.oldRetailPrice,
      nearest9: calc.nearest9,
      notes: String(row.notes ?? ""),
      matched: calc.matched,
      isInactive: calc.isInactive,
      isValid: true,
      isDuplicateInBatch,
      isDuplicateInWorksheet,
    });
  }

  return results;
}

