import { DEFAULT_DIVISOR, normalizeSku } from "./pricing";
import { calculateRow } from "./nearest9";
import { findProductsByRawSkus, getDiscountMaps, resolveDefaultDiscount } from "./lookup";
import { getPrisma } from "./db";
import { loadFileStore, type ProductRow } from "./store";
import { lookupProduct } from "./recalc";
import {
  validateBulkRow,
  type BulkAddInputRow,
  type BulkAddParsedItem,
} from "./bulkAdd";

/**
 * Look up products for an array of Cleaned SKUs using the exact same inventory
 * SKU-matching logic as the single-row Add Row feature (lookupProduct in recalc.ts).
 *
 * Matches:
 *  1. exact `sku` or exact `normalizedSku`
 *  2. stripped leading-zero `sku` or stripped leading-zero `normalizedSku`
 *
 * NEVER slices off the last character of a Cleaned SKU or uses partial prefix matching.
 */
export async function lookupProductsForCleanedSkus(
  cleanedSkus: string[],
): Promise<Map<string, ProductRow>> {
  const out = new Map<string, ProductRow>();
  if (!cleanedSkus.length) return out;

  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    for (const raw of cleanedSkus) {
      const s = raw.trim();
      if (!s) continue;
      const stripped = s.replace(/^0+/, "") || "0";
      const hit =
        store.products.find((p) => p.sku === s || p.normalizedSku === s) ??
        store.products.find(
          (p) =>
            (p.sku.replace(/^0+/, "") || "0") === stripped ||
            (p.normalizedSku.replace(/^0+/, "") || "0") === stripped,
        );
      if (hit) out.set(s, hit);
    }
    return out;
  }

  // Collect candidate search keys: exact and stripped of leading zeroes ONLY.
  const candSet = new Set<string>();
  for (const raw of cleanedSkus) {
    const s = raw.trim();
    if (!s) continue;
    candSet.add(s);
    const stripped = s.replace(/^0+/, "") || "0";
    candSet.add(stripped);
  }

  const keys = [...candSet];
  const found: ProductRow[] = [];
  for (let i = 0; i < keys.length; i += 2000) {
    const chunk = keys.slice(i, i + 2000);
    const rows = await prisma.product.findMany({
      where: { OR: [{ sku: { in: chunk } }, { normalizedSku: { in: chunk } }] },
      take: 50000,
    });
    for (const r of rows) {
      found.push({
        id: r.id,
        sku: r.sku,
        normalizedSku: r.normalizedSku,
        productNumber: r.productNumber ?? "",
        description: r.description ?? "",
        vendor: r.vendor ?? "",
        brand: r.brand ?? "",
        listCost: String(r.listCost ?? "0.00"),
        price: String(r.price ?? "0.00"),
        sizeDesc: r.sizeDesc ?? "",
        isInactive: !!r.isInactive,
      });
    }
  }

  // Each Cleaned SKU resolves to its own product independently
  for (const raw of cleanedSkus) {
    const s = raw.trim();
    if (!s) continue;
    const stripped = s.replace(/^0+/, "") || "0";

    // 1. Exact match on sku
    let hit = found.find((p) => p.sku === s);
    // 2. Exact match on normalizedSku
    if (!hit) hit = found.find((p) => p.normalizedSku === s);
    // 3. Leading-zero-stripped match on sku
    if (!hit) hit = found.find((p) => (p.sku.replace(/^0+/, "") || "0") === stripped);
    // 4. Leading-zero-stripped match on normalizedSku
    if (!hit) hit = found.find((p) => (p.normalizedSku.replace(/^0+/, "") || "0") === stripped);

    if (hit) {
      out.set(s, hit);
    }
  }

  return out;
}

/**
 * Server-side computation of the full preview for a list of input rows.
 * Reuses existing product lookup and worksheet calculation formulas.
 */
