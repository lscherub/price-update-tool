import Decimal from "decimal.js";
import { normalizeSku, skuCandidates, DEFAULT_DIVISOR } from "./pricing";
import { calculateRow, resolveNearest9 } from "./nearest9";
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

  const addKeys = (map: Map<string, WorksheetItemLite[]>, keys: Iterable<string>, item: WorksheetItemLite) => {
    for (const k of keys) {
      if (!k || k === "0") continue;
      let list = map.get(k);
      if (!list) {
        list = [];
        map.set(k, list);
      }
      list.push(item);
    }
  };

  for (const item of items) {
    if (item.cleanedSku) {
      const c = item.cleanedSku.trim();
      if (c) {
        const keys = new Set<string>();
        keys.add(c);
        const sl = spaceless(c);
        if (sl) keys.add(sl);
        const st = stripped(c);
        if (st && st !== "0") keys.add(st);
        addKeys(index.byClean, keys, item);
      }
    }
    if (item.rawVendorSku) {
      const r = item.rawVendorSku.trim();
      if (r) {
        const keys = new Set<string>();
        keys.add(r);
        const sl = spaceless(r);
        if (sl) keys.add(sl);
        const st = stripped(r);
        if (st && st !== "0") keys.add(st);
        const norm = normalizeSku(r);
        if (norm) {
          keys.add(norm);
          const stNorm = stripped(norm);
          if (stNorm && stNorm !== "0") keys.add(stNorm);
        }
        addKeys(index.byRaw, keys, item);
      }
    }
    if (item.productId && productsById) {
      const p = productsById.get(item.productId);
      if (p) {
        const keys = new Set<string>();
        if (p.sku) {
          const s = p.sku.trim();
          if (s) {
            keys.add(s);
            const sl = spaceless(s);
            if (sl) keys.add(sl);
            const st = stripped(s);
            if (st && st !== "0") keys.add(st);
          }
        }
        if (p.normalizedSku) {
          const ns = p.normalizedSku.trim();
          if (ns) {
            keys.add(ns);
            const stNorm = stripped(ns);
            if (stNorm && stNorm !== "0") keys.add(stNorm);
          }
        }
        addKeys(index.byProductSku, keys, item);
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
    // Fast path: single exact match on Cleaned SKU
    const exactClean = index.byClean.get(cleanIn);
    if (exactClean && exactClean.length === 1) {
      return { match: exactClean[0], ambiguous: false };
    }

    const sl = spaceless(cleanIn);
    const st = stripped(cleanIn);

    const hitMap = new Map<string, WorksheetItemLite>();
    const addHits = (list?: WorksheetItemLite[]) => {
      if (!list) return;
      for (const item of list) {
        if (!hitMap.has(item.id)) hitMap.set(item.id, item);
      }
    };

    addHits(index.byClean.get(cleanIn));
    if (sl !== cleanIn) addHits(index.byClean.get(sl));
    addHits(index.byProductSku.get(cleanIn));
    if (sl !== cleanIn) addHits(index.byProductSku.get(sl));
    if (st && st !== cleanIn && st !== sl && st !== "0") {
      addHits(index.byClean.get(st));
      addHits(index.byProductSku.get(st));
    }
    addHits(index.byRaw.get(cleanIn));
    if (sl !== cleanIn) addHits(index.byRaw.get(sl));

    const deduped = Array.from(hitMap.values());
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
      const exactRaw = index.byRaw.get(c);
      if (exactRaw && exactRaw.length === 1) {
        return { match: exactRaw[0], ambiguous: false };
      }

      const st = stripped(c);
      const hitMap = new Map<string, WorksheetItemLite>();
      const addHits = (list?: WorksheetItemLite[]) => {
        if (!list) return;
        for (const item of list) {
          if (!hitMap.has(item.id)) hitMap.set(item.id, item);
        }
      };

      addHits(index.byClean.get(c));
      addHits(index.byRaw.get(c));
      addHits(index.byProductSku.get(c));
      if (st && st !== c && st !== "0") {
        addHits(index.byClean.get(st));
        addHits(index.byRaw.get(st));
        addHits(index.byProductSku.get(st));
      }

      const deduped = Array.from(hitMap.values());
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

  // Pre-calculate matches once for each input row to avoid calling matchWorksheetItem twice
  const matches: { match: WorksheetItemLite | null; ambiguous: boolean }[] = new Array(inputRows.length);
  const cleanedSkus: string[] = [];
  const rawOnlySkus: string[] = [];

  for (let i = 0; i < inputRows.length; i++) {
    const r = inputRows[i];
    const m = matchWorksheetItem(r, index);
    matches[i] = m;
    if (!m.match && !m.ambiguous) {
      const clean = String(r.cleanedSku ?? "").trim();
      const raw = String(r.rawVendorSku ?? "").trim();
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

    // Use precomputed match against existing worksheet items
    const { match: existingItem, ambiguous } = matches[i];

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
      // Existing row to UPDATE — compute synchronously in-memory (no repeated DB lookups)
      const discountVal =
        row.discount !== undefined && String(row.discount).trim() !== ""
          ? String(row.discount).trim().replace(/[%$,]/g, "")
          : existingItem.discount || "0.00";

      const divisorVal =
        row.marginDivisor !== undefined && String(row.marginDivisor).trim() !== ""
          ? String(row.marginDivisor).trim()
          : existingItem.marginDivisor || DEFAULT_DIVISOR;

      const priceVal =
        row.vendorListPriceNew !== undefined && String(row.vendorListPriceNew).trim() !== ""
          ? String(row.vendorListPriceNew).trim().replace(/[$,]/g, "")
          : existingItem.vendorListPriceNew;

      let notesVal = existingItem.notes;
      if (row.notes !== undefined && String(row.notes).trim() !== "") {
        notesVal = String(row.notes).trim();
      } else if (existingItem.notes.includes("not in vendor price list") && priceVal) {
        notesVal = "";
      }

      const calc = calculateRow({
        rawVendorSku: rawIn || existingItem.rawVendorSku,
        cleanedSku: cleanIn || existingItem.cleanedSku,
        cleanedOverridden: true,
        discount: discountVal,
        vendorListPriceNew: priceVal,
        marginDivisor: divisorVal,
        product: {
          productNumber: existingItem.productNumber,
          description: existingItem.productName,
          brand: existingItem.brand,
          vendor: existingItem.vendor,
          listCost: existingItem.currentListPrice,
          price: existingItem.oldRetailPrice,
          isInactive: existingItem.isInactive,
        },
        defaultDiscount: existingItem.discount || "0.00",
      });

      const finalNearest9 = resolveNearest9(calc.nearest9, existingItem.nearest9Custom ?? null);

      results.push({
        index: i,
        rawVendorSku: rawIn || existingItem.rawVendorSku,
        cleanedSku: cleanIn || existingItem.cleanedSku,
        cleanedOverridden: true,
        productId: existingItem.productId,
        productNumber: existingItem.productNumber,
        productName: existingItem.productName,
        brand: existingItem.brand,
        vendor: existingItem.vendor,
        discount: calc.discount,
        currentListPrice: calc.currentListPrice,
        vendorListPriceNew: priceVal,
        ourNewListPrice: calc.ourNewListPrice,
        marginDivisor: calc.marginDivisor,
        ourNewRetailPrice: calc.ourNewRetailPrice,
        oldRetailPrice: calc.oldRetailPrice,
        nearest9: finalNearest9,
        notes: notesVal,
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

    // Genuinely new product to ADD — use preloaded bulk map (no repeated DB lookups)
    const prod: ProductRow | null = cleanIn
      ? cleanProductMap.get(cleanIn) ?? null
      : rawIn
      ? rawProductMap.get(rawIn) ?? null
      : null;

    const cleanedOverridden = !!cleanIn;
    const defaultDiscount = prod ? resolveDefaultDiscount(discMaps, prod.vendor, prod.brand) : "0.00";
    const discInput = row.discount && String(row.discount).trim() !== "" ? String(row.discount).trim() : undefined;
    const priceInput =
      row.vendorListPriceNew && String(row.vendorListPriceNew).trim() !== ""
        ? String(row.vendorListPriceNew).trim().replace(/[$,]/g, "")
        : null;
    const divisorInput =
      row.marginDivisor && String(row.marginDivisor).trim() !== "" ? String(row.marginDivisor).trim() : undefined;

    const calc = calculateRow({
      rawVendorSku: rawIn,
      cleanedSku: cleanIn,
      cleanedOverridden,
      discount: discInput,
      vendorListPriceNew: priceInput,
      marginDivisor: divisorInput,
      product: prod,
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
