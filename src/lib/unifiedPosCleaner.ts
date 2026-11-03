import * as XLSX from "xlsx";
import { cellText } from "./importers";
import { parseAmount } from "./inventoryImport";

export const UNIFIED_POS_REQUIRED_FIELDS = [
  "sku",
  "productNumber",
  "description",
  "vendor",
  "brand",
  "listCost",
  "price",
  "sizeDesc",
  "inactive",
] as const;

export type UnifiedPosFieldKey = (typeof UNIFIED_POS_REQUIRED_FIELDS)[number];

export const UNIFIED_FIELD_DISPLAY_NAMES: Record<UnifiedPosFieldKey, string> = {
  sku: "Sku",
  productNumber: "Product Number",
  description: "Description",
  vendor: "Vendor",
  brand: "Brand",
  listCost: "List Cost",
  price: "Price",
  sizeDesc: "Size Desc",
  inactive: "INACTIVE",
};

/**
 * Normalizes header strings for flexible, resilient matching.
 * Handles variations in punctuation (e.g. "Size Desc." vs "Size Desc"),
 * whitespace, hyphens, underscores, and casing.
 */
export function normalizeHeaderString(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .toLowerCase()
    .replace(/[._\-#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Recognized header aliases for each required field */
export const FIELD_HEADER_ALIASES: Record<UnifiedPosFieldKey, string[]> = {
  sku: ["sku", "item sku", "item code", "upc", "product code"],
  productNumber: [
    "product number",
    "product no",
    "product num",
    "product",
    "item number",
    "item no",
    "item num",
  ],
  description: [
    "description",
    "desc",
    "product name",
    "item description",
    "item desc",
    "item name",
  ],
  vendor: ["vendor", "supplier", "vendor name"],
  brand: ["brand", "brand name"],
  listCost: ["list cost", "listcost", "cost", "current list cost", "current list", "unit cost"],
  price: ["price", "retail price", "retail", "sell price", "unit price"],
  sizeDesc: ["size desc", "sizedesc", "size", "size description", "pack size", "pack"],
  inactive: ["inactive", "is inactive", "status"],
};

/**
 * Checks whether an INACTIVE cell represents an Inactive product.
 * Per specification:
 * - Case-insensitive comparison for "Y"
 * - Surrounding whitespace trimmed
 * - Only "Y" (e.g. "Y", "y", " Y ") maps to Inactive (isInactive = true)
 * - Blank, "N", "0", "YES", or any other value maps to Active (isInactive = false)
 */
export function parsePosInactive(raw: unknown): { isInactive: boolean; status: "Active" | "Inactive" } {
  const trimmed = String(raw ?? "").trim().toUpperCase();
  const isInactive = trimmed === "Y";
  return {
    isInactive,
    status: isInactive ? "Inactive" : "Active",
  };
}

export type HeaderMatchResult = {
  headerIndex: number;
  colIndexMap: Record<UnifiedPosFieldKey, number>;
  matchedHeaderNames: Record<UnifiedPosFieldKey, string>;
  missingFields: UnifiedPosFieldKey[];
};

/**
 * Inspects a matrix of sheet rows to locate the header row and map the 9 required fields.
 * Scans the first 25 rows to detect the actual header row (ignoring titles or empty Column A).
 */
export function findUnifiedPosHeaders(matrix: unknown[][]): HeaderMatchResult | null {
  const maxScanRows = Math.min(matrix.length, 25);
  let bestHeaderIndex = -1;
  let bestColIndexMap: Record<UnifiedPosFieldKey, number> | null = null;
  let bestMatchedNames: Record<UnifiedPosFieldKey, string> | null = null;
  let bestScore = -1;

  for (let r = 0; r < maxScanRows; r++) {
    const row = matrix[r] || [];
    const normalizedCells = row.map(normalizeHeaderString);

    const colIndexMap: Record<UnifiedPosFieldKey, number> = {
      sku: -1,
      productNumber: -1,
      description: -1,
      vendor: -1,
      brand: -1,
      listCost: -1,
      price: -1,
      sizeDesc: -1,
      inactive: -1,
    };
    const matchedNames: Record<UnifiedPosFieldKey, string> = {
      sku: "",
      productNumber: "",
      description: "",
      vendor: "",
      brand: "",
      listCost: "",
      price: "",
      sizeDesc: "",
      inactive: "",
    };

    let score = 0;
    for (const key of UNIFIED_POS_REQUIRED_FIELDS) {
      const aliases = FIELD_HEADER_ALIASES[key];
      for (const alias of aliases) {
        const foundIdx = normalizedCells.findIndex((cell) => cell === alias);
        if (foundIdx !== -1) {
          colIndexMap[key] = foundIdx;
          matchedNames[key] = String(row[foundIdx] ?? "").trim();
          score++;
          break;
        }
      }
    }

    // A valid header row must at least contain SKU and Description
    if (colIndexMap.sku !== -1 && colIndexMap.description !== -1 && score > bestScore) {
      bestScore = score;
      bestHeaderIndex = r;
      bestColIndexMap = colIndexMap;
      bestMatchedNames = matchedNames;
      if (score === UNIFIED_POS_REQUIRED_FIELDS.length) {
        break; // matched all 9 fields
      }
    }
  }

  if (bestHeaderIndex === -1 || !bestColIndexMap || !bestMatchedNames) {
    return null;
  }

  const missingFields = UNIFIED_POS_REQUIRED_FIELDS.filter(
    (key) => bestColIndexMap![key] === -1
  );

  return {
    headerIndex: bestHeaderIndex,
    colIndexMap: bestColIndexMap,
    matchedHeaderNames: bestMatchedNames,
    missingFields,
  };
}

export type UnifiedProductRecord = {
  rawRowNumber: number; // 1-based sheet row number
  sku: string;
  productNumber: string;
  description: string;
  vendor: string;
  brand: string;
  listCost: string;
  price: string;
  sizeDesc: string;
  isInactive: boolean;
  status: "Active" | "Inactive";
  isDuplicate?: boolean;
  validationError?: string;
};

export type UnifiedPosCleaningResult = {
  success: boolean;
  error?: string;
  headerIndex?: number;
  missingColumns: string[];
  matchedColumns: Record<string, string>;
  records: UnifiedProductRecord[];
  totalRecords: number;
  activeCount: number;
  inactiveCount: number;
  duplicateCount: number;
  invalidCount: number;
  emptyRowsRemoved: number;
};

/**
 * Cleans and validates raw POS spreadsheet matrix into the 9 normalized inventory fields.
 * - Detects header row dynamically (ignoring empty column A and non-header rows)
 * - Automatically discards the empty second row and empty/spacer rows
 * - Preserves SKU and product numbers as strings with leading zeros
 * - Formats List Cost and Price safely
 * - Translates INACTIVE into Active/Inactive status
 * - Detects duplicate SKUs and flags them for visibility
 */
export function cleanUnifiedPosMatrix(matrix: unknown[][]): UnifiedPosCleaningResult {
  if (!matrix || matrix.length === 0) {
    return {
      success: false,
      error: "The uploaded file is empty.",
      missingColumns: UNIFIED_POS_REQUIRED_FIELDS.map((k) => UNIFIED_FIELD_DISPLAY_NAMES[k]),
      matchedColumns: {},
      records: [],
      totalRecords: 0,
      activeCount: 0,
      inactiveCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
      emptyRowsRemoved: 0,
    };
  }

  const headerResult = findUnifiedPosHeaders(matrix);
  if (!headerResult) {
    return {
      success: false,
      error:
        "Could not detect POS header row. A row containing “Sku” and “Description” is required within the first 25 rows.",
      missingColumns: UNIFIED_POS_REQUIRED_FIELDS.map((k) => UNIFIED_FIELD_DISPLAY_NAMES[k]),
      matchedColumns: {},
      records: [],
      totalRecords: 0,
      activeCount: 0,
      inactiveCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
      emptyRowsRemoved: 0,
    };
  }

  if (headerResult.missingFields.length > 0) {
    const missingNames = headerResult.missingFields.map(
      (k) => UNIFIED_FIELD_DISPLAY_NAMES[k]
    );
    return {
      success: false,
      error: `Required column(s) missing from file: ${missingNames.join(", ")}`,
      headerIndex: headerResult.headerIndex,
      missingColumns: missingNames,
      matchedColumns: headerResult.matchedHeaderNames,
      records: [],
      totalRecords: 0,
      activeCount: 0,
      inactiveCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
      emptyRowsRemoved: 0,
    };
  }

  const { headerIndex, colIndexMap, matchedHeaderNames } = headerResult;
  const rawDataRows = matrix.slice(headerIndex + 1);

  const records: UnifiedProductRecord[] = [];
  const skuSeen = new Map<string, number>(); // sku -> count of occurrences
  let activeCount = 0;
  let inactiveCount = 0;
  let invalidCount = 0;
  let emptyRowsRemoved = 0;

  for (let i = 0; i < rawDataRows.length; i++) {
    const rawRow = rawDataRows[i] || [];
    const sheetRowNumber = headerIndex + 2 + i; // 1-based row number in spreadsheet

    // Check if entire row is empty or only whitespace
    const hasAnyContent = rawRow.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== "");
    if (!hasAnyContent) {
      emptyRowsRemoved++;
      continue;
    }

    const rawSku = cellText(rawRow[colIndexMap.sku]);
    // If SKU is empty, check if it is the empty second row or an invalid row
    if (!rawSku) {
      // Check if all other 8 fields are empty
      const otherFieldsEmpty = (
        ["productNumber", "description", "vendor", "brand", "listCost", "price", "sizeDesc", "inactive"] as const
      ).every((key) => {
        const val = rawRow[colIndexMap[key]];
        return val === null || val === undefined || String(val).trim() === "";
      });
      if (otherFieldsEmpty) {
        // Completely empty spacer row (e.g. empty second row)
        emptyRowsRemoved++;
        continue;
      }
      // Row had data but missing SKU: flag as invalid
      invalidCount++;
      continue;
    }

    const productNumber = cellText(rawRow[colIndexMap.productNumber]);
    const description = cellText(rawRow[colIndexMap.description]);
    const vendor = cellText(rawRow[colIndexMap.vendor]);
    const brand = cellText(rawRow[colIndexMap.brand]);
    const rawCost = rawRow[colIndexMap.listCost];
    const rawPrice = rawRow[colIndexMap.price];
    const sizeDesc = cellText(rawRow[colIndexMap.sizeDesc]);
    const rawInactive = rawRow[colIndexMap.inactive];

    // Parse numeric fields safely
    const parsedCost = parseAmount(rawCost, "List Cost");
    const parsedPrice = parseAmount(rawPrice, "Price");
    let validationError: string | undefined;

    if (!parsedCost.ok) {
      validationError = parsedCost.reason;
    } else if (!parsedPrice.ok) {
      validationError = parsedPrice.reason;
    }

    const { isInactive, status } = parsePosInactive(rawInactive);
    if (isInactive) inactiveCount++;
    else activeCount++;

    const seenCount = (skuSeen.get(rawSku) || 0) + 1;
    skuSeen.set(rawSku, seenCount);

    const record: UnifiedProductRecord = {
      rawRowNumber: sheetRowNumber,
      sku: rawSku,
      productNumber,
      description,
      vendor,
      brand,
      listCost: parsedCost.ok ? parsedCost.value : "0.00",
      price: parsedPrice.ok ? parsedPrice.value : "0.00",
      sizeDesc,
      isInactive,
      status,
      isDuplicate: seenCount > 1,
      validationError,
    };

    if (validationError) {
      invalidCount++;
    }

    records.push(record);
  }

  // Update duplicate flags for first occurrences if SKU appeared multiple times
  let duplicateCount = 0;
  for (const record of records) {
    if ((skuSeen.get(record.sku) || 0) > 1) {
      record.isDuplicate = true;
      duplicateCount++;
    }
  }

  if (records.length === 0) {
    return {
      success: false,
      error: "The file contains valid headers, but no product records were found.",
      headerIndex,
      missingColumns: [],
      matchedColumns: matchedHeaderNames,
      records: [],
      totalRecords: 0,
      activeCount: 0,
      inactiveCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
      emptyRowsRemoved,
    };
  }

  return {
    success: true,
    headerIndex,
    missingColumns: [],
    matchedColumns: matchedHeaderNames,
    records,
    totalRecords: records.length,
    activeCount,
    inactiveCount,
    duplicateCount,
    invalidCount,
    emptyRowsRemoved,
  };
}

/**
 * Parses an Excel or CSV file buffer / ArrayBuffer using client-side SheetJS,
 * and executes cleanUnifiedPosMatrix.
 */
export function parseAndCleanUnifiedPosFile(data: ArrayBuffer | Buffer): UnifiedPosCleaningResult {
  try {
    const workbook = XLSX.read(data, {
      type: data instanceof Buffer ? "buffer" : "array",
      cellDates: true,
      raw: false,
    });

    if (!workbook.SheetNames || !workbook.SheetNames.length) {
      return {
        success: false,
        error: "The workbook does not contain any worksheets.",
        missingColumns: UNIFIED_POS_REQUIRED_FIELDS.map((k) => UNIFIED_FIELD_DISPLAY_NAMES[k]),
        matchedColumns: {},
        records: [],
        totalRecords: 0,
        activeCount: 0,
        inactiveCount: 0,
        duplicateCount: 0,
        invalidCount: 0,
        emptyRowsRemoved: 0,
      };
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });

    return cleanUnifiedPosMatrix(matrix);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to parse workbook.";
    return {
      success: false,
      error: `Could not read spreadsheet: ${msg}`,
      missingColumns: UNIFIED_POS_REQUIRED_FIELDS.map((k) => UNIFIED_FIELD_DISPLAY_NAMES[k]),
      matchedColumns: {},
      records: [],
      totalRecords: 0,
      activeCount: 0,
      inactiveCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
      emptyRowsRemoved: 0,
    };
  }
}
