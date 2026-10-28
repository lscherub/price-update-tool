import Decimal from "decimal.js";
import { normalizeSku, skuCandidates, DEFAULT_DIVISOR } from "./pricing";
import { validateBulkRow, type BulkAddInputRow, type BulkAddParsedItem } from "./bulkAdd";
import { findProductsByRawSkus, getDiscountMaps, resolveDefaultDiscount } from "./lookup";
import { lookupProductsForCleanedSkus } from "./bulkAddServer";
import { recalcRow, type CurRow, lookupProduct } from "./recalc";
import { getPrisma } from "./db";
import { loadFileStore, saveFileStore, cuid, type ItemRow, type ProductRow } from "./store";

export type WorksheetItemLite = {
  id: string;
  sessionId: string;
  rawVendorSku: string;
  cleanedSku: string;
  cleanedOverridden: boolean;
  productId: string | null;
  productNumber: string;
  productName: string;
  brand: string;
  vendor: string;
  discount: string | null;
  currentListPrice: string | null;
  vendorListPriceNew: string | null;
  ourNewListPrice: string | null;
  marginDivisor: string | null;
  ourNewRetailPrice: string | null;
  oldRetailPrice: string | null;
  nearest9: string | null;
  nearest9Custom?: string | null;
  notes: string;
  isInactive: boolean;
  matched: boolean;
};

const stripped = (v: string) => v.replace(/[\s-]+/g, "").replace(/^0+/, "") || "0";
const spaceless = (v: string) => v.replace(/[\s-]+/g, "");

type ItemIndex = {
  byClean: Map<string, WorksheetItemLite[]>;
  byRaw: Map<string, WorksheetItemLite[]>;
  byProductSku: Map<string, WorksheetItemLite[]>;
};

export function buildWorksheetItemIndex(
  items: WorksheetItemLite[],
  productsById?: Map<string, { sku: string; normalizedSku: string }>,
): ItemIndex {
  const index: ItemIndex = {
    byClean: new Map(),
    byRaw: new Map(),
    byProductSku: new Map(),
  };

  const push = (map: Map<string, WorksheetItemLite[]>, key: string, item: WorksheetItemLite) => {
    if (!key) return;
    const list = map.get(key) ?? [];
    if (!list.some((x) => x.id === item.id)) list.push(item);
    map.set(key, list);
  };

  for (const item of items) {
    if (item.cleanedSku) {
      const c = item.cleanedSku.trim();
      push(index.byClean, c, item);
      push(index.byClean, spaceless(c), item);
      push(index.byClean, stripped(c), item);
    }
    if (item.rawVendorSku) {
      const r = item.rawVendorSku.trim();
      push(index.byRaw, r, item);
      push(index.byRaw, spaceless(r), item);
      push(index.byRaw, stripped(r), item);
      const norm = normalizeSku(r);
      if (norm) {
        push(index.byRaw, norm, item);
        push(index.byRaw, stripped(norm), item);
      }
    }
    if (item.productId && productsById) {
      const p = productsById.get(item.productId);
      if (p) {
        if (p.sku) {
          push(index.byProductSku, p.sku, item);
          push(index.byProductSku, spaceless(p.sku), item);
          push(index.byProductSku, stripped(p.sku), item);
        }
        if (p.normalizedSku) {
          push(index.byProductSku, p.normalizedSku, item);
          push(index.byProductSku, stripped(p.normalizedSku), item);
        }
      }
    }
  }

  return index;
}

/**
 * Match a single input row against the worksheet items.
 * Cleaned SKU (explicit) is checked first, then raw vendor SKU candidates.
 */
