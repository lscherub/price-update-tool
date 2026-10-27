import Decimal from "decimal.js";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { cellText } from "./importers";

export type BulkAddInputRow = {
  rawVendorSku?: string;
  cleanedSku?: string;
  discount?: string;
  vendorListPriceNew?: string;
  marginDivisor?: string;
  notes?: string;
};

export type BulkAddParsedItem = {
  index: number;
  rawVendorSku: string;
  cleanedSku: string;
  cleanedOverridden: boolean;
  productId: string | null;
  productNumber: string;
  productName: string;
  brand: string;
  vendor: string;
  discount: string;
  currentListPrice: string | null;
  vendorListPriceNew: string | null;
  ourNewListPrice: string | null;
  marginDivisor: string;
  ourNewRetailPrice: string | null;
  oldRetailPrice: string | null;
  nearest9: string | null;
  notes: string;
  matched: boolean;
  isInactive: boolean;
  isValid: boolean;
  validationError?: string;
  isDuplicateInBatch: boolean;
  isDuplicateInWorksheet: boolean;
};

export const TARGET_COLUMNS = [
  { key: "rawVendorSku", label: "Raw Vendor SKU/Code" },
  { key: "cleanedSku", label: "Cleaned SKU" },
  { key: "discount", label: "Discount (%)" },
  { key: "vendorListPriceNew", label: "Vendor List Price (New)" },
  { key: "marginDivisor", label: "Margin/Divisor" },
  { key: "notes", label: "Notes" },
] as const;

export type TargetColumnKey = (typeof TARGET_COLUMNS)[number]["key"];

/** Validate one row's user inputs. Blank fields are allowed (and use defaults). */
export function validateBulkRow(row: BulkAddInputRow): { isValid: boolean; error?: string } {
  const raw = String(row.rawVendorSku ?? "").trim();
  const clean = String(row.cleanedSku ?? "").trim();
  if (!raw && !clean) {
    return { isValid: false, error: "Missing SKU (provide Raw Vendor SKU or Cleaned SKU)" };
  }

  const disc = String(row.discount ?? "").trim().replace(/[%$,\s]/g, "");
  if (disc !== "") {
    try {
      const d = new Decimal(disc);
      if (!d.isFinite() || d.lt(0) || d.gt(100)) {
        return { isValid: false, error: "Discount must be between 0 and 100%" };
      }
    } catch {
      return { isValid: false, error: "Discount must be a valid number (0–100)" };
    }
  }

  const price = String(row.vendorListPriceNew ?? "").trim().replace(/[$,\s]/g, "");
  if (price !== "") {
    try {
      const p = new Decimal(price);
      if (!p.isFinite() || p.lt(0)) {
        return { isValid: false, error: "Price must be a non-negative number" };
      }
    } catch {
      return { isValid: false, error: "Price must be a valid number" };
    }
  }

  const div = String(row.marginDivisor ?? "").trim().replace(/[$,\s]/g, "");
  if (div !== "") {
    try {
      const m = new Decimal(div);
      if (!m.isFinite() || m.lte(0)) {
        return { isValid: false, error: "Margin/Divisor must be greater than 0" };
      }
    } catch {
      return { isValid: false, error: "Margin/Divisor must be a valid number" };
    }
  }

  return { isValid: true };
}