export async function computeBulkAddPreview(
  inputRows: BulkAddInputRow[],
  existingSkus?: string[],
): Promise<BulkAddParsedItem[]> {
  // Separate Cleaned SKUs from Raw-only SKUs
  const cleanedSkus: string[] = [];
  const rawOnlySkus: string[] = [];

  for (const r of inputRows) {
    const clean = String(r.cleanedSku ?? "").trim();
    const raw = String(r.rawVendorSku ?? "").trim();
    if (clean) {
      cleanedSkus.push(clean);
    } else if (raw) {
      rawOnlySkus.push(raw);
    }
  }

  // 1. Cleaned SKU lookup using exact SKU-matching (lookupProductsForCleanedSkus)
  const cleanProductMap = await lookupProductsForCleanedSkus(cleanedSkus);

  // 2. Raw-only SKU lookup using standard raw vendor import pipeline
  const rawProductMap =
    rawOnlySkus.length > 0
      ? await findProductsByRawSkus(rawOnlySkus)
      : new Map<string, ProductRow>();

  // 3. Fetch discount lookup tables
  const discMaps = await getDiscountMaps();

  // 4. Duplicate tracking
  // Existing worksheet SKUs
  const existingCleanKeys = new Set<string>();
  const existingRawKeys = new Set<string>();
  for (const s of existingSkus ?? []) {
    if (!s) continue;
    const str = String(s).trim();
    const stripped = str.replace(/[\s-]+/g, "").replace(/^0+/, "") || str;
    existingCleanKeys.add(stripped);
    const rawNorm = normalizeSku(str);
    if (rawNorm) existingRawKeys.add(rawNorm.replace(/^0+/, "") || rawNorm);
  }

  const seenInBatch = new Set<string>();

  const results: BulkAddParsedItem[] = [];

  for (let i = 0; i < inputRows.length; i++) {
    const row = inputRows[i];
    const validation = validateBulkRow(row);

    const rawIn = String(row.rawVendorSku ?? "").trim();
    const cleanIn = String(row.cleanedSku ?? "").trim();

    // Batch duplicate detection: Only flag when its SKU genuinely duplicates another row in the current batch
    const batchKey = cleanIn
      ? `clean:${cleanIn.replace(/[\s-]+/g, "").replace(/^0+/, "") || cleanIn}`
      : `raw:${rawIn.replace(/[\s-]+/g, "").replace(/^0+/, "") || rawIn}`;

    let isDuplicateInBatch = false;
    if (cleanIn || rawIn) {
      if (seenInBatch.has(batchKey)) {
        isDuplicateInBatch = true;
      }
      seenInBatch.add(batchKey);
    }

    // Worksheet duplicate detection: Check if SKU exists in worksheet
    let isDuplicateInWorksheet = false;
    if (cleanIn) {
      const strippedClean = cleanIn.replace(/[\s-]+/g, "").replace(/^0+/, "") || cleanIn;
      if (existingCleanKeys.has(strippedClean)) isDuplicateInWorksheet = true;
    } else if (rawIn) {
      const rawNorm = normalizeSku(rawIn).replace(/^0+/, "") || rawIn;
      if (existingRawKeys.has(rawNorm) || existingCleanKeys.has(rawNorm)) isDuplicateInWorksheet = true;
    }

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

    // Lookup product for this row:
    let prod: ProductRow | null = null;
    if (cleanIn) {
      // 1. Look up independently by Cleaned SKU
      prod = cleanProductMap.get(cleanIn) ?? null;
      // Fallback to single-row lookupProduct if batch map missed
      if (!prod) {
        prod = (await lookupProduct(cleanIn)) as ProductRow | null;
      }
      // If still not found and rawVendorSku is provided, fallback to raw SKU
      if (!prod && rawIn) {
        const rawFallback = await findProductsByRawSkus([rawIn]);
        prod = rawFallback.get(rawIn) ?? null;
      }
    } else if (rawIn) {
      // Look up by Raw Vendor SKU
      prod = rawProductMap.get(rawIn) ?? null;
      if (!prod) {
        const rawFallback = await findProductsByRawSkus([rawIn]);
        prod = rawFallback.get(rawIn) ?? null;
      }
    }

    const cleanedOverridden = !!cleanIn;
    const defaultDiscount = prod ? resolveDefaultDiscount(discMaps, prod.vendor, prod.brand) : "0.00";

    const discInput =
      row.discount && String(row.discount).trim() !== "" ? String(row.discount).trim() : undefined;
    const priceInput =
      row.vendorListPriceNew && String(row.vendorListPriceNew).trim() !== ""
        ? String(row.vendorListPriceNew).trim().replace(/[$,]/g, "")
        : null;
    const divisorInput =
      row.marginDivisor && String(row.marginDivisor).trim() !== ""
        ? String(row.marginDivisor).trim()
        : undefined;

    const calc = calculateRow({
      rawVendorSku: rawIn,
      cleanedSku: cleanIn || (rawIn ? normalizeSku(rawIn) : ""),
      cleanedOverridden,
      discount: discInput,
      vendorListPriceNew: priceInput,
      marginDivisor: divisorInput,
      product: prod
        ? {
            productNumber: prod.productNumber,
            description: prod.description,
            brand: prod.brand,
            vendor: prod.vendor,
            listCost: prod.listCost,
            price: prod.price,
            isInactive: prod.isInactive,
          }
        : null,
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
