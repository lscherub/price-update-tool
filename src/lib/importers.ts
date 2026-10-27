import * as XLSX from "xlsx";

/** Format any Excel cell value as text without losing SKU digits (no scientific notation). */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    // Integer-like numerics: render without exponent/decimal (preserves long SKUs).
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
    // Fallback for floats: plain decimal string, trimmed.
    let s = String(v);
    if (/[eE]/.test(s)) s = v.toFixed(0);
    return s.trim();
  }
  return String(v).trim();
}

/** Parse vendor two-column paste: "SKU  price" or "SKU, price" or "SKU\tprice" per line. */
export function parsePastedVendorData(text: string): { raw: string; price: string | null }[] {
  const lines = String(text ?? "").split(/\r?\n/);
  const out: { raw: string; price: string | null }[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let parts: string[] = [];
    if (line.includes("\t")) parts = line.split("\t");
    else if (line.includes(",")) parts = line.split(",");
    else {
      const m = line.trim().match(/^(.*?)\s+([$]?[\d,]*\.?\d+)\s*$/);
      if (m) parts = [m[1], m[2]];
      else parts = [line];
    }
    const raw = (parts[0] ?? "").trim();
    const priceRaw = (parts[1] ?? "").trim().replace(/[$,]/g, "");
    if (!raw) continue;
    out.push({ raw, price: priceRaw === "" ? null : priceRaw });
  }
  return out;
}

/** Parse uploaded Excel/CSV buffer into {raw, price} using sku/price column mapping.
 * SKU text preservation: numeric Excel cells come back as numbers — format them
 * without scientific notation so leading zeroes survive (XLSX.read raw + string-safe).
 */
