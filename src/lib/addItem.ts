import Decimal from "decimal.js";
import { computeRowsForImport } from "./lookup";
import { recalcRow, type CurRow } from "./recalc";
import { DEFAULT_DIVISOR } from "./pricing";
import { cuid, loadFileStore, saveFileStore, type ItemRow } from "./store";
import { getPrisma } from "./db";
import type { PriceRowResult } from "./nearest9";

/** The 6 columns the Bulk Add feature accepts. Mirrors `NewItemInput` (AddItemDialog). */
export type AddItemInput = {
  rawVendorSku: string;
  cleanedSku: string;
  discount: string;
  vendorListPriceNew: string;
  marginDivisor: string;
  notes: string;
};

/** Computed fields for one row, identical to what the single Add Row POST stores. */
export type NewFields = Omit<ItemRow, "id" | "sessionId" | "updatedAt">;

/** One computed row plus the position it came from (so the preview can merge back). */
export type ComputedItem = NewFields & {
  index: number;
  /** True when the row cannot be added (no SKU, or a validation error). */
  invalid: boolean;
  invalidReason: string;
};

const SEED: CurRow = {
  rawVendorSku: "",
  cleanedSku: "",
  cleanedOverridden: false,
  discount: "0.00",
  vendorListPriceNew: null,
  marginDivisor: DEFAULT_DIVISOR,
  notes: "",
  nearest9Custom: null,
};

/** Discount validation, identical to the single Add Row POST (0-100 or blank). */
function discountError(d: string): string | null {
  if (!d.trim()) return null;
  try {
    const dec = new Decimal(d.replace(/[%$,]/g, ""));
    if (!dec.isFinite() || dec.lt(0) || dec.gt(100)) return "Discount must be 0-100.";
    return null;
  } catch {
    return "Discount must be 0-100.";
  }
}

function stubInvalid(input: AddItemInput, idx: number, reason: string): ComputedItem {
  return {
    rawVendorSku: input.rawVendorSku ?? "",
    cleanedSku: input.cleanedSku ?? "",
    cleanedOverridden: false,
    productId: null,
    productNumber: "",
    productName: "",
    brand: "",
    vendor: "",
    discount: "0.00",
    currentListPrice: null,
    vendorListPriceNew: input.vendorListPriceNew || null,
    ourNewListPrice: null,
    marginDivisor: DEFAULT_DIVISOR,
    ourNewRetailPrice: null,
    oldRetailPrice: null,
    nearest9: null,
    nearest9Custom: null,
    notes: input.notes ?? "",
    isInactive: false,
    matched: false,
    index: idx,
    invalid: true,
    invalidReason: reason,
  };
}

/**
 * Build a ComputedItem from a `computeRowsForImport` result + the user input.
 * Mirrors the single Add Row POST field-for-field (notes + null nearest9Custom).
 */
function computedToItem(
  c: { raw: string; price: string | null; calc: PriceRowResult; productId: string | null },
  input: AddItemInput,
  idx: number,
): ComputedItem {
  return {
    rawVendorSku: c.raw,
    cleanedSku: c.calc.cleanedSku,
    cleanedOverridden: false,
    productId: c.productId ?? null,
    productNumber: c.calc.productNumber,
    productName: c.calc.productName,
    brand: c.calc.brand,
    vendor: c.calc.vendor,
    discount: c.calc.discount,
    currentListPrice: c.calc.currentListPrice,
    vendorListPriceNew: c.price,
    ourNewListPrice: c.calc.ourNewListPrice,
    marginDivisor: c.calc.marginDivisor,
    ourNewRetailPrice: c.calc.ourNewRetailPrice,
    oldRetailPrice: c.calc.oldRetailPrice,
    nearest9: c.calc.nearest9,
    nearest9Custom: null,
    notes: input.notes ?? "",
    isInactive: c.calc.isInactive,
    matched: c.calc.matched,
    index: idx,
    invalid: false,
    invalidReason: "",
  };
}

/**
 * Compute the stored fields for a batch of bulk-add rows.
 *
 * Per-row behaviour is identical to the existing Add Row POST:
 *  - a provided Cleaned SKU uses the manual Cleaned SKU path (`recalcRow`),
 *  - a raw-only SKU uses the import pipeline (`computeRowsForImport`), which
 *    shares its batched inventory lookup so a hundred pasted rows hit the DB
 *    in a single indexed query instead of one per row.
 * Discount / divisor overrides are honoured exactly; blank ones fall through to
 * the existing defaults (default divisor 0.605, automatic Nearest 9).
 */
