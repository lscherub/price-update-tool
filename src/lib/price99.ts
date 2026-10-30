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

