import * as XLSX from "xlsx";

/**
 * Derives the Store Count PDF's "New Price" column from the row's Nearest 9
 * and Old Retail Price:
 * - If Nearest 9 is empty, blank.
 * - If Nearest 9 is numerically equal to Old Retail Price (or matches after
 *   trimming, when one isn't a finite number), blank — there is no price change.
 * - Otherwise the formatted new retail price (`nearest9`).
 * - If there is no Nearest 9 stored, the cell stays blank.
 * This uses the existing row data only; it performs no new pricing calculation.
 */
export function storeCountNewPrice(
  nearest9: string | { toString(): string } | null | undefined,
  oldRetailPrice: string | { toString(): string } | null | undefined,
): string {
  const n9 = nearest9 === null || nearest9 === undefined ? "" : String(nearest9).trim();
  if (!n9) return "";
  const old = oldRetailPrice === null || oldRetailPrice === undefined ? "" : String(oldRetailPrice).trim();
  if (!old) return n9;
  const a = Number(n9);
  const b = Number(old);
  if (Number.isFinite(a) && Number.isFinite(b)) return a === b ? "" : n9;
  return n9 === old ? "" : n9;
}

/** Store Count Excel worksheet columns (same 7 columns as the PDF/CSV sheet). */
export const STORE_COUNT_EXCEL_HEADER = [
  "SKU", "Description", "Size Desc.", "New Price", "QOH", "Expiry", "Notes",
] as const;

/**
 * Store Count Excel "New Price" rule — deliberately different from the PDF.
 * The PDF blanks unchanged prices; the Excel sheet must always carry a price:
 * - Nearest 9 present and different from Old Retail -> the new retail price.
 * - Nearest 9 equals Old Retail (or is missing) -> the current retail price.
 * - Neither available -> blank (nothing to show for that row).
 * Pure: no pricing calculation, only selection between stored values.
 */
export function storeCountExcelPrice(
  nearest9: string | { toString(): string } | null | undefined,
  oldRetailPrice: string | { toString(): string } | null | undefined,
): string {
  const n9 = nearest9 === null || nearest9 === undefined ? "" : String(nearest9).trim();
  const old = oldRetailPrice === null || oldRetailPrice === undefined ? "" : String(oldRetailPrice).trim();
  if (n9) {
    if (!old) return n9;
    const a = Number(n9);
    const b = Number(old);
    const same = Number.isFinite(a) && Number.isFinite(b) ? a === b : n9 === old;
    return same ? old : n9;
  }
  return old;
}

export type StoreCountExcelRow = {
  cleanedSku: string;
  productName: string;
  sizeDesc: string;
  price: string;
};

/** Build the .xlsx workbook buffer (proper workbook, not renamed CSV). */
export function buildStoreCountWorkbook(rows: StoreCountExcelRow[]): Buffer {
  const aoa: string[][] = [
    [...STORE_COUNT_EXCEL_HEADER],
    ...rows.map((r) => [r.cleanedSku, r.productName, r.sizeDesc, r.price, "", "", ""]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 18 }, { wch: 48 }, { wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 24 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Store Count");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

