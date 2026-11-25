import Decimal from "decimal.js";
import type { Item } from "@/components/PriceGrid";
import { compareItemValues, getItemFlags, type SortableItemKey } from "@/lib/itemSort";
import { calcNearest9, resolveNearest9 } from "@/lib/nearest9";
import {
  calcOurNewListPrice,
  calcOurNewRetailPrice,
  DEFAULT_DIVISOR,
  normalizeSku,
} from "@/lib/pricing";
import type {
  CellPatch,
  CellRange,
  ColumnFilterSpec,
  ExpandedQuickFilters,
  RowDensity,
  SortRule,
  SpreadsheetColDef,
  SpreadsheetPrefs,
} from "./types";

/**
 * Canonical column definitions for the Spreadsheet Editor.
 * Strictly mirrors the existing COLS + Flags in PriceGrid.tsx and EDITABLE in
 * /api/sessions/[id]/items/route.ts so editable vs calculated/lookup rules stay identical.
 */
export const SPREADSHEET_COLS: SpreadsheetColDef[] = [
  { key: "rawVendorSku", label: "Raw Vendor SKU/Code", shortLabel: "Raw SKU", editable: true, kind: "text", defaultWidth: 150 },
  { key: "cleanedSku", label: "Cleaned SKU", shortLabel: "Cleaned SKU", editable: true, kind: "text", defaultWidth: 140 },
  { key: "productNumber", label: "Product Number", shortLabel: "Prod #", editable: false, kind: "text", defaultWidth: 115 },
  { key: "productName", label: "Product Name", shortLabel: "Product Name", editable: false, kind: "text", defaultWidth: 270 },
  { key: "brand", label: "Brand", shortLabel: "Brand", editable: false, kind: "text", defaultWidth: 130 },
  { key: "vendor", label: "Vendor", shortLabel: "Vendor", editable: false, kind: "text", defaultWidth: 130 },
  { key: "discount", label: "Discount (%)", shortLabel: "Disc %", editable: true, kind: "number", defaultWidth: 105 },
  { key: "currentListPrice", label: "Current List Price", shortLabel: "Curr List", editable: false, kind: "number", defaultWidth: 115 },
  { key: "vendorListPriceNew", label: "Vendor List Price (New)", shortLabel: "Vendor List", editable: true, kind: "number", defaultWidth: 130 },
  { key: "ourNewListPrice", label: "Our New List Price", shortLabel: "New List", editable: false, kind: "number", defaultWidth: 115 },
  { key: "marginDivisor", label: "Margin/Divisor", shortLabel: "Divisor", editable: true, kind: "number", defaultWidth: 105 },
  { key: "ourNewRetailPrice", label: "Our New Retail Price", shortLabel: "New Retail", editable: false, kind: "number", defaultWidth: 120 },
  { key: "oldRetailPrice", label: "Old Retail Price", shortLabel: "Old Retail", editable: false, kind: "number", defaultWidth: 115 },
  { key: "nearest9", label: "Nearest 9", shortLabel: "Nearest 9", editable: true, kind: "number", defaultWidth: 115 },
  { key: "notes", label: "Notes", shortLabel: "Notes", editable: true, kind: "text", defaultWidth: 185 },
  { key: "flags", label: "Flags", shortLabel: "Flags", editable: false, kind: "flags", defaultWidth: 155 },
];

export const SPREADSHEET_COL_MAP = new Map<SortableItemKey, SpreadsheetColDef>(
  SPREADSHEET_COLS.map((c) => [c.key, c]),
);

export const EDITABLE_KEYS = new Set<string>(
  SPREADSHEET_COLS.filter((c) => c.editable).map((c) => c.key),
);

export const DEFAULT_COLUMN_ORDER: SortableItemKey[] = SPREADSHEET_COLS.map((c) => c.key);

