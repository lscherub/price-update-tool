import { describe, it, expect } from "vitest";
import {
  filterAndMapPosRows,
  computePosExportSummary,
  hasPriceChange,
  type PosExportInputRow,
} from "@/lib/fullVendorPosExport";

describe("fullVendorPosExport", () => {
  const sampleRows: PosExportInputRow[] = [
    {
      id: "row-1",
      cleanedSku: "SKU001",
      ourNewListPrice: "10.00",
      nearest9: "19.99",
      oldRetailPrice: "14.99",
      isInactive: false,
    }, // Changed price
    {
      id: "row-2",
      cleanedSku: "SKU002",
      ourNewListPrice: null,
      nearest9: "25.00",
      oldRetailPrice: "25.00",
      isInactive: false,
    }, // Unchanged price (nearest9 == oldRetailPrice)
    {
      id: "row-3",
      cleanedSku: "SKU003",
      ourNewListPrice: null,
      nearest9: null,
      oldRetailPrice: "39.99",
      isInactive: false,
    }, // Empty New Price
    {
      id: "row-4",
      cleanedSku: "SKU004",
      ourNewListPrice: "15.00",
      nearest9: "29.99",
      oldRetailPrice: "24.99",
      isInactive: true,
    }, // Inactive product with changed price
    {
      id: "row-5",
      cleanedSku: "MANUAL-SKU-99",
      ourNewListPrice: "5.00",
      nearest9: "9.99",
      oldRetailPrice: "7.99",
      isInactive: false,
    }, // Product with manual SKU flag
    {
      id: "row-6",
      cleanedSku: "SKU006",
      ourNewListPrice: null,
      nearest9: "",
      oldRetailPrice: "49.99",
      isInactive: true,
    }, // Inactive product with empty New Price
  ];

  describe("hasPriceChange", () => {
    it("detects when price differs", () => {
      expect(hasPriceChange("19.99", "14.99")).toBe(true);
      expect(hasPriceChange("19.99", null)).toBe(true);
      expect(hasPriceChange("19.99", "")).toBe(true);
    });

    it("detects when price is unchanged or empty", () => {
      expect(hasPriceChange("25.00", "25.00")).toBe(false);
      expect(hasPriceChange("25", "25.00")).toBe(false);
      expect(hasPriceChange(null, "39.99")).toBe(false);
      expect(hasPriceChange("", "39.99")).toBe(false);
      expect(hasPriceChange(null, null)).toBe(false);
    });
  });

  describe("Option 1: Export All Products", () => {
    it("exports every product including products with empty New Price and preserves empty price behavior", () => {
      const result = filterAndMapPosRows(sampleRows, { mode: "all" });

      expect(result).toHaveLength(6);
      expect(result.map((r) => r.cleanedSku)).toEqual([
        "SKU001",
        "SKU002",
        "SKU003",
        "SKU004",
        "MANUAL-SKU-99",
        "SKU006",
      ]);

      // Changed price has new price
      expect(result.find((r) => r.cleanedSku === "SKU001")?.nearest9).toBe("19.99");
      // Unchanged price has existing nearest9
      expect(result.find((r) => r.cleanedSku === "SKU002")?.nearest9).toBe("25.00");
      // Empty new prices are preserved as null
      expect(result.find((r) => r.cleanedSku === "SKU003")?.nearest9).toBeNull();
      expect(result.find((r) => r.cleanedSku === "SKU006")?.nearest9).toBeNull();
      // Inactive product is included
      expect(result.find((r) => r.cleanedSku === "SKU004")?.nearest9).toBe("29.99");
      // Manual SKU product is included
      expect(result.find((r) => r.cleanedSku === "MANUAL-SKU-99")?.nearest9).toBe("9.99");
    });
  });

  describe("Option 2: Export All Products — Populate All Prices", () => {
    it("exports every product and populates all prices with effective retail price", () => {
      const result = filterAndMapPosRows(sampleRows, { mode: "all-populate" });

      expect(result).toHaveLength(6);
      expect(result.map((r) => r.cleanedSku)).toEqual([
        "SKU001",
        "SKU002",
        "SKU003",
        "SKU004",
        "MANUAL-SKU-99",
        "SKU006",
      ]);

      // Changed price uses nearest9
      expect(result.find((r) => r.cleanedSku === "SKU001")?.nearest9).toBe("19.99");
      // Unchanged price uses nearest9
      expect(result.find((r) => r.cleanedSku === "SKU002")?.nearest9).toBe("25.00");
      // Empty New Price products are populated with original retail price!
      expect(result.find((r) => r.cleanedSku === "SKU003")?.nearest9).toBe("39.99");
      expect(result.find((r) => r.cleanedSku === "SKU006")?.nearest9).toBe("49.99");
      // Inactive and manual SKU rows are populated
      expect(result.find((r) => r.cleanedSku === "SKU004")?.nearest9).toBe("29.99");
      expect(result.find((r) => r.cleanedSku === "MANUAL-SKU-99")?.nearest9).toBe("9.99");
    });
  });

  describe("Option 3: Export Products with Price Changes Only", () => {
    it("exports only products where effective retail price differs from old retail price", () => {
      const result = filterAndMapPosRows(sampleRows, { mode: "changed" });

      // Only SKU001 (19.99 != 14.99), SKU004 (29.99 != 24.99), MANUAL-SKU-99 (9.99 != 7.99)
      expect(result).toHaveLength(3);
      expect(result.map((r) => r.cleanedSku)).toEqual(["SKU001", "SKU004", "MANUAL-SKU-99"]);

      // Unchanged product (SKU002) and empty new price products (SKU003, SKU006) excluded
      expect(result.some((r) => r.cleanedSku === "SKU002")).toBe(false);
      expect(result.some((r) => r.cleanedSku === "SKU003")).toBe(false);
      expect(result.some((r) => r.cleanedSku === "SKU006")).toBe(false);
    });
  });

  describe("Option 4: Export Selected Products", () => {
    it("exports only manually selected products across pages preserving selection", () => {
      // Suppose user selected row-2 (page 1) and row-4 (page 2)
      const selectedIds = new Set(["row-2", "row-4"]);
      const result = filterAndMapPosRows(sampleRows, { mode: "selected", selectedIds });

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.cleanedSku)).toEqual(["SKU002", "SKU004"]);
      expect(result.find((r) => r.cleanedSku === "SKU002")?.nearest9).toBe("25.00");
      expect(result.find((r) => r.cleanedSku === "SKU004")?.nearest9).toBe("29.99");
    });

    it("returns empty array if no products selected", () => {
      const result = filterAndMapPosRows(sampleRows, { mode: "selected", selectedIds: new Set() });
      expect(result).toHaveLength(0);
    });
  });

  describe("De-duplication", () => {
    it("deduplicates worksheet records by Cleaned SKU (first occurrence wins)", () => {
      const duplicateRows: PosExportInputRow[] = [
        {
          id: "row-1",
          cleanedSku: "DUPE-SKU",
          ourNewListPrice: "10.00",
          nearest9: "19.99",
          oldRetailPrice: "15.00",
        },
        {
          id: "row-2",
          cleanedSku: "DUPE-SKU",
          ourNewListPrice: "12.00",
          nearest9: "22.99",
          oldRetailPrice: "15.00",
        },
      ];

      const result = filterAndMapPosRows(duplicateRows, { mode: "all" });
      expect(result).toHaveLength(1);
      expect(result[0].cleanedSku).toBe("DUPE-SKU");
      expect(result[0].nearest9).toBe("19.99");
      expect(result[0].ourNewListPrice).toBe("10.00");
    });
  });

  describe("computePosExportSummary", () => {
    it("calculates summary for all modes correctly", () => {
      // 6 total items: 3 changed (1, 4, 5), 3 unchanged/empty (2, 3, 6)
      const allSummary = computePosExportSummary(sampleRows, "all");
      expect(allSummary).toEqual({
        totalCount: 6,
        includedCount: 6,
        excludedCount: 0,
      });

      const allPopulateSummary = computePosExportSummary(sampleRows, "all-populate");
      expect(allPopulateSummary).toEqual({
        totalCount: 6,
        includedCount: 6,
        excludedCount: 0,
      });

      const changedSummary = computePosExportSummary(sampleRows, "changed");
      expect(changedSummary).toEqual({
        totalCount: 6,
        includedCount: 3,
        excludedCount: 3,
      });

      const selectedSummary = computePosExportSummary(sampleRows, "selected", new Set(["row-1", "row-3"]));
      expect(selectedSummary).toEqual({
        totalCount: 6,
        includedCount: 2,
        excludedCount: 4,
      });
    });
  });
});