/** Guess column mapping based on header strings. */
export function guessColumnMapping(headers: string[]): Record<TargetColumnKey, string> {
  const mapping: Record<TargetColumnKey, string> = {
    rawVendorSku: "",
    cleanedSku: "",
    discount: "",
    vendorListPriceNew: "",
    marginDivisor: "",
    notes: "",
  };

  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());

  const findIdx = (patterns: RegExp[]): number => {
    for (const pat of patterns) {
      const idx = lowerHeaders.findIndex((h) => pat.test(h));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  // 1. Raw Vendor SKU
  const rawIdx = findIdx([
    /^raw vendor sku/i,
    /^raw.*sku/i,
    /^vendor sku/i,
    /^vendor.*code/i,
    /^raw/i,
    /vendor.*item/i,
    /upc/i,
  ]);
  if (rawIdx >= 0) mapping.rawVendorSku = headers[rawIdx];

  // 2. Cleaned SKU
  const cleanIdx = findIdx([
    /^cleaned sku/i,
    /^cleaned/i,
    /^clean.*sku/i,
    /^pos sku/i,
    /^inventory sku/i,
    /^clean/i,
  ]);
  if (cleanIdx >= 0) {
    mapping.cleanedSku = headers[cleanIdx];
  } else {
    // If only one generic "sku" column exists and raw wasn't matched to it
    const genSkuIdx = lowerHeaders.findIndex((h) => h === "sku" || h === "item" || h === "product code");
    if (genSkuIdx >= 0 && (!mapping.rawVendorSku || headers[genSkuIdx] !== mapping.rawVendorSku)) {
      mapping.cleanedSku = headers[genSkuIdx];
    }
  }

  // 3. Discount (%)
  const discIdx = findIdx([
    /^discount\s*\(?%?\)?$/i,
    /^discount/i,
    /^disc\s*\(?%?\)?$/i,
    /^disc/i,
    /vendor discount/i,
  ]);
  if (discIdx >= 0) mapping.discount = headers[discIdx];

  // 4. Vendor List Price (New)
  const priceIdx = findIdx([
    /vendor.*list.*price/i,
    /vendor.*price/i,
    /vendor.*list/i,
    /vendor.*cost/i,
    /new.*price/i,
    /new.*cost/i,
    /new.*list/i,
    /list.*price/i,
    /list.*cost/i,
    /price/i,
    /cost/i,
  ]);
  if (priceIdx >= 0) mapping.vendorListPriceNew = headers[priceIdx];

  // 5. Margin/Divisor
  const divIdx = findIdx([
    /^margin\/divisor/i,
    /^margin divisor/i,
    /^divisor/i,
    /^margin/i,
  ]);
  if (divIdx >= 0) mapping.marginDivisor = headers[divIdx];

  // 6. Notes
  const notesIdx = findIdx([
    /^notes/i,
    /^note/i,
    /^comment/i,
    /^comments/i,
    /^remarks/i,
  ]);
  if (notesIdx >= 0) mapping.notes = headers[notesIdx];

  return mapping;
}

/** Check if the first row of tabular data looks like a header row. */
export function looksLikeHeaderRow(row: string[]): boolean {
  if (!row || !row.length) return false;
  const headerWords = ["sku", "code", "raw", "clean", "cleaned", "price", "cost", "list", "discount", "disc", "margin", "divisor", "notes", "note", "vendor", "brand", "item", "upc"];
  let score = 0;
  for (const cell of row) {
    const s = cell.toLowerCase().trim();
    if (headerWords.some((w) => s.includes(w))) score++;
    if (/^\$?\d+\.\d{2}$/.test(s)) score -= 2;
  }
  return score > 0;
}

/** Parse pasted TSV or CSV text into headers and row string arrays. */
export function parsePastedText(
  text: string,
  userHeaderOverride?: boolean,
): { headers: string[]; rows: string[][]; hasHeaderRow: boolean } {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { headers: [], rows: [], hasHeaderRow: false };

  const parsed = Papa.parse<string[]>(trimmed, {
    skipEmptyLines: "greedy",
  });

  const rawRows = (parsed.data || [])
    .map((r) => r.map((c) => String(c ?? "").trim()))
    .filter((r) => r.some((c) => c !== ""));

  if (!rawRows.length) return { headers: [], rows: [], hasHeaderRow: false };

  const detectedHeader = looksLikeHeaderRow(rawRows[0]);
  const hasHeaderRow = userHeaderOverride !== undefined ? userHeaderOverride : detectedHeader;

  if (hasHeaderRow && rawRows.length > 0) {
    const headers = rawRows[0].map((h, i) => h.trim() || `Column ${i + 1}`);
    const rows = rawRows.slice(1);
    return { headers, rows, hasHeaderRow: true };
  } else {
    const colCount = Math.max(...rawRows.map((r) => r.length), 0);
    const headers = Array.from({ length: colCount }, (_, i) => {
      const sample = rawRows[0]?.[i];
      return sample ? `Column ${i + 1} (${sample.slice(0, 15)})` : `Column ${i + 1}`;
    });
    return { headers, rows: rawRows, hasHeaderRow: false };
  }
}

/** Parse an ArrayBuffer from an Excel (.xlsx/.xls) or CSV file. */
export function parseSpreadsheetBuffer(
  buf: ArrayBuffer,
  userHeaderOverride?: boolean,
): { headers: string[]; rows: string[][]; hasHeaderRow: boolean } {
  const wb = XLSX.read(buf, { type: "array", raw: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [], hasHeaderRow: false };
  const ws = wb.Sheets[sheetName];
  if (!ws) return { headers: [], rows: [], hasHeaderRow: false };

  const rawAoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
  const rawRows = rawAoa
    .map((row) => (Array.isArray(row) ? row.map((cell) => cellText(cell)) : []))
    .filter((r) => r.some((c) => c !== ""));

  if (!rawRows.length) return { headers: [], rows: [], hasHeaderRow: false };

  const detectedHeader = looksLikeHeaderRow(rawRows[0]);
  const hasHeaderRow = userHeaderOverride !== undefined ? userHeaderOverride : detectedHeader;

  if (hasHeaderRow && rawRows.length > 0) {
    const headers = rawRows[0].map((h, i) => h.trim() || `Column ${i + 1}`);
    const rows = rawRows.slice(1);
    return { headers, rows, hasHeaderRow: true };
  } else {
    const colCount = Math.max(...rawRows.map((r) => r.length), 0);
    const headers = Array.from({ length: colCount }, (_, i) => {
      const sample = rawRows[0]?.[i];
      return sample ? `Column ${i + 1} (${sample.slice(0, 15)})` : `Column ${i + 1}`;
    });
    return { headers, rows: rawRows, hasHeaderRow: false };
  }
}

/** Apply a column mapping to tabular string rows to get typed input rows. */
export function applyColumnMapping(
  headers: string[],
  rows: string[][],
  mapping: Record<TargetColumnKey, string>,
): BulkAddInputRow[] {
  const colIndices: Partial<Record<TargetColumnKey, number>> = {};
  for (const key of Object.keys(mapping) as TargetColumnKey[]) {
    const colName = mapping[key];
    if (colName) {
      const idx = headers.indexOf(colName);
      if (idx >= 0) colIndices[key] = idx;
    }
  }

  return rows.map((r) => {
    const getVal = (k: TargetColumnKey): string => {
      const idx = colIndices[k];
      return idx !== undefined && idx < r.length ? (r[idx] ?? "").trim() : "";
    };

    return {
      rawVendorSku: getVal("rawVendorSku"),
      cleanedSku: getVal("cleanedSku"),
      discount: getVal("discount"),
      vendorListPriceNew: getVal("vendorListPriceNew"),
      marginDivisor: getVal("marginDivisor"),
      notes: getVal("notes"),
    };
  });
}

/** Generate a CSV template string matching the supported columns and example data. */
export function generateTemplateCsv(): string {
  const headers = TARGET_COLUMNS.map((c) => c.label).join(",");
  const rows = [
    ',06895801011,,9.49,,',
    '6-27765-01032-9,,,13.54,0.55,need to review',
  ];
  return `${headers}\n${rows.join("\n")}\n`;
}

/** Generate an XLSX template buffer matching the supported columns and example data. */
export function generateTemplateXlsx(): Uint8Array {
  const headers = TARGET_COLUMNS.map((c) => c.label);
  const data = [
    headers,
    ["", "06895801011", "", "9.49", "", ""],
    ["6-27765-01032-9", "", "", "13.54", "0.55", "need to review"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Bulk Add Template");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Uint8Array(buf);
}