export const DEFAULT_SPREADSHEET_PREFS: SpreadsheetPrefs = {
  columnOrder: DEFAULT_COLUMN_ORDER,
  columnSizing: Object.fromEntries(SPREADSHEET_COLS.map((c) => [c.key, c.defaultWidth])),
  columnVisibility: {},
  pinnedColumns: [],
  wrapCols: [],
  density: "comfortable",
};

export function rowHeightForDensity(density: RowDensity): number {
  if (density === "compact") return 30;
  if (density === "spacious") return 42;
  return 35;
}

/** Parse numeric string (tolerates $, %, commas, spaces). Returns null if blank or invalid. */
export function parseNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/[$,%\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validate a cell edit before applying optimistically or queuing for PATCH.
 * Mirrors backend validation in /api/sessions/[id]/items/route.ts exactly.
 */
export function validateCellEdit(
  key: string,
  rawValue: string,
): { ok: true; normalized: string } | { ok: false; error: string } {
  if (!EDITABLE_KEYS.has(key)) {
    return { ok: false, error: `Field "${key}" is read-only.` };
  }
  const trimmed = rawValue.trim();

  if (key === "discount") {
    if (trimmed === "") return { ok: true, normalized: "" };
    try {
      const dec = new Decimal(trimmed.replace(/[%$,]/g, ""));
      if (!dec.isFinite() || dec.lt(0) || dec.gt(100)) {
        return { ok: false, error: "Discount must be between 0 and 100." };
      }
      return { ok: true, normalized: dec.toFixed(2) };
    } catch {
      return { ok: false, error: "Discount must be a number between 0 and 100." };
    }
  }

  if (key === "vendorListPriceNew") {
    if (trimmed === "") return { ok: true, normalized: "" };
    try {
      const dec = new Decimal(trimmed.replace(/[$,]/g, ""));
      if (!dec.isFinite()) return { ok: false, error: "Vendor List Price must be a valid number." };
      return { ok: true, normalized: dec.toFixed(2) };
    } catch {
      return { ok: false, error: "Vendor List Price must be a valid number." };
    }
  }

  if (key === "marginDivisor") {
    if (trimmed === "") return { ok: true, normalized: "" };
    try {
      const dec = new Decimal(trimmed.replace(/[$,]/g, ""));
      if (!dec.isFinite() || dec.lte(0)) {
        return { ok: false, error: "Margin/Divisor must be greater than 0." };
      }
      return { ok: true, normalized: trimmed.replace(/[$,]/g, "") };
    } catch {
      return { ok: false, error: "Margin/Divisor must be a valid number." };
    }
  }

  if (key === "nearest9") {
    if (trimmed === "") return { ok: true, normalized: "" };
    try {
      const dec = new Decimal(trimmed.replace(/[%$,]/g, ""));
      if (!dec.isFinite()) return { ok: false, error: "Nearest 9 must be a valid number." };
      return { ok: true, normalized: dec.toFixed(2) };
    } catch {
      return { ok: false, error: "Nearest 9 must be a valid number." };
    }
  }

  if (key === "notes") {
    return { ok: true, normalized: rawValue };
  }

  return { ok: true, normalized: trimmed };
}

/**
 * Optimistically apply editable field changes to a single Item using the EXACT
 * existing pure pricing helpers (`calcOurNewListPrice`, `calcOurNewRetailPrice`,
 * `calcNearest9`, `resolveNearest9`). Never duplicates formulas.
 *
 * The backend `recalcRow()` remains authoritative and reconciles DB-dependent
 * fields (SKU inventory lookups and default vendor/brand discounts) when PATCH resolves.
 */
export function applyOptimisticPatch(row: Item, fields: Record<string, string>): Item {
  const next: Item = { ...row };

  if (fields.rawVendorSku !== undefined) {
    next.rawVendorSku = fields.rawVendorSku;
    if (!next.cleanedOverridden && fields.cleanedSku === undefined) {
      next.cleanedSku = fields.rawVendorSku.trim() ? normalizeSku(fields.rawVendorSku) : "";
    }
  }
  if (fields.cleanedSku !== undefined) {
    next.cleanedSku = fields.cleanedSku.trim();
    next.cleanedOverridden = true;
  }
  if (fields.discount !== undefined) {
    // Clearing discount restores the server's Vendor/Brand default; show 0.00 until reconciled.
    const t = fields.discount.trim();
    if (t === "") {
      next.discount = "0.00";
    } else {
      try {
        next.discount = new Decimal(t.replace(/[%$,]/g, "")).toFixed(2);
      } catch {
        next.discount = row.discount;
      }
    }
  }
  if (fields.vendorListPriceNew !== undefined) {
    const t = fields.vendorListPriceNew.trim();
    next.vendorListPriceNew = t === "" ? null : t.replace(/[$,]/g, "");
  }
  if (fields.marginDivisor !== undefined) {
    const t = fields.marginDivisor.trim();
    next.marginDivisor = t === "" ? DEFAULT_DIVISOR : t.replace(/[$,]/g, "");
  }
  if (fields.notes !== undefined) {
    next.notes = fields.notes;
  }
  if (fields.nearest9 !== undefined) {
    const t = fields.nearest9.trim();
    next.nearest9Custom = t === "" ? null : t.replace(/[%$,]/g, "");
  }

  // Recompute derived pricing columns using the exact existing pricing functions.
  const ourNewList = calcOurNewListPrice(next.vendorListPriceNew, next.discount);
  const ourNewRetail = ourNewList !== null ? calcOurNewRetailPrice(ourNewList, next.marginDivisor) : null;
  const autoNearest9 = ourNewRetail !== null ? calcNearest9(ourNewRetail) : null;
  next.ourNewListPrice = ourNewList;
  next.ourNewRetailPrice = ourNewRetail;
  next.nearest9 = resolveNearest9(autoNearest9, next.nearest9Custom);

  return next;
}

/** Read raw string value of an Item column for display/clipboard/editing. */
export function getCellRawValue(item: Item, key: SortableItemKey): string {
  if (key === "flags") return getItemFlags(item).join(", ");
  const v = (item as unknown as Record<string, unknown>)[key];
  if (v === null || v === undefined) return "";
  return String(v);
}

/** Multi-column stable sort reusing the exact shared `compareItemValues` comparator. */
export function multiSortItems<T extends Item>(rows: T[], rules: readonly SortRule[]): T[] {
  if (!rules.length) return rows;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      for (const rule of rules) {
        const cmp = compareItemValues(a.r, b.r, rule.id, rule.desc ? "desc" : "asc");
        if (cmp !== 0) return cmp;
      }
      return a.i - b.i;
    })
    .map((x) => x.r);
}

