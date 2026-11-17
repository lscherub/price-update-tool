/**
 * Ad Hoc Inventory Count Sheets - Domain Types and Pure Helpers
 *
 * This module is independent of pricing sheets, vendor discounts, and POS tools.
 * It provides types and utility functions for ad hoc count sheet management,
 * SKU parsing, duplicate detection, and filename generation.
 */

export type AdHocSheetStatus = "In Progress" | "Completed";

export interface AdHocCountItemData {
  id: string;
  sheetId: string;
  orderIndex: number;
  sku: string;
  brand: string;
  description: string;
  sizeDesc: string;
  matched: boolean;
  qqh: string;
  layway: string;
  prepaid: string;
  expiry: string;
  onTransfer: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdHocCountSheetData {
  id: string;
  name: string;
  status: AdHocSheetStatus;
  createdAt: string;
  updatedAt: string;
  items: AdHocCountItemData[];
  itemCount?: number;
}

export interface AdHocCountSheetSummary {
  id: string;
  name: string;
  status: AdHocSheetStatus;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ParsedBulkItem {
  raw: string;
  sku: string;
  brand: string;
  description: string;
  sizeDesc: string;
  matched: boolean;
  isDuplicateInList: boolean;
  isAlreadyInSheet: boolean;
  selected: boolean;
}

export const AD_HOC_TABLE_COLUMNS = [
  { key: "sku", label: "SKU/UPC", sortable: true, inventoryDerived: true },
  { key: "brand", label: "Brand", sortable: true, inventoryDerived: true },
  { key: "description", label: "Description", sortable: true, inventoryDerived: true },
  { key: "sizeDesc", label: "Size Desc.", sortable: true, inventoryDerived: true },
  { key: "qqh", label: "QQH", sortable: true, inventoryDerived: false },
  { key: "layway", label: "LAYWAY", sortable: true, inventoryDerived: false },
  { key: "prepaid", label: "PREPAID", sortable: true, inventoryDerived: false },
  { key: "expiry", label: "Expiry", sortable: true, inventoryDerived: false },
  { key: "onTransfer", label: "On Transfer", sortable: true, inventoryDerived: false },
] as const;

/**
 * Generates default count sheet name: e.g. "Inventory Count - November 16, 2026"
 */
export function defaultAdHocSheetName(date: Date = new Date()): string {
  const formatted = date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return `Inventory Count - ${formatted}`;
}

/**
 * Format a date string or Date object for UI display.
 */
export function formatAdHocDisplayDate(dateInput: string | Date): string {
  try {
    const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
    if (isNaN(d.getTime())) return String(dateInput);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(dateInput);
  }
}

/**
 * Format count date for Excel exports: e.g. "November 16, 2026"
 */
export function formatAdHocCountDate(date: Date = new Date()): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Parse multiline pasted input of UPCs/SKUs.
 *
 * Handles:
 * - Line breaks (\r\n, \n, \r)
 * - Leading and trailing whitespace
 * - Commas, tabs, semicolons from spreadsheet copy/paste
 * - Retains leading zeros (strings, NEVER converted to numbers)
 * - Filters out empty lines
 */
export function parsePastedUpcs(input: string): string[] {
  if (!input) return [];
  const lines = input.split(/[\r\n]+/);
  const result: string[] = [];

  for (const rawLine of lines) {
    // A single line might have tab or comma separated entries from a spreadsheet
    const parts = rawLine.split(/[,\t;]+/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) {
        // Retain raw string value with leading zeros intact
        result.push(trimmed);
      }
    }
  }

  return result;
}

/**
 * Detect duplicates within a pasted list and against existing sheet items.
 *
 * @param pastedList List of raw entered UPCs
 * @param existingSheetSkus Set or array of SKUs already in the current sheet
 */
export function analyzeDuplicates(
  pastedList: string[],
  existingSheetSkus: Iterable<string> | Set<string>,
): {
  normalizedEntries: Array<{
    raw: string;
    isDuplicateInList: boolean;
    isAlreadyInSheet: boolean;
  }>;
} {
  const existingSet = new Set(Array.from(existingSheetSkus).map((s) => s.trim().toLowerCase()));

  const seenInList = new Set<string>();
  const normalizedEntries = pastedList.map((raw) => {
    const key = raw.trim().toLowerCase();
    const isDuplicateInList = seenInList.has(key);
    seenInList.add(key);

    const isAlreadyInSheet = existingSet.has(key);

    return {
      raw,
      isDuplicateInList,
      isAlreadyInSheet,
    };
  });

  return { normalizedEntries };
}

/**
 * Generates safe and meaningful Excel export filename:
 * e.g. "Inventory Count - November 16, 2026 - Teams Count.xlsx"
 */
export function generateTeamsCountFilename(sheetName: string, date: Date = new Date()): string {
  let safeName = String(sheetName || "Inventory Count")
    .replace(/[/\\:]+/g, " - ")
    .replace(/[*?"<>|\x00-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.-]+|[\s.-]+$/g, "")
    .trim();

  if (!safeName) safeName = "Inventory Count";

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const dateStamp = `${y}-${m}-${d}`;

  // If the sheet name already contains the date or "Count", avoid repetitive suffixes
  if (safeName.toLowerCase().endsWith(".xlsx")) {
    return safeName;
  }

  return `${safeName} - Teams Count - ${dateStamp}.xlsx`;
}