export function matchWorksheetItem(
  row: BulkAddInputRow,
  index: ItemIndex,
): { match: WorksheetItemLite | null; ambiguous: boolean } {
  const cleanIn = String(row.cleanedSku ?? "").trim();
  const rawIn = String(row.rawVendorSku ?? "").trim();

  // 1. If Cleaned SKU is supplied:
  if (cleanIn) {
    const sl = spaceless(cleanIn);
    const st = stripped(cleanIn);
    const hits = [
      ...(index.byClean.get(cleanIn) ?? []),
      ...(index.byClean.get(sl) ?? []),
      ...(index.byProductSku.get(cleanIn) ?? []),
      ...(index.byProductSku.get(sl) ?? []),
      ...(index.byClean.get(st) ?? []),
      ...(index.byProductSku.get(st) ?? []),
      ...(index.byRaw.get(cleanIn) ?? []),
      ...(index.byRaw.get(sl) ?? []),
    ];

    const seen = new Set<string>();
    const deduped: WorksheetItemLite[] = [];
    for (const h of hits) {
      if (!seen.has(h.id)) {
        seen.add(h.id);
        deduped.push(h);
      }
    }

    if (deduped.length === 1) return { match: deduped[0], ambiguous: false };
    if (deduped.length > 1) {
      // If one is an exact verbatim match on cleanedSku or product SKU, prefer it
      const exact = deduped.filter((d) => d.cleanedSku === cleanIn || spaceless(d.cleanedSku) === sl);
      if (exact.length === 1) return { match: exact[0], ambiguous: false };
      return { match: null, ambiguous: true };
    }
  }

  // 2. If Raw Vendor SKU is supplied:
  if (rawIn) {
    const candidates = skuCandidates(rawIn);
    for (const c of candidates) {
      const hits = [
        ...(index.byClean.get(c) ?? []),
        ...(index.byRaw.get(c) ?? []),
        ...(index.byProductSku.get(c) ?? []),
        ...(index.byClean.get(stripped(c)) ?? []),
        ...(index.byRaw.get(stripped(c)) ?? []),
        ...(index.byProductSku.get(stripped(c)) ?? []),
      ];

      const seen = new Set<string>();
      const deduped: WorksheetItemLite[] = [];
      for (const h of hits) {
        if (!seen.has(h.id)) {
          seen.add(h.id);
          deduped.push(h);
        }
      }

      if (deduped.length === 1) return { match: deduped[0], ambiguous: false };
      if (deduped.length > 1) {
        const exact = deduped.filter((d) => d.rawVendorSku === rawIn || d.cleanedSku === c);
        if (exact.length === 1) return { match: exact[0], ambiguous: false };
        return { match: null, ambiguous: true };
      }
    }
  }

  return { match: null, ambiguous: false };
}

/**
 * Compute the preview for Bulk Add Rows in a Full Vendor Price Update worksheet.
 * Genuinely matches existing worksheet items to update them, and marks
 * non-matching items as new rows to add.
 */
