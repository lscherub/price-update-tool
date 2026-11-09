import { fullVendorEffectivePrice } from "@/lib/fullVendorExcel";
import { storeCountNewPrice } from "@/lib/storeCountPricing";

export type PosExportMode = "all" | "all-populate" | "changed" | "selected";

export type PosExportInputRow = {
  id: string;
  cleanedSku?: string | null;
  ourNewListPrice?: string | null;
  nearest9?: string | null;
  oldRetailPrice?: string | null;
  isInactive?: boolean;
};

export type PosCsvRow = {
  cleanedSku: string;
  ourNewListPrice: string | null;
  nearest9: string | null;
};

/**
 * Returns true if the product has an effective price change
 * (nearest9 differs from oldRetailPrice).
 */
export function hasPriceChange(
  nearest9: string | null | undefined,
  oldRetailPrice: string | null | undefined,
): boolean {
  const diff = storeCountNewPrice(nearest9 ?? null, oldRetailPrice ?? null);
  return Boolean(diff && diff.trim() !== "");
}

/**
 * Filter and map worksheet rows for Full Vendor POS CSV export.
 * Pure function: does not modify input rows.
 */
export function filterAndMapPosRows(
  rows: PosExportInputRow[],
  options: {
    mode: PosExportMode;
    selectedIds?: Iterable<string>;
  },
): PosCsvRow[] {
  const { mode, selectedIds } = options;
  const selectedSet = selectedIds ? new Set(selectedIds) : new Set<string>();

  // 1. Initial filter based on mode
  let filtered: PosExportInputRow[] = [];
  if (mode === "selected") {
    filtered = rows.filter((r) => selectedSet.has(r.id));
  } else if (mode === "changed") {
    filtered = rows.filter((r) => hasPriceChange(r.nearest9, r.oldRetailPrice));
  } else {
    // "all" and "all-populate"
    filtered = rows;
  }

  // 2. Deduplicate worksheet records (first occurrence wins)
  const seen = new Set<string>();
  const result: PosCsvRow[] = [];

  for (const r of filtered) {
    const sku = String(r.cleanedSku ?? "").trim();
    if (!sku) continue; // POS export requires Cleaned SKU
    const key = sku || r.id;
    if (seen.has(key)) continue;
    seen.add(key);

    let finalNearest9: string | null = null;
    if (mode === "all-populate") {
      const eff = fullVendorEffectivePrice(r.nearest9, r.oldRetailPrice, "all");
      finalNearest9 = eff ? eff : null;
    } else {
      // "all", "changed", "selected" preserve existing representation of nearest9
      finalNearest9 =
        r.nearest9 !== null && r.nearest9 !== undefined && String(r.nearest9).trim() !== ""
          ? String(r.nearest9).trim()
          : null;
    }

    result.push({
      cleanedSku: sku,
      ourNewListPrice: r.ourNewListPrice ?? null,
      nearest9: finalNearest9,
    });
  }

  return result;
}

/**
 * Computes summary count statistics for the export confirmation dialog.
 */
export function computePosExportSummary(
  rows: PosExportInputRow[],
  mode: PosExportMode,
  selectedIds?: Iterable<string>,
): {
  includedCount: number;
  excludedCount: number;
  totalCount: number;
} {
  const totalCount = rows.length;
  if (mode === "all" || mode === "all-populate") {
    return {
      totalCount,
      includedCount: totalCount,
      excludedCount: 0,
    };
  }
  if (mode === "changed") {
    let changed = 0;
    for (const r of rows) {
      if (hasPriceChange(r.nearest9, r.oldRetailPrice)) {
        changed++;
      }
    }
    return {
      totalCount,
      includedCount: changed,
      excludedCount: Math.max(0, totalCount - changed),
    };
  }
  // mode === "selected"
  const selectedSet = selectedIds ? new Set(selectedIds) : new Set<string>();
  let selectedCount = 0;
  for (const r of rows) {
    if (selectedSet.has(r.id)) {
      selectedCount++;
    }
  }
  return {
    totalCount,
    includedCount: selectedCount,
    excludedCount: Math.max(0, totalCount - selectedCount),
  };
}
