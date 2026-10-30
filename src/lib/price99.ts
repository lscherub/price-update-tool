import * as XLSX from "xlsx";

export type Price99Action = "CHECK" | "UNCHECK";

export type Price99Item = {
  sku: string;
  description: string;
  brand?: string;
  vendor?: string;
  productNumber?: string;
  price?: string;
  listCost?: string;
};

export type Price99BatchRecord = {
  id: string;
  batchId: string;
  action: Price99Action;
  productCount: number;
  items: Price99Item[];
  createdBy: string;
  createdAt: string;
};

/**
 * Builds an Amber POS import workbook with exactly two columns: "Sku" and "99 Price".
 * - SKUs are formatted explicitly as text strings (`t: "s"`) to preserve leading zeros.
 * - When action is CHECK, 99 Price is "Y".
 * - When action is UNCHECK, 99 Price is genuinely blank (null cell, not text "N" / "FALSE" / 0).
 */
export function buildPrice99Workbook(
  items: Array<{ sku: string }>,
  action: Price99Action
): XLSX.WorkBook {
  const aoa: unknown[][] = [
    ["Sku", "99 Price"],
    ...items.map((item) => {
      const skuCell = { t: "s", v: String(item.sku ?? "") };
      const price99Cell = action === "CHECK" ? { t: "s", v: "Y" } : null;
      return [skuCell, price99Cell];
    }),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);

  worksheet["!cols"] = [
    { wch: 20 }, // Sku
    { wch: 14 }, // 99 Price
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "99 Price Import");
  return workbook;
}

/**
 * Generates an Amber POS import filename for 99 Price.
 */
export function generatePrice99Filename(action: Price99Action, date: Date = new Date()): string {
  const dateStr = date.toISOString().slice(0, 10);
  const actionLabel = action === "CHECK" ? "Check" : "Uncheck";
  return `Amber_POS_99_Price_${actionLabel}_${dateStr}.xlsx`;
}

/**
 * Generates a readable unique batch ID.
 */
export function generateBatchId(date: Date = new Date()): string {
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `BATCH-${dateStr}-${rand}`;
}

/**
 * Calculates a match relevance rank for a product relative to a search query:
 * Tier 1: Exact SKU match
 * Tier 2: SKU starts with query
 * Tier 3: SKU contains query
 * Tier 4: Product Number exact match
 * Tier 5: Product Number starts with / contains query
 * Tier 6: Description starts with / contains query
 * Tier 7: Brand / Vendor match
 */
export function getProductMatchRank(item: Price99Item, needle: string): number {
  const sku = (item.sku || "").trim().toLowerCase();
  const normSku = (item.sku || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const cleanNeedle = needle.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const pn = (item.productNumber || "").trim().toLowerCase();
  const desc = (item.description || "").trim().toLowerCase();
  const brand = (item.brand || "").trim().toLowerCase();
  const vendor = (item.vendor || "").trim().toLowerCase();

  // Tier 1: Exact SKU match
  if (sku === needle || (cleanNeedle && normSku === cleanNeedle)) return 1;

  // Tier 2: SKU prefix match
  if (sku.startsWith(needle) || (cleanNeedle && normSku.startsWith(cleanNeedle))) return 2;

  // Tier 3: SKU substring match
  if (sku.includes(needle) || (cleanNeedle && normSku.includes(cleanNeedle))) return 3;

  // Tier 4: Product number exact match
  if (pn === needle) return 4;

  // Tier 5: Product number prefix / contains
  if (pn.startsWith(needle)) return 5;
  if (pn.includes(needle)) return 6;

  // Tier 6: Description match
  if (desc.startsWith(needle)) return 7;
  if (desc.includes(needle)) return 8;

  // Tier 7: Brand or vendor match
  if (brand.includes(needle) || vendor.includes(needle)) return 9;

  return 10;
}

/**
 * Sorts products so that:
 * 1. Exact SKU matches appear FIRST
 * 2. Partial SKU matches appear immediately after
 * 3. Description, product number, and vendor/brand matches follow
 */
export function rankProductMatches<T extends Price99Item>(rows: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;

  return [...rows].sort((a, b) => {
    const rankA = getProductMatchRank(a, needle);
    const rankB = getProductMatchRank(b, needle);
    if (rankA !== rankB) return rankA - rankB;

    // Tie-breaker: SKU length closeness to needle length, then alphabetical by SKU
    const lenDiffA = Math.abs((a.sku || "").length - needle.length);
    const lenDiffB = Math.abs((b.sku || "").length - needle.length);
    if (lenDiffA !== lenDiffB) return lenDiffA - lenDiffB;

    return (a.sku || "").localeCompare(b.sku || "");
  });
}

/**
 * Parses raw text copied from Excel or entered line by line into a clean list of unique SKUs.
 * Handles tab-separated Excel columns by extracting the first column.
 */
export function parsePastedSkus(rawText: string): string[] {
  if (!rawText) return [];
  const lines = rawText.split(/\r?\n/);
  const skus: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Excel tab-separated row: extract the first column
    let firstCol = line.split("\t")[0].trim();
    // Strip leading/trailing quotes if copied from Excel / CSV format
    firstCol = firstCol.replace(/^["']|["']$/g, "").trim();
    if (!firstCol) continue;

    const lower = firstCol.toLowerCase();
    if (
      lower === "sku" ||
      lower === "upc" ||
      lower === "item" ||
      lower === "product sku" ||
      lower === "code"
    ) {
      continue;
    }

    if (!seen.has(firstCol)) {
      seen.add(firstCol);
      skus.push(firstCol);
    }
  }

  return skus;
}