export async function computeFullVendorBulkPreview(
  inputRows: BulkAddInputRow[],
  existingItems: WorksheetItemLite[],
  productsById?: Map<string, { sku: string; normalizedSku: string }>,
): Promise<BulkAddParsedItem[]> {
  const index = buildWorksheetItemIndex(existingItems, productsById);

  // Collect Cleaned and Raw SKUs for items that will be genuinely new
  const cleanedSkus: string[] = [];
  const rawOnlySkus: string[] = [];

  for (const r of inputRows) {
    const clean = String(r.cleanedSku ?? "").trim();
    const raw = String(r.rawVendorSku ?? "").trim();
    const { match } = matchWorksheetItem(r, index);
    if (!match) {
      if (clean) cleanedSkus.push(clean);
      else if (raw) rawOnlySkus.push(raw);
    }
  }

  const [cleanProductMap, rawProductMap, discMaps] = await Promise.all([
    cleanedSkus.length > 0 ? lookupProductsForCleanedSkus(cleanedSkus) : new Map<string, ProductRow>(),
    rawOnlySkus.length > 0 ? findProductsByRawSkus(rawOnlySkus) : new Map<string, ProductRow>(),
    getDiscountMaps(),
  ]);

  // Track duplicates within the batch
  const seenInBatch = new Set<string>();
  const duplicateKeysInBatch = new Set<string>();

  for (const r of inputRows) {
    const cleanIn = String(r.cleanedSku ?? "").trim();
    const rawIn = String(r.rawVendorSku ?? "").trim();
    const key = cleanIn ? `clean:${stripped(cleanIn)}` : `raw:${stripped(rawIn)}`;
    if (cleanIn || rawIn) {
      if (seenInBatch.has(key)) duplicateKeysInBatch.add(key);
      seenInBatch.add(key);
    }
  }

  const results: BulkAddParsedItem[] = [];

  for (let i = 0; i < inputRows.length; i++) {
    const row = inputRows[i];
    const validation = validateBulkRow(row);

    const rawIn = String(row.rawVendorSku ?? "").trim();
    const cleanIn = String(row.cleanedSku ?? "").trim();
    const batchKey = cleanIn ? `clean:${stripped(cleanIn)}` : `raw:${stripped(rawIn)}`;
    const isDuplicateInBatch = (cleanIn || rawIn) ? duplicateKeysInBatch.has(batchKey) : false;

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
        isDuplicateInWorksheet: false,
        targetAction: "add",
      });
      continue;
    }

    // Try matching against existing worksheet items
    const { match: existingItem, ambiguous } = matchWorksheetItem(row, index);

    if (ambiguous) {
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
        validationError: "Ambiguous SKU: matches multiple products in worksheet",
        isDuplicateInBatch,
        isDuplicateInWorksheet: false,
        targetAction: "add",
      });
      continue;
    }

    if (existingItem) {
      // Existing row to UPDATE
      const curRow: CurRow = {
        rawVendorSku: existingItem.rawVendorSku,
        cleanedSku: existingItem.cleanedSku,
        cleanedOverridden: true,
        discount: existingItem.discount ? String(existingItem.discount) : "0.00",
        vendorListPriceNew: existingItem.vendorListPriceNew,
        marginDivisor: existingItem.marginDivisor ? String(existingItem.marginDivisor) : DEFAULT_DIVISOR,
        notes: existingItem.notes,
        vendor: existingItem.vendor,
        brand: existingItem.brand,
        nearest9Custom: existingItem.nearest9Custom ?? null,
      };

      const patch: Record<string, unknown> = {};
      if (cleanIn) {
        patch.cleanedSku = cleanIn;
      }
      if (rawIn) {
        patch.rawVendorSku = rawIn;
      }
      if (row.vendorListPriceNew !== undefined && String(row.vendorListPriceNew).trim() !== "") {
        patch.vendorListPriceNew = String(row.vendorListPriceNew).trim();
      }
      if (row.discount !== undefined && String(row.discount).trim() !== "") {
        patch.discount = String(row.discount).trim();
      }
      if (row.marginDivisor !== undefined && String(row.marginDivisor).trim() !== "") {
        patch.marginDivisor = String(row.marginDivisor).trim();
      }
      if (row.notes !== undefined && String(row.notes).trim() !== "") {
        patch.notes = String(row.notes).trim();
      } else if (existingItem.notes.includes("not in vendor price list") && patch.vendorListPriceNew) {
        patch.notes = "";
      }

      const recalculated = await recalcRow(curRow, patch);

      results.push({
        index: i,
        rawVendorSku: recalculated.rawVendorSku,
        cleanedSku: recalculated.cleanedSku,
        cleanedOverridden: recalculated.cleanedOverridden,
        productId: existingItem.productId,
        productNumber: existingItem.productNumber,
        productName: existingItem.productName,
        brand: existingItem.brand,
        vendor: existingItem.vendor,
        discount: recalculated.discount,
        currentListPrice: recalculated.currentListPrice,
        vendorListPriceNew: recalculated.vendorListPriceNew,
        ourNewListPrice: recalculated.ourNewListPrice,
        marginDivisor: recalculated.marginDivisor,
        ourNewRetailPrice: recalculated.ourNewRetailPrice,
        oldRetailPrice: recalculated.oldRetailPrice,
        nearest9: recalculated.nearest9,
        notes: recalculated.notes,
        matched: true,
        isInactive: existingItem.isInactive,
        isValid: true,
        isDuplicateInBatch,
        isDuplicateInWorksheet: false, // In Full Vendor, this is an update, NOT a worksheet duplicate
        targetAction: "update",
        existingItemId: existingItem.id,
      });
      continue;
    }

    // Genuinely new product to ADD
    let prod: ProductRow | null = null;
    if (cleanIn) {
      prod = cleanProductMap.get(cleanIn) ?? null;
      if (!prod) prod = (await lookupProduct(cleanIn)) as ProductRow | null;
      if (!prod && rawIn) {
        const rawFallback = await findProductsByRawSkus([rawIn]);
        prod = rawFallback.get(rawIn) ?? null;
      }
    } else if (rawIn) {
      prod = rawProductMap.get(rawIn) ?? null;
      if (!prod) {
        const rawFallback = await findProductsByRawSkus([rawIn]);
        prod = rawFallback.get(rawIn) ?? null;
      }
    }

    const cleanedOverridden = !!cleanIn;
    const defaultDiscount = prod ? resolveDefaultDiscount(discMaps, prod.vendor, prod.brand) : "0.00";
    const discInput = row.discount && String(row.discount).trim() !== "" ? String(row.discount).trim() : undefined;
    const priceInput =
      row.vendorListPriceNew && String(row.vendorListPriceNew).trim() !== ""
        ? String(row.vendorListPriceNew).trim().replace(/[$,]/g, "")
        : null;
    const divisorInput =
      row.marginDivisor && String(row.marginDivisor).trim() !== "" ? String(row.marginDivisor).trim() : undefined;

    const seed: CurRow = {
      rawVendorSku: rawIn,
      cleanedSku: cleanIn,
      cleanedOverridden,
      discount: discInput ?? defaultDiscount,
      vendorListPriceNew: priceInput,
      marginDivisor: divisorInput ?? DEFAULT_DIVISOR,
      notes: String(row.notes ?? ""),
      nearest9Custom: null,
      vendor: prod?.vendor ?? "",
      brand: prod?.brand ?? "",
    };

    const calculated = await recalcRow(seed, {
      rawVendorSku: rawIn,
      cleanedSku: cleanIn,
      discount: discInput,
      vendorListPriceNew: priceInput,
      marginDivisor: divisorInput,
      notes: String(row.notes ?? ""),
    });

    results.push({
      index: i,
      rawVendorSku: calculated.rawVendorSku,
      cleanedSku: calculated.cleanedSku,
      cleanedOverridden: calculated.cleanedOverridden,
      productId: calculated.productId,
      productNumber: calculated.productNumber,
      productName: calculated.productName,
      brand: calculated.brand,
      vendor: calculated.vendor,
      discount: calculated.discount,
      currentListPrice: calculated.currentListPrice,
      vendorListPriceNew: calculated.vendorListPriceNew,
      ourNewListPrice: calculated.ourNewListPrice,
      marginDivisor: calculated.marginDivisor,
      ourNewRetailPrice: calculated.ourNewRetailPrice,
      oldRetailPrice: calculated.oldRetailPrice,
      nearest9: calculated.nearest9,
      notes: calculated.notes,
      matched: calculated.matched,
      isInactive: calculated.isInactive,
      isValid: true,
      isDuplicateInBatch,
      isDuplicateInWorksheet: false,
      targetAction: "add",
    });
  }

  return results;
}

