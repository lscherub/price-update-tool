import * as XLSX from "xlsx";

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

/** Parse uploaded Excel/CSV buffer into {raw, price} using sku/price column mapping. */
export function parseVendorFile(
  buf: Buffer, filename: string, skuCol?: string, priceCol?: string
): { rows: { raw: string; price: string | null }[]; columns: string[] } {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  const columns = json.length ? Object.keys(json[0]) : [];
  const pickSku = skuCol && columns.includes(skuCol) ? skuCol : guessCol(columns, ["sku", "code", "item", "upc", "product"]);
  const pickPrice = priceCol && columns.includes(priceCol) ? priceCol : guessCol(columns, ["price", "cost", "list", "new", "amount"]);
  const rows = json
    .map((r) => ({
      raw: String(r[pickSku ?? columns[0] ?? ""] ?? "").trim(),
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

/** Parse POS inventory Excel/CSV with flexible header mapping. */
export function parseInventoryFile(buf: Buffer): {
  products: {
    sku: string; productNumber: string; description: string; vendor: string;
    brand: string; listCost: string; price: string; sizeDesc: string;
  }[];
  columns: string[];
} {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
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
    const v = r[col];
    return String(v ?? "").trim();
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

/** Parse inactive SKU list file (first column or SKU column). */
export function parseInactiveFile(buf: Buffer): string[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<unknown[]>(ws, { defval: "", header: 1 });
  const out: string[] = [];
  for (const row of json) {
    const v = String((row as unknown[])?.[0] ?? "").trim();
    if (v && !/^sku$/i.test(v)) out.push(v);
  }
  // also try named-column parse if first attempt looks like header junk
  if (!out.length) {
    const named = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    const cols = named.length ? Object.keys(named[0]) : [];
    const skuCol = cols.find((c) => /sku/i.test(c)) ?? cols[0];
    for (const r of named) {
      const v = String(r[skuCol] ?? "").trim();
      if (v) out.push(v);
    }
  }
  return out;
}