/** Evaluate a single column-level filter rule against an Item. */
export function matchesColumnFilter(item: Item, key: SortableItemKey, spec: ColumnFilterSpec): boolean {
  if (spec.kind === "flags") {
    if (!spec.values.length) return true;
    const flags = getItemFlags(item);
    return flags.some((f) => spec.values.includes(f));
  }

  const raw = getCellRawValue(item, key).trim();

  if (spec.kind === "text") {
    if (spec.op === "blank") return raw === "";
    if (spec.op === "nonBlank") return raw !== "";
    const needle = spec.value.trim().toLowerCase();
    if (!needle) return true;
    const hay = raw.toLowerCase();
    switch (spec.op) {
      case "contains": return hay.includes(needle);
      case "notContains": return !hay.includes(needle);
      case "equals": return hay === needle;
      case "notEquals": return hay !== needle;
      case "beginsWith": return hay.startsWith(needle);
      case "endsWith": return hay.endsWith(needle);
      default: return true;
    }
  }

  // Numeric column filter
  const num = parseNum(raw);
  if (spec.op === "blank") return num === null;
  if (spec.op === "nonBlank") return num !== null;
  const target = parseNum(spec.value);
  if (spec.op === "between") {
    const targetTo = parseNum(spec.valueTo);
    if (target === null && targetTo === null) return true;
    if (num === null) return false;
    if (target !== null && targetTo !== null) {
      const lo = Math.min(target, targetTo);
      const hi = Math.max(target, targetTo);
      return num >= lo && num <= hi;
    }
    if (target !== null) return num >= target;
    return targetTo !== null ? num <= targetTo : true;
  }
  if (target === null) return true;
  if (num === null) return false;
  switch (spec.op) {
    case "gt": return num > target;
    case "lt": return num < target;
    case "eq": return num === target;
    case "gte": return num >= target;
    case "lte": return num <= target;
    default: return true;
  }
}