export function parseVendorFile(
  buf: Buffer, filename: string, skuCol?: string, priceCol?: string
): { rows: { raw: string; price: string | null }[]; columns: string[] } {
  const wb = XLSX.read(buf, { type: "buffer", raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { rows: [], columns: [] };
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
  const columns = json.length ? Object.keys(json[0]) : [];
  const pickSku = skuCol && columns.includes(skuCol) ? skuCol : guessCol(columns, ["sku", "code", "item", "upc", "product"]);
  const pickPrice = priceCol && columns.includes(priceCol) ? priceCol : guessCol(columns, ["price", "cost", "list", "new", "amount"]);
  const rows = json
    .map((r) => ({
      raw: cellText(r[pickSku ?? columns[0] ?? ""]),
      price: (() => {
        const v = String(r[pickPrice ?? columns[1] ?? ""] ?? "").trim().replace(/[$,]/g, "");
        return v === "" ? null : v;
      })(),
    }))
    .filter((r) => r.raw !== "");
  return { rows, columns };
}

function guessCol(columns: string[], hints: string[]): string | undefined {
  const lower = columns.map((c) => c.toLowerCase());
  for (const h of hints) {
    const i = lower.findIndex((c) => c.includes(h));
    if (i >= 0) return columns[i];
  }
  return columns[0];
}

export type InventoryProduct = {
  sku: string; productNumber: string; description: string; vendor: string;
  brand: string; listCost: string; price: string; sizeDesc: string;
};

/** Parse POS inventory Excel/CSV with flexible header mapping. */
export function parseInventoryFile(buf: Buffer): {
  products: InventoryProduct[];
  columns: string[];
} {
  const wb = XLSX.read(buf, { type: "buffer", raw: true });
  return inventoryProductsFromWorkbook(wb);
}

/**
 * Same parser, but for ArrayBuffer input.
 *
 * The inventory page parses the workbook in the browser and then uploads small
 * JSON batches, so a 20,000-row file never has to survive one multi-megabyte
 * serverless upload (and is never processed inside a single request).
 */
export function parseInventoryArrayBuffer(data: ArrayBuffer): {
  products: InventoryProduct[];
  columns: string[];
} {
  const wb = XLSX.read(data, { type: "array", raw: true });
  return inventoryProductsFromWorkbook(wb);
}

function inventoryProductsFromWorkbook(wb: XLSX.WorkBook): {
  products: InventoryProduct[];
  columns: string[];
} {
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { products: [], columns: [] };
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
  const columns = json.length ? Object.keys(json[0]) : [];
  const find = (hints: string[]): string | undefined => {
    const lower = columns.map((c) => c.toLowerCase().replace(/[^a-z]/g, ""));
    for (const h of hints) {
      const i = lower.findIndex((c) => c.includes(h));
      if (i >= 0) return columns[i];
    }
    return undefined;
  };
  const cSku = find(["sku"]) ?? columns[0];
  const cNum = find(["productnumber", "itemnumber", "productno", "itemno"]);
  const cDesc = find(["description", "productname", "name"]);
  const cVendor = find(["vendor", "supplier"]);
  const cBrand = find(["brand"]);
  const cCost = find(["listcost", "cost", "currentlist"]);
  const cPrice = find(["price", "retail", "sell"]);
  const cSize = find(["sizedesc", "size", "pack"]);
  const cell = (col: string | undefined, r: Record<string, unknown>): string => {
    if (!col) return "";
    return cellText(r[col]);
  };
  const products = json
    .map((r) => ({
      sku: cell(cSku, r),
      productNumber: cell(cNum, r),
      description: cell(cDesc, r),
      vendor: cell(cVendor, r),
      brand: cell(cBrand, r),
      listCost: cell(cCost, r).replace(/[$,]/g, "") || "0",
      price: cell(cPrice, r).replace(/[$,]/g, "") || "0",
      sizeDesc: cell(cSize, r),
    }))
    .filter((p) => p.sku !== "");
  return { products, columns };
}

/** A single bulk-add row: the 6 columns the Bulk Add Rows feature accepts. */
export type BulkRow = {
  rawVendorSku: string;
  cleanedSku: string;
  discount: string;
  vendorListPriceNew: string;
  marginDivisor: string;
  notes: string;
};

/**
 * Parse tab/comma-separated paste from Excel into the 6 bulk-add columns.
 * Excel copy is tab-delimited (one line per row); commas are tolerated only
 * when no tabs are present (extra cells are folded back into Notes).
 */
export function parseBulkPaste(text: string): BulkRow[] {
  const lines = String(text ?? "").split(/\r?\n/);
  const out: BulkRow[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());
    if (cells.every((c) => c === "")) continue;
    while (cells.length < 6) cells.push("");
    out.push({
      rawVendorSku: cells[0] ?? "",
      cleanedSku: cells[1] ?? "",
      discount: cells[2] ?? "",
      vendorListPriceNew: cells[3] ?? "",
      marginDivisor: cells[4] ?? "",
      notes: cells.slice(5).join(cells.length > 6 ? "," : "").trim(),
    });
  }
  return out;
}

/**
 * Mapping from a header hint to the BulkRow field it fills. The first matching
 * column wins, so order matters (e.g. "raw" must beat a bare "sku" so the
 * "Raw Vendor SKU/Code" header does not collide with "Cleaned SKU").
 */
type BulkHeaderMap = {
  raw?: string; cleanedSku?: string; discount?: string;
  vendorListPriceNew?: string; marginDivisor?: string; notes?: string;
};
function mapBulkHeaders(columns: string[]): BulkHeaderMap {
  const lower = columns.map((c) => c.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const find = (hints: string[]): string | undefined => {
    for (const h of hints) {
      const i = lower.findIndex((c) => c.includes(h));
      if (i >= 0) return columns[i];
    }
    return undefined;
  };
  return {
    // "raw" first so "raw vendor sku/code" wins over a generic "sku"/"code".
    // "clean" is distinct from "raw", so "cleaned sku" maps only to cleanedSku.
    raw: find(["raw", "vendorsku", "vendorcode", "sku", "code", "item", "upc", "product"]),
    cleanedSku: find(["cleanedsku", "cleansku", "clean"]),
    discount: find(["discount", "disc"]),
    vendorListPriceNew: find(["vendorlistprice", "vendorelistprice", "newprice", "newretail", "listprice", "listcost", "cost", "price"]),
    marginDivisor: find(["divisor", "margin", "marginordivisor"]),
    notes: find(["note", "comment", "remarks"]),
  };
}

/** Parse an uploaded Excel/CSV buffer into the 6 bulk-add columns (header-mapped). */
export function parseBulkFile(buf: Buffer, filename: string): BulkRow[] {
  const wb = XLSX.read(buf, { type: "buffer", raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
  const columns = json.length ? Object.keys(json[0]) : [];
  const map = mapBulkHeaders(columns);
  const get = (col: string | undefined, r: Record<string, unknown>): string => (col ? cellText(r[col]) : "");
  return json
    .map((r) => ({
      rawVendorSku: get(map.raw, r),
      cleanedSku: get(map.cleanedSku, r),
      discount: get(map.discount, r),
      vendorListPriceNew: get(map.vendorListPriceNew, r),
      marginDivisor: get(map.marginDivisor, r),
      notes: get(map.notes, r),
    }))
    .filter((r) => r.rawVendorSku !== "" || r.cleanedSku !== "");
}

/** Parse inactive SKU list file (first column or SKU column). */
export function parseInactiveFile(buf: Buffer): string[] {
  const wb = XLSX.read(buf, { type: "buffer", raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const json = XLSX.utils.sheet_to_json<unknown[]>(ws, { defval: "", header: 1, raw: true });
  const out: string[] = [];
  for (const row of json) {
    const v = cellText((row as unknown[])?.[0] ?? "");
    if (v && !/^sku$/i.test(v)) out.push(v);
  }
  // also try named-column parse if first attempt looks like header junk
  if (!out.length) {
    const named = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
    const cols = named.length ? Object.keys(named[0]) : [];
    const skuCol = cols.find((c) => /sku/i.test(c)) ?? cols[0];
    for (const r of named) {
      const v = cellText(r[skuCol] ?? "");
      if (v) out.push(v);
    }
  }
  return out;
}
