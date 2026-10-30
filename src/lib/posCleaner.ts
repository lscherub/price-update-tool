import * as XLSX from "xlsx";

export const POS_OUTPUT_COLUMNS = [
  "Sku",
  "Product Number",
  "Description",
  "Vendor",
  "Brand",
  "List Cost",
  "Price",
  "Size Desc",
] as const;

export type PosOutputColumn = (typeof POS_OUTPUT_COLUMNS)[number];

export type HeaderInfo = {
  index: number;
  headers: string[];
};

export type PosExtractionResult = {
  success: boolean;
  error?: string;
  headerIndex?: number;
  foundColumns: Record<string, number>;
  missingColumns: string[];
  rows: Array<Record<string, string>>;
  totalProducts: number;
};

export function normalizePosHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function findPosHeaderRow(matrix: unknown[][]): HeaderInfo | null {
  const maxRows = Math.min(matrix.length, 15);

  for (let r = 0; r < maxRows; r++) {
    const row = matrix[r] || [];
    const normalized = row.map(normalizePosHeader);
    const hasSku = normalized.some((v) => v === "sku");
    const hasDescription = normalized.some((v) => v === "description");

    if (hasSku && hasDescription) {
      return { index: r, headers: row.map((cell) => String(cell ?? "")) };
    }
  }
  return null;
}

export function formatPosCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

/**
 * Validates and extracts the 8 required POS columns from a raw matrix.
 */
export function validateAndExtractPosRows(matrix: unknown[][]): PosExtractionResult {
  if (!matrix || matrix.length === 0) {
    return {
      success: false,
      error: "The file is empty.",
      foundColumns: {},
      missingColumns: [...POS_OUTPUT_COLUMNS],
      rows: [],
      totalProducts: 0,
    };
  }

  const headerInfo = findPosHeaderRow(matrix);
  if (!headerInfo) {
    return {
      success: false,
      error: "Could not find the POS header row. A row containing “Sku” and “Description” is required within the first 15 rows.",
      foundColumns: {},
      missingColumns: [...POS_OUTPUT_COLUMNS],
      rows: [],
      totalProducts: 0,
    };
  }

  const { index: headerIndex, headers } = headerInfo;
  const normalizedHeaders = headers.map(normalizePosHeader);

  const foundColumns: Record<string, number> = {};
  POS_OUTPUT_COLUMNS.forEach((col) => {
    const wanted = normalizePosHeader(col);
    const idx = normalizedHeaders.findIndex((h) => h === wanted);
    foundColumns[col] = idx;
  });

  const missingColumns = POS_OUTPUT_COLUMNS.filter((col) => foundColumns[col] === -1);

  if (missingColumns.length > 0) {
    return {
      success: false,
      error: `Required column(s) missing: ${missingColumns.join(", ")}`,
      headerIndex,
      foundColumns,
      missingColumns,
      rows: [],
      totalProducts: 0,
    };
  }

  const dataRows = matrix.slice(headerIndex + 1);

  const cleanedRows: Array<Record<string, string>> = dataRows
    .map((row) => {
      const output: Record<string, string> = {};
      POS_OUTPUT_COLUMNS.forEach((col) => {
        const colIdx = foundColumns[col];
        output[col] = formatPosCellValue(row[colIdx]);
      });
      return output;
    })
    .filter((row) => Object.values(row).some((v) => v !== ""));

  if (cleanedRows.length === 0) {
    return {
      success: false,
      error: "The file contains the correct columns, but no product rows were found.",
      headerIndex,
      foundColumns,
      missingColumns: [],
      rows: [],
      totalProducts: 0,
    };
  }

  return {
    success: true,
    headerIndex,
    foundColumns,
    missingColumns: [],
    rows: cleanedRows,
    totalProducts: cleanedRows.length,
  };
}

/**
 * Builds a clean SheetJS workbook containing only the 8 required columns.
 */
export function buildCleanedPosWorkbook(rows: Array<Record<string, string>>): XLSX.WorkBook {
  const aoa: unknown[][] = [
    [...POS_OUTPUT_COLUMNS],
    ...rows.map((row) => POS_OUTPUT_COLUMNS.map((col) => row[col] ?? "")),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);

  worksheet["!cols"] = [
    { wch: 16 }, // Sku
    { wch: 18 }, // Product Number
    { wch: 42 }, // Description
    { wch: 24 }, // Vendor
    { wch: 16 }, // Brand
    { wch: 13 }, // List Cost
    { wch: 13 }, // Price
    { wch: 14 }, // Size Desc
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Cleaned POS");
  return workbook;
}

/**
 * Generates the download filename: [originalName]_Cleaned_YYYY-MM-DD.xlsx
 */
export function generateCleanedPosFilename(originalFileName: string, date: Date = new Date()): string {
  const dateStr = date.toISOString().slice(0, 10);
  const base = (originalFileName || "Genesis_POS")
    .replace(/\.(xlsx|xls|csv)$/i, "")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "");

  return `${base || "Genesis_POS"}_Cleaned_${dateStr}.xlsx`;
}