export async function computeItemsBulk(inputs: AddItemInput[]): Promise<ComputedItem[]> {
  const out: ComputedItem[] = new Array(inputs.length);
  const cleanedIdx: number[] = [];
  const rawIdx: number[] = [];

  for (let idx = 0; idx < inputs.length; idx++) {
    const inp = inputs[idx];
    const raw = inp.rawVendorSku.trim();
    const cleaned = inp.cleanedSku.trim();
    if (!raw && !cleaned) {
      out[idx] = stubInvalid(inp, idx, "Enter a Raw Vendor SKU/Code or a Cleaned SKU.");
      continue;
    }
    const discErr = discountError(inp.discount);
    if (discErr) {
      out[idx] = stubInvalid(inp, idx, discErr);
      continue;
    }
    if (cleaned) cleanedIdx.push(idx);
    else rawIdx.push(idx);
  }

  // --- Raw-only rows: one batched computeRowsForImport call (shared lookup) ---
  if (rawIdx.length) {
    const raws = rawIdx.map((i) => inputs[i].rawVendorSku.trim());
    const overrides = new Map<string, { discount?: string; margin?: string }>();
    for (const i of rawIdx) {
      const inp = inputs[i];
      overrides.set(inp.rawVendorSku.trim(), { discount: inp.discount, margin: inp.marginDivisor });
    }
    const computed = await computeRowsForImport(
      raws.map((raw) => ({ raw, price: inputs[rawIdx[raws.indexOf(raw)]].vendorListPriceNew || null })),
      overrides,
    );
    for (let k = 0; k < rawIdx.length; k++) {
      const c = computed[k];
      const idx = rawIdx[k];
      const inp = inputs[idx];
      out[idx] = computedToItem(c, inp, idx);
    }
  }

  // --- Cleaned-SKU rows: the existing manual Cleaned SKU path (recalcRow) ---
  for (const idx of cleanedIdx) {
    const inp = inputs[idx];
    const f = await recalcRow({ ...SEED }, {
      rawVendorSku: inp.rawVendorSku,
      cleanedSku: inp.cleanedSku,
      discount: inp.discount,
      vendorListPriceNew: inp.vendorListPriceNew || null,
      marginDivisor: inp.marginDivisor,
      notes: inp.notes,
      nearest9: "",
    });
    out[idx] = { ...f, index: idx, invalid: false, invalidReason: "" };
  }

  return out;
}

function toItemRow(f: ComputedItem, sessionId: string, now: string): ItemRow {
  return {
    id: cuid(),
    sessionId,
    rawVendorSku: f.rawVendorSku,
    cleanedSku: f.cleanedSku,
    cleanedOverridden: f.cleanedOverridden,
    productId: f.productId ?? null,
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
    nearest9Custom: f.nearest9Custom ?? null,
    notes: f.notes,
    isInactive: f.isInactive,
    matched: f.matched,
    updatedAt: now,
  };
}

/** Persist computed rows (valid only) into a price update. Batches in chunks of 1000. */
export async function persistItemsBulk(sessionId: string, computed: ComputedItem[]): Promise<ItemRow[]> {
  const now = new Date().toISOString();
  const valid = computed.filter((c) => !c.invalid);
  const rows = valid.map((f) => toItemRow(f, sessionId, now));
  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    if (!store.sessions.some((s) => s.id === sessionId)) {
      throw new Error("Price update not found");
    }
    for (const row of rows) store.items.push(row);
    saveFileStore(store);
    return rows;
  }
  const data = rows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    rawVendorSku: r.rawVendorSku,
    cleanedSku: r.cleanedSku,
    cleanedOverridden: r.cleanedOverridden,
    productId: r.productId,
    productNumber: r.productNumber,
    productName: r.productName,
    brand: r.brand,
    vendor: r.vendor,
    discount: new Decimal(r.discount),
    currentListPrice: r.currentListPrice ? new Decimal(r.currentListPrice) : null,
    vendorListPriceNew: r.vendorListPriceNew ? new Decimal(r.vendorListPriceNew) : null,
    ourNewListPrice: r.ourNewListPrice ? new Decimal(r.ourNewListPrice) : null,
    marginDivisor: new Decimal(r.marginDivisor),
    ourNewRetailPrice: r.ourNewRetailPrice ? new Decimal(r.ourNewRetailPrice) : null,
    oldRetailPrice: r.oldRetailPrice ? new Decimal(r.oldRetailPrice) : null,
    nearest9: r.nearest9 ? new Decimal(r.nearest9) : null,
    nearest9Custom: r.nearest9Custom ? new Decimal(r.nearest9Custom) : null,
    notes: r.notes,
    isInactive: r.isInactive,
    matched: r.matched,
  }));
  for (let i = 0; i < data.length; i += 1000) {
    await prisma.priceUpdateItem.createMany({ data: data.slice(i, i + 1000) });
  }
  return rows;
}