export function isPriceChangedRow(r: Item): boolean {
  return Boolean(r.matched && r.nearest9 && r.oldRetailPrice && r.nearest9 !== r.oldRetailPrice);
}

export function isCustomOverrideRow(r: Item): boolean {
  return Boolean(r.nearest9Custom && String(r.nearest9Custom).trim() !== "");
}

export function hasVendorPrice(r: Item): boolean {
  return Boolean(r.vendorListPriceNew && String(r.vendorListPriceNew).trim() !== "");
}

export function hasDiscountApplied(r: Item): boolean {
  const n = parseNum(r.discount);
  return n !== null && n > 0;
}

export function hasNewRetailPrice(r: Item): boolean {
  return Boolean(r.ourNewRetailPrice && String(r.ourNewRetailPrice).trim() !== "");
}

/** Apply global search, legacy status filter, flags filter, expanded quick filters, and per-column filters. */
export function filterSpreadsheetItems<T extends Item>(
  items: readonly T[],
  opts: {
    globalQuery: string;
    selectedFlags: ReadonlySet<string>;
    quick: ExpandedQuickFilters;
    columnFilters: Readonly<Record<string, ColumnFilterSpec>>;
  },
): T[] {
  const q = opts.globalQuery.trim().toLowerCase();
  const activeColFilters = Object.entries(opts.columnFilters) as [SortableItemKey, ColumnFilterSpec][];
  const { quick, selectedFlags } = opts;

  return items.filter((r) => {
    if (q) {
      const haystack = `${r.rawVendorSku} ${r.cleanedSku} ${r.productNumber} ${r.productName} ${r.brand} ${r.vendor} ${r.notes}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (selectedFlags.size > 0) {
      const flags = getItemFlags(r);
      if (!flags.some((f) => selectedFlags.has(f))) return false;
    }
    // Existing legacy status filter values (preserved identically)
    switch (quick.legacyFilter) {
      case "unmatched":
      case "notfound":
        if (r.matched) return false;
        break;
      case "changed":
        if (!isPriceChangedRow(r)) return false;
        break;
      case "inactive":
        if (!r.isInactive) return false;
        break;
      case "missing":
        if (hasVendorPrice(r)) return false;
        break;
      case "custom":
        if (!isCustomOverrideRow(r)) return false;
        break;
    }
    // Expanded composable quick filters
    if (quick.vendorPrice === "yes" && !hasVendorPrice(r)) return false;
    if (quick.vendorPrice === "no" && hasVendorPrice(r)) return false;
    if (quick.discount === "yes" && !hasDiscountApplied(r)) return false;
    if (quick.discount === "no" && hasDiscountApplied(r)) return false;
    if (quick.newRetail === "yes" && !hasNewRetailPrice(r)) return false;
    if (quick.newRetail === "no" && hasNewRetailPrice(r)) return false;
    if (quick.customOverride === "yes" && !isCustomOverrideRow(r)) return false;
    if (quick.customOverride === "no" && isCustomOverrideRow(r)) return false;
    if (quick.priceChanged === "yes" && !isPriceChangedRow(r)) return false;
    if (quick.priceChanged === "no" && isPriceChangedRow(r)) return false;

    for (const [colKey, spec] of activeColFilters) {
      if (!matchesColumnFilter(r, colKey, spec)) return false;
    }
    return true;
  });
}

/* --------------------------- Selection & Ranges --------------------------- */

export function normalizeRange(aRow: number, aCol: number, bRow: number, bCol: number): CellRange {
  return {
    startRow: Math.min(aRow, bRow),
    endRow: Math.max(aRow, bRow),
    startCol: Math.min(aCol, bCol),
    endCol: Math.max(aCol, bCol),
  };
}

export function isCellInRange(range: CellRange | null, row: number, col: number): boolean {
  if (!range) return false;
  return row >= range.startRow && row <= range.endRow && col >= range.startCol && col <= range.endCol;
}

/* ----------------------------- TSV Clipboard ------------------------------ */

function escapeTsvCell(v: string): string {
  if (/[\t\r\n"]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function serializeRangeToTsv(
  rows: readonly Item[],
  visibleColKeys: readonly SortableItemKey[],
  range: CellRange,
): string {
  const lines: string[] = [];
  const rStart = Math.max(0, range.startRow);
  const rEnd = Math.min(rows.length - 1, range.endRow);
  const cStart = Math.max(0, range.startCol);
  const cEnd = Math.min(visibleColKeys.length - 1, range.endCol);
  for (let r = rStart; r <= rEnd; r++) {
    const cells: string[] = [];
    for (let c = cStart; c <= cEnd; c++) {
      cells.push(escapeTsvCell(getCellRawValue(rows[r], visibleColKeys[c])));
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

/** Parse Excel/Google Sheets TSV clipboard text into a 2D string matrix. */
export function parseTsvClipboard(text: string): string[][] {
  if (!text) return [];
  // Strip single trailing newline emitted by Excel/Sheets copy
  const clean = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      inQuotes = true;
    } else if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

export type BulkEditPlan = {
  patches: CellPatch[];
  beforePatches: CellPatch[];
  editedCellCount: number;
  skippedReadOnly: number;
  errors: string[];
};

/**
 * Build validated patches for pasting a 2D clipboard matrix into a target range.
 * - Single-cell clipboard pasted onto a multi-cell range fills every editable cell in the range.
 * - Multi-cell clipboard expands from range top-left (clamped to sheet bounds).
 * - Read-only columns are safely skipped and counted.
 */
export function computePastePatches(
  rows: readonly Item[],
  visibleColKeys: readonly SortableItemKey[],
  selection: CellRange,
  matrix: readonly (readonly string[])[],
): BulkEditPlan {
  if (!matrix.length || !matrix[0].length) {
    return { patches: [], beforePatches: [], editedCellCount: 0, skippedReadOnly: 0, errors: [] };
  }
  const singleValue = matrix.length === 1 && matrix[0].length === 1;
  const targetRows = singleValue
    ? selection.endRow - selection.startRow + 1
    : Math.max(matrix.length, selection.endRow - selection.startRow + 1);
  const targetCols = singleValue
    ? selection.endCol - selection.startCol + 1
    : Math.max(matrix[0].length, selection.endCol - selection.startCol + 1);

  const maxRows = singleValue ? targetRows : matrix.length;
  const maxCols = singleValue ? targetCols : Math.max(...matrix.map((r) => r.length));

  // If user selected an exact multiple or larger area with a 1-row/1-col/1-cell copy, fill selection;
  // otherwise paste matrix dimensions starting at top-left.
  const effRows = singleValue ? targetRows : maxRows;
  const effCols = singleValue ? targetCols : maxCols;

  const byRow = new Map<string, Record<string, string>>();
  const beforeByRow = new Map<string, Record<string, string>>();
  let editedCellCount = 0;
  let skippedReadOnly = 0;
  const errors: string[] = [];

  for (let dr = 0; dr < effRows; dr++) {
    const rIdx = selection.startRow + dr;
    if (rIdx < 0 || rIdx >= rows.length) break;
    const item = rows[rIdx];
    const srcRow = matrix[dr % matrix.length];
    for (let dc = 0; dc < effCols; dc++) {
      const cIdx = selection.startCol + dc;
      if (cIdx < 0 || cIdx >= visibleColKeys.length) break;
      const colKey = visibleColKeys[cIdx];
      if (!EDITABLE_KEYS.has(colKey)) {
        skippedReadOnly++;
        continue;
      }
      const rawVal = srcRow[dc % srcRow.length] ?? "";
      const check = validateCellEdit(colKey, rawVal);
      if (!check.ok) {
        if (errors.length < 5) errors.push(`Row ${rIdx + 1} (${colKey}): ${check.error}`);
        continue;
      }
      const prevRaw = colKey === "nearest9" ? (item.nearest9Custom ?? "") : getCellRawValue(item, colKey);
      if (prevRaw === check.normalized && getCellRawValue(item, colKey) === check.normalized) {
        continue;
      }
      const entry = byRow.get(item.id) ?? {};
      entry[colKey] = check.normalized;
      byRow.set(item.id, entry);

      const beforeEntry = beforeByRow.get(item.id) ?? {};
      beforeEntry[colKey] = prevRaw;
      beforeByRow.set(item.id, beforeEntry);
      editedCellCount++;
    }
  }

  return {
    patches: [...byRow.entries()].map(([id, fields]) => ({ id, fields })),
    beforePatches: [...beforeByRow.entries()].map(([id, fields]) => ({ id, fields })),
    editedCellCount,
    skippedReadOnly,
    errors,
  };
}

/**
 * Build validated patches for dragging the fill handle from `source` to `target`
 * (supports dragging down, up, right, or left; tiles the source selection pattern).
 */
export function computeFillPatches(
  rows: readonly Item[],
  visibleColKeys: readonly SortableItemKey[],
  source: CellRange,
  target: CellRange,
): BulkEditPlan {
  const srcHeight = source.endRow - source.startRow + 1;
  const srcWidth = source.endCol - source.startCol + 1;
  const byRow = new Map<string, Record<string, string>>();
  const beforeByRow = new Map<string, Record<string, string>>();
  let editedCellCount = 0;
  let skippedReadOnly = 0;
  const errors: string[] = [];

  for (let r = target.startRow; r <= target.endRow; r++) {
    if (r < 0 || r >= rows.length) continue;
    const item = rows[r];
    for (let c = target.startCol; c <= target.endCol; c++) {
      if (c < 0 || c >= visibleColKeys.length) continue;
      // Skip cells inside the source rectangle itself
      if (isCellInRange(source, r, c)) continue;
      const colKey = visibleColKeys[c];
      if (!EDITABLE_KEYS.has(colKey)) {
        skippedReadOnly++;
        continue;
      }
      const srcRowIdx = source.startRow + ((((r - source.startRow) % srcHeight) + srcHeight) % srcHeight);
      const srcColIdx = source.startCol + ((((c - source.startCol) % srcWidth) + srcWidth) % srcWidth);
      const srcItem = rows[srcRowIdx];
      const srcColKey = visibleColKeys[srcColIdx];
      const rawVal = srcColKey === "nearest9"
        ? (srcItem.nearest9Custom ?? getCellRawValue(srcItem, srcColKey))
        : getCellRawValue(srcItem, srcColKey);

      const check = validateCellEdit(colKey, rawVal);
      if (!check.ok) {
        if (errors.length < 5) errors.push(`Row ${r + 1} (${colKey}): ${check.error}`);
        continue;
      }
      const prevRaw = colKey === "nearest9" ? (item.nearest9Custom ?? "") : getCellRawValue(item, colKey);
      const entry = byRow.get(item.id) ?? {};
      entry[colKey] = check.normalized;
      byRow.set(item.id, entry);

      const beforeEntry = beforeByRow.get(item.id) ?? {};
      beforeEntry[colKey] = prevRaw;
      beforeByRow.set(item.id, beforeEntry);
      editedCellCount++;
    }
  }

  return {
    patches: [...byRow.entries()].map(([id, fields]) => ({ id, fields })),
    beforePatches: [...beforeByRow.entries()].map(([id, fields]) => ({ id, fields })),
    editedCellCount,
    skippedReadOnly,
    errors,
  };
}

/* ------------------------ Column Preferences Storage ---------------------- */

export function prefsStorageKey(userId: string | null | undefined): string {
  return `price_tool_spreadsheet_prefs_v1:${userId || "default"}`;
}

export function sanitizeSpreadsheetPrefs(raw: unknown): SpreadsheetPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_SPREADSHEET_PREFS };
  const r = raw as Record<string, unknown>;
  const validKey = (k: unknown): k is SortableItemKey =>
    typeof k === "string" && SPREADSHEET_COL_MAP.has(k as SortableItemKey);

  // Merge stored column order with any newly added columns so nothing ever disappears
  const seen = new Set<SortableItemKey>();
  const columnOrder: SortableItemKey[] = [];
  if (Array.isArray(r.columnOrder)) {
    for (const k of r.columnOrder) {
      if (validKey(k) && !seen.has(k)) {
        seen.add(k);
        columnOrder.push(k);
      }
    }
  }
  for (const k of DEFAULT_COLUMN_ORDER) {
    if (!seen.has(k)) columnOrder.push(k);
  }

  const columnSizing: Record<string, number> = { ...DEFAULT_SPREADSHEET_PREFS.columnSizing };
  if (r.columnSizing && typeof r.columnSizing === "object" && !Array.isArray(r.columnSizing)) {
    for (const [k, v] of Object.entries(r.columnSizing as Record<string, unknown>)) {
      if (validKey(k) && typeof v === "number" && Number.isFinite(v)) {
        columnSizing[k] = Math.max(64, Math.min(720, Math.round(v)));
      }
    }
  }

  const columnVisibility: Record<string, boolean> = {};
  if (r.columnVisibility && typeof r.columnVisibility === "object" && !Array.isArray(r.columnVisibility)) {
    for (const [k, v] of Object.entries(r.columnVisibility as Record<string, unknown>)) {
      if (validKey(k) && typeof v === "boolean") columnVisibility[k] = v;
    }
  }

  const pinnedColumns: SortableItemKey[] = [];
  if (Array.isArray(r.pinnedColumns)) {
    for (const k of r.pinnedColumns) {
      if (validKey(k) && !pinnedColumns.includes(k)) pinnedColumns.push(k);
    }
  }

  const wrapCols: string[] = Array.isArray(r.wrapCols)
    ? [...new Set(r.wrapCols.filter((k): k is string => validKey(k)))]
    : [];

  const density: RowDensity =
    r.density === "compact" || r.density === "spacious" ? r.density : "comfortable";

  return { columnOrder, columnSizing, columnVisibility, pinnedColumns, wrapCols, density };
}

export function loadSpreadsheetPrefs(userId: string | null | undefined): SpreadsheetPrefs {
  try {
    if (typeof window === "undefined") return { ...DEFAULT_SPREADSHEET_PREFS };
    const raw = localStorage.getItem(prefsStorageKey(userId));
    if (!raw) return { ...DEFAULT_SPREADSHEET_PREFS };
    return sanitizeSpreadsheetPrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SPREADSHEET_PREFS };
  }
}

export function saveSpreadsheetPrefs(userId: string | null | undefined, prefs: SpreadsheetPrefs): void {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(prefsStorageKey(userId), JSON.stringify(prefs));
  } catch {
    // Ignore storage quota errors
  }
}