/**
 * Apply the upsert changes to the database or file store.
 * Updates matching existing worksheet items and inserts genuinely new items.
 */
export async function applyFullVendorBulkUpsert(
  sessionId: string,
  inputRows: BulkAddInputRow[],
  existingItems: WorksheetItemLite[],
  prisma: NonNullable<ReturnType<typeof getPrisma>> | null,
  productsById?: Map<string, { sku: string; normalizedSku: string }>,
): Promise<{
  updatedCount: number;
  addedCount: number;
  items: unknown[];
  updatedItems: { id: string; previous: Record<string, unknown>; current: Record<string, unknown> }[];
  addedIds: string[];
}> {
  const preview = await computeFullVendorBulkPreview(inputRows, existingItems, productsById);

  // Group by update vs add, filtering only valid items
  // (If batch duplicates exist, first occurrence is used, duplicates are skipped)
  const seenUpdateIds = new Set<string>();
  const seenAddSkus = new Set<string>();
  const toUpdate: { parsed: BulkAddParsedItem; targetId: string }[] = [];
  const toAdd: BulkAddParsedItem[] = [];

  for (const item of preview) {
    if (!item.isValid) continue;
    if (item.targetAction === "update" && item.existingItemId) {
      if (seenUpdateIds.has(item.existingItemId)) continue; // avoid double-updating from same batch
      seenUpdateIds.add(item.existingItemId);
      toUpdate.push({ parsed: item, targetId: item.existingItemId });
    } else if (item.targetAction === "add") {
      const addKey = item.cleanedSku || item.rawVendorSku;
      if (addKey && seenAddSkus.has(addKey)) continue;
      if (addKey) seenAddSkus.add(addKey);
      toAdd.push(item);
    }
  }

  const existingMap = new Map(existingItems.map((e) => [e.id, e]));

  if (!prisma) {
    const store = loadFileStore();
    const now = new Date().toISOString();
    const updatedRecords: { id: string; previous: Record<string, unknown>; current: Record<string, unknown> }[] = [];
    const createdRows: ItemRow[] = [];

    // 1. Apply updates
    for (const { parsed, targetId } of toUpdate) {
      const cur = store.items.find((i) => i.id === targetId && i.sessionId === sessionId);
      if (!cur) continue;
      const prevSnap = { ...cur };
      cur.rawVendorSku = parsed.rawVendorSku || cur.rawVendorSku;
      cur.cleanedSku = parsed.cleanedSku || cur.cleanedSku;
      cur.discount = parsed.discount;
      cur.currentListPrice = parsed.currentListPrice;
      cur.vendorListPriceNew = parsed.vendorListPriceNew;
      cur.ourNewListPrice = parsed.ourNewListPrice;
      cur.marginDivisor = parsed.marginDivisor;
      cur.ourNewRetailPrice = parsed.ourNewRetailPrice;
      cur.oldRetailPrice = parsed.oldRetailPrice;
      cur.nearest9 = parsed.nearest9;
      cur.notes = parsed.notes;
      cur.matched = parsed.matched;
      cur.isInactive = parsed.isInactive;
      if (parsed.productId) cur.productId = parsed.productId;
      if (parsed.productNumber) cur.productNumber = parsed.productNumber;
      if (parsed.productName) cur.productName = parsed.productName;
      if (parsed.brand) cur.brand = parsed.brand;
      if (parsed.vendor) cur.vendor = parsed.vendor;
      cur.updatedAt = now;
      updatedRecords.push({ id: targetId, previous: prevSnap, current: { ...cur } });
    }

    // 2. Apply additions
    for (const f of toAdd) {
      const newRow: ItemRow = {
        id: cuid(),
        sessionId,
        rawVendorSku: f.rawVendorSku,
        cleanedSku: f.cleanedSku,
        cleanedOverridden: f.cleanedOverridden,
        productId: f.productId,
        productNumber: f.productNumber,
        productName: f.productName,
        brand: f.brand,
        vendor: f.vendor,
        discount: f.discount,
        currentListPrice: f.currentListPrice,
        vendorListPriceNew: f.vendorListPriceNew,
        ourNewListPrice: f.ourNewListPrice,
        marginDivisor: f.marginDivisor,
        ourNewRetailPrice: f.ourNewRetailPrice,
        oldRetailPrice: f.oldRetailPrice,
        nearest9: f.nearest9,
        nearest9Custom: null,
        notes: f.notes,
        isInactive: f.isInactive,
        matched: f.matched,
        updatedAt: now,
      };
      store.items.push(newRow);
      createdRows.push(newRow);
    }

    saveFileStore(store);
    return {
      updatedCount: toUpdate.length,
      addedCount: toAdd.length,
      items: [...updatedRecords.map((u) => u.current), ...createdRows],
      updatedItems: updatedRecords,
      addedIds: createdRows.map((r) => r.id),
    };
  }

  // Postgres Prisma path
  const updatedRecords: { id: string; previous: Record<string, unknown>; current: Record<string, unknown> }[] = [];

  for (const { parsed, targetId } of toUpdate) {
    const cur = existingMap.get(targetId);
    if (!cur) continue;
    const prevSnap = { ...cur };
    const updateData = {
      rawVendorSku: parsed.rawVendorSku || cur.rawVendorSku,
      cleanedSku: parsed.cleanedSku || cur.cleanedSku,
      productId: parsed.productId ?? cur.productId,
      productNumber: parsed.productNumber || cur.productNumber,
      productName: parsed.productName || cur.productName,
      brand: parsed.brand || cur.brand,
      vendor: parsed.vendor || cur.vendor,
      discount: new Decimal(parsed.discount),
      currentListPrice: parsed.currentListPrice ? new Decimal(parsed.currentListPrice) : null,
      vendorListPriceNew: parsed.vendorListPriceNew ? new Decimal(parsed.vendorListPriceNew) : null,
      ourNewListPrice: parsed.ourNewListPrice ? new Decimal(parsed.ourNewListPrice) : null,
      marginDivisor: new Decimal(parsed.marginDivisor),
      ourNewRetailPrice: parsed.ourNewRetailPrice ? new Decimal(parsed.ourNewRetailPrice) : null,
      oldRetailPrice: parsed.oldRetailPrice ? new Decimal(parsed.oldRetailPrice) : null,
      nearest9: parsed.nearest9 ? new Decimal(parsed.nearest9) : null,
      notes: parsed.notes,
      matched: parsed.matched,
      isInactive: parsed.isInactive,
    };
    await prisma.priceUpdateItem.update({
      where: { id: targetId },
      data: updateData,
    });
    updatedRecords.push({ id: targetId, previous: prevSnap, current: { id: targetId, ...updateData } });
  }

  // Create new items
  const createdIds: string[] = [];
  if (toAdd.length > 0) {
    const addData = toAdd.map((f) => ({
      sessionId,
      rawVendorSku: f.rawVendorSku,
      cleanedSku: f.cleanedSku,
      cleanedOverridden: f.cleanedOverridden,
      productId: f.productId,
      productNumber: f.productNumber,
      productName: f.productName,
      brand: f.brand,
      vendor: f.vendor,
      discount: f.discount ? new Decimal(f.discount) : new Decimal(0),
      currentListPrice: f.currentListPrice ? new Decimal(f.currentListPrice) : null,
      vendorListPriceNew: f.vendorListPriceNew ? new Decimal(f.vendorListPriceNew) : null,
      ourNewListPrice: f.ourNewListPrice ? new Decimal(f.ourNewListPrice) : null,
      marginDivisor: f.marginDivisor ? new Decimal(f.marginDivisor) : new Decimal(DEFAULT_DIVISOR),
      ourNewRetailPrice: f.ourNewRetailPrice ? new Decimal(f.ourNewRetailPrice) : null,
      oldRetailPrice: f.oldRetailPrice ? new Decimal(f.oldRetailPrice) : null,
      nearest9: f.nearest9 ? new Decimal(f.nearest9) : null,
      nearest9Custom: null,
      notes: f.notes,
      isInactive: f.isInactive,
      matched: f.matched,
    }));

    for (let i = 0; i < addData.length; i += 1000) {
      const chunk = addData.slice(i, i + 1000);
      try {
        const res = await (
          prisma.priceUpdateItem as unknown as { createManyAndReturn: (opts: unknown) => Promise<{ id: string }[]> }
        ).createManyAndReturn({ data: chunk, select: { id: true } });
        createdIds.push(...res.map((r) => r.id));
      } catch {
        await prisma.priceUpdateItem.createMany({ data: chunk });
      }
    }
  }

  return {
    updatedCount: toUpdate.length,
    addedCount: toAdd.length,
    items: [...updatedRecords.map((u) => u.current), ...createdIds.map((id) => ({ id }))],
    updatedItems: updatedRecords,
    addedIds: createdIds,
  };
}
