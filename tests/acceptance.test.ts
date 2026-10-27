import { describe, expect, it, vi } from "vitest";
import {
  applyColumnMapping,
  guessColumnMapping,
  parsePastedText,
  validateBulkRow,
} from "@/lib/bulkAdd";
import { computeBulkAddPreview } from "@/lib/bulkAddServer";
import { calculateRow } from "@/lib/nearest9";
import { DEFAULT_DIVISOR } from "@/lib/pricing";
import type { StoreShape } from "@/lib/store";

// Use hermetic in-memory store
vi.mock("@/lib/db", () => ({
  getPrisma: () => null,
  isDbConnectionError: () => false,
  dbUnreachableResponse: () => ({ status: 503 }),
}));

const ACCEPTANCE_STORE: StoreShape = {
  products: [
    {
      id: "prod-1",
      sku: "06895801011",
      normalizedSku: "0689580101", // Notice: shared prefix!
      productNumber: "NF-1011",
      description: "NA MEGA HALIBUT LIVER",
      vendor: "NATURAL FACTORS",
      brand: "NATURAL FACTORS",
      listCost: "6.20",
      price: "10.49",
      sizeDesc: "90SG",
      isInactive: false,
    },
    {
      id: "prod-14",
      sku: "06895801014",
      normalizedSku: "0689580101", // Notice: shared prefix!
      productNumber: "NF-1014",
      description: "NA BETACAREALL 25,000IU",
      vendor: "NATURAL FACTORS",
      brand: "NATURAL FACTORS",
      listCost: "11.20",
      price: "18.99",
      sizeDesc: "90SG",
      isInactive: false,
    },
    {
      id: "prod-15",
      sku: "06895801015",
      normalizedSku: "0689580101", // Notice: shared prefix!
      productNumber: "NF-1015",
      description: "NA COENZYME Q10 100MG",
      vendor: "NATURAL FACTORS",
      brand: "NATURAL FACTORS",
      listCost: "20.50",
      price: "34.99",
      sizeDesc: "60SG",
      isInactive: false,
    },
    {
      id: "prod-16",
      sku: "06895801016",
      normalizedSku: "0689580101", // Notice: shared prefix!
      productNumber: "NF-1016",
      description: "NA ZINC CITRATE 50MG",
      vendor: "NATURAL FACTORS",
      brand: "NATURAL FACTORS",
      listCost: "14.10",
      price: "23.99",
      sizeDesc: "90TAB",
      isInactive: false,
    },
    {
      id: "prod-2",
      sku: "62776501032",
      normalizedSku: "62776501032",
      productNumber: "CAN-1032",
      description: "CANPREV MAGNESIUM BIS-GLYCINATE 120 V-CAPS",
      vendor: "CANPREV",
      brand: "CANPREV",
      listCost: "9.10",
      price: "15.99",
      sizeDesc: "120VCP",
      isInactive: false,
    },
    {
      id: "prod-3",
      sku: "62491774008",
      normalizedSku: "62491774008",
      productNumber: "AOR-74008",
      description: "AOR VITAMIN K2 SOFTGELS",
      vendor: "A.O.R. INC.",
      brand: "AOR",
      listCost: "19.66",
      price: "31.70",
      sizeDesc: "60VSG",
      isInactive: false,
    },
  ],
  vendorDiscounts: [
    { id: "vd-0", vendor: "NATURAL FACTORS", normalizedVendor: "natural factors", defaultDiscount: "10.00" },
    { id: "vd-1", vendor: "ECOTREND GREENS", normalizedVendor: "ecotrend greens", defaultDiscount: "10.00" },
    { id: "vd-2", vendor: "CANPREV", normalizedVendor: "canprev", defaultDiscount: "8.00" },
    { id: "vd-3", vendor: "A.O.R. INC.", normalizedVendor: "a.o.r. inc.", defaultDiscount: "10.00" },
  ],
  brandDiscounts: [],
  sessions: [],
  items: [],
  users: [],
  exports: [],
};

vi.mock("@/lib/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/store")>();
  return {
    ...actual,
    loadFileStore: () => ACCEPTANCE_STORE,
  };
});

describe("Acceptance Test — Bulk Add Rows", () => {
  it("Scenario 1: Bulk pasting with only Cleaned SKU and Vendor List Price (New)", async () => {
    // Pasted text directly from Excel (tab-separated)
    const pastedText = `Cleaned SKU\tVendor List Price (New)
06895801011\t9.49`;

    const parsed = parsePastedText(pastedText);
    expect(parsed.hasHeaderRow).toBe(true);

    const mapping = guessColumnMapping(parsed.headers);
    expect(mapping.cleanedSku).toBe("Cleaned SKU");
    expect(mapping.vendorListPriceNew).toBe("Vendor List Price (New)");

    const inputRows = applyColumnMapping(parsed.headers, parsed.rows, mapping);
    expect(inputRows).toEqual([
      {
        rawVendorSku: "",
        cleanedSku: "06895801011",
        discount: "",
        vendorListPriceNew: "9.49",
        marginDivisor: "",
        notes: "",
      },
    ]);

    const preview = await computeBulkAddPreview(inputRows);
    expect(preview.length).toBe(1);

    const row = preview[0];
    expect(row.isValid).toBe(true);
    expect(row.matched).toBe(true);
    expect(row.cleanedSku).toBe("06895801011");
    expect(row.productName).toBe("NA MEGA HALIBUT LIVER");
    expect(row.vendor).toBe("NATURAL FACTORS");
    expect(row.brand).toBe("NATURAL FACTORS");
    expect(row.discount).toBe("10.00"); // Vendor default applied
    expect(row.marginDivisor).toBe(DEFAULT_DIVISOR); // Default divisor "0.605" applied
    expect(row.vendorListPriceNew).toBe("9.49");

    // Single-row calculation parity check
    // Our New List Price = 9.49 * (1 - 0.10) = 8.541 -> rounded to 8.54
    // Our New Retail Price = 8.54 / 0.605 = 14.1157...
    // Nearest 9 = 14.19
    const singleRowExpected = calculateRow({
      rawVendorSku: "",
      cleanedSku: "06895801011",
      cleanedOverridden: true,
      vendorListPriceNew: "9.49",
      marginDivisor: DEFAULT_DIVISOR,
      product: {
        productNumber: "NF-1011",
        description: "NA MEGA HALIBUT LIVER",
        brand: "NATURAL FACTORS",
        vendor: "NATURAL FACTORS",
        listCost: "6.20",
        price: "10.49",
      },
      defaultDiscount: "10.00",
    });

    expect(row.ourNewListPrice).toBe(singleRowExpected.ourNewListPrice);
    expect(row.ourNewRetailPrice).toBe(singleRowExpected.ourNewRetailPrice);
    expect(row.nearest9).toBe(singleRowExpected.nearest9);
    expect(row.oldRetailPrice).toBe(singleRowExpected.oldRetailPrice);
    expect(row.currentListPrice).toBe(singleRowExpected.currentListPrice);
  });

  it("Scenario 2: Bulk pasting with additional optional fields populated", async () => {
    // Pasted text matching the table in requirements:
    // Raw Vendor SKU/Code | Cleaned SKU | Discount (%) | Vendor List Price (New) | Margin/Divisor | Notes
    // 6-27765-01032-9     |             |              | 13.54                   | 0.55           | need to review
    const pastedText = `Raw Vendor SKU/Code\tCleaned SKU\tDiscount (%)\tVendor List Price (New)\tMargin/Divisor\tNotes
6-27765-01032-9\t\t\t13.54\t0.55\tneed to review`;

    const parsed = parsePastedText(pastedText);
    const mapping = guessColumnMapping(parsed.headers);
    const inputRows = applyColumnMapping(parsed.headers, parsed.rows, mapping);

    expect(inputRows).toEqual([
      {
        rawVendorSku: "6-27765-01032-9",
        cleanedSku: "",
        discount: "",
        vendorListPriceNew: "13.54",
        marginDivisor: "0.55",
        notes: "need to review",
      },
    ]);

    const preview = await computeBulkAddPreview(inputRows);
    expect(preview.length).toBe(1);

    const row = preview[0];
    expect(row.isValid).toBe(true);
    expect(row.matched).toBe(true);
    // Raw Vendor SKU 6-27765-01032-9 cleans to 62776501032
    expect(row.cleanedSku).toBe("62776501032");
    expect(row.rawVendorSku).toBe("6-27765-01032-9");
    expect(row.productName).toBe("CANPREV MAGNESIUM BIS-GLYCINATE 120 V-CAPS");
    expect(row.vendor).toBe("CANPREV");
    expect(row.brand).toBe("CANPREV");
    expect(row.discount).toBe("8.00"); // Vendor default discount applied
    expect(row.marginDivisor).toBe("0.55"); // Explicit margin divisor respected
    expect(row.notes).toBe("need to review"); // Explicit notes respected

    // Parity check against single-row calculation
    const singleRowExpected = calculateRow({
      rawVendorSku: "6-27765-01032-9",
      cleanedSku: "62776501032",
      cleanedOverridden: false,
      vendorListPriceNew: "13.54",
      marginDivisor: "0.55",
      product: {
        productNumber: "CAN-1032",
        description: "CANPREV MAGNESIUM BIS-GLYCINATE 120 V-CAPS",
        brand: "CANPREV",
        vendor: "CANPREV",
        listCost: "9.10",
        price: "15.99",
      },
      defaultDiscount: "8.00",
    });

    expect(row.ourNewListPrice).toBe(singleRowExpected.ourNewListPrice);
    expect(row.ourNewRetailPrice).toBe(singleRowExpected.ourNewRetailPrice);
    expect(row.nearest9).toBe(singleRowExpected.nearest9);
  });

  it("Scenario 3: Bulk pasting with invalid or unmatched SKUs and duplicate products", async () => {
    const pastedText = `Raw Vendor SKU/Code\tCleaned SKU\tDiscount (%)\tVendor List Price (New)\tMargin/Divisor\tNotes
\tUNKNOWN-SKU-999\t\t15.00\t\t
\t\t\t10.00\t\t
\t06895801011\t150\t9.49\t\t
\t06895801011\t\t9.49\t\t`;

    const parsed = parsePastedText(pastedText);
    const mapping = guessColumnMapping(parsed.headers);
    const inputRows = applyColumnMapping(parsed.headers, parsed.rows, mapping);

    // Simulate worksheet already having 06895801011
    const existingWorksheetSkus = ["06895801011"];
    const preview = await computeBulkAddPreview(inputRows, existingWorksheetSkus);

    expect(preview.length).toBe(4);

    // Row 0: Unmatched SKU (valid row, matched = false, Not Found)
    expect(preview[0].isValid).toBe(true);
    expect(preview[0].matched).toBe(false);
    expect(preview[0].cleanedSku).toBe("UNKNOWN-SKU-999");
    expect(preview[0].productName).toBe("");
    expect(preview[0].ourNewListPrice).toBe("15.00");
    expect(preview[0].nearest9).not.toBeNull();

    // Row 1: Missing SKU (both raw and cleaned blank -> invalid)
    expect(preview[1].isValid).toBe(false);
    expect(preview[1].validationError).toContain("Missing SKU");

    // Row 2: Invalid discount (150% is out of 0-100 range -> invalid)
    expect(preview[2].isValid).toBe(false);
    expect(preview[2].validationError).toContain("Discount");

    // Row 3: Duplicate of existing worksheet row
    expect(preview[3].isValid).toBe(true);
    expect(preview[3].isDuplicateInWorksheet).toBe(true);
  });

  it("Scenario 4: Column mapping selection and re-verification", () => {
    // User uploads a file with unconventional column names
    const headers = ["Item Barcode", "Store SKU", "Promo Rebate", "Supplier Cost", "Target Divisor", "Internal Notes"];
    const mapping = guessColumnMapping(headers);

    // User can customize or select any column name
    const customMapping = {
      ...mapping,
      rawVendorSku: "Item Barcode",
      cleanedSku: "Store SKU",
      discount: "Promo Rebate",
      vendorListPriceNew: "Supplier Cost",
      marginDivisor: "Target Divisor",
      notes: "Internal Notes",
    };

    const rows = [["0-58854-04522-7", "05885404522", "5", "12.00", "0.58", "check margin"]];
    const extracted = applyColumnMapping(headers, rows, customMapping);

    expect(extracted[0]).toEqual({
      rawVendorSku: "0-58854-04522-7",
      cleanedSku: "05885404522",
      discount: "5",
      vendorListPriceNew: "12.00",
      marginDivisor: "0.58",
      notes: "check margin",
    });
  });

  it("Scenario 5: User example with 4 similar SKUs sharing prefix (06895801011, 06895801014, 06895801015, 06895801016)", async () => {
    const pastedText = `Cleaned SKU\tVendor List Price (New)
06895801011\t9.49
06895801014\t17.36
06895801015\t32.33
06895801016\t21.86`;

    const parsed = parsePastedText(pastedText);
    const mapping = guessColumnMapping(parsed.headers);
    const inputRows = applyColumnMapping(parsed.headers, parsed.rows, mapping);

    expect(inputRows.length).toBe(4);

    const preview = await computeBulkAddPreview(inputRows);
    expect(preview.length).toBe(4);

    // Row 0: 06895801011 -> NA MEGA HALIBUT LIVER
    expect(preview[0].cleanedSku).toBe("06895801011");
    expect(preview[0].productName).toBe("NA MEGA HALIBUT LIVER");
    expect(preview[0].vendorListPriceNew).toBe("9.49");
    expect(preview[0].isValid).toBe(true);
    expect(preview[0].matched).toBe(true);
    expect(preview[0].isDuplicateInBatch).toBe(false);

    // Row 1: 06895801014 -> MUST RESOLVE TO NA BETACAREALL 25,000IU (NOT NA MEGA HALIBUT LIVER!)
    expect(preview[1].cleanedSku).toBe("06895801014");
    expect(preview[1].productName).toBe("NA BETACAREALL 25,000IU");
    expect(preview[1].vendorListPriceNew).toBe("17.36");
    expect(preview[1].isValid).toBe(true);
    expect(preview[1].matched).toBe(true);
    expect(preview[1].isDuplicateInBatch).toBe(false); // Must NOT be flagged as duplicate

    // Row 2: 06895801015 -> NA COENZYME Q10 100MG
    expect(preview[2].cleanedSku).toBe("06895801015");
    expect(preview[2].productName).toBe("NA COENZYME Q10 100MG");
    expect(preview[2].vendorListPriceNew).toBe("32.33");
    expect(preview[2].isValid).toBe(true);
    expect(preview[2].matched).toBe(true);
    expect(preview[2].isDuplicateInBatch).toBe(false);

    // Row 3: 06895801016 -> NA ZINC CITRATE 50MG
    expect(preview[3].cleanedSku).toBe("06895801016");
    expect(preview[3].productName).toBe("NA ZINC CITRATE 50MG");
    expect(preview[3].vendorListPriceNew).toBe("21.86");
    expect(preview[3].isValid).toBe(true);
    expect(preview[3].matched).toBe(true);
    expect(preview[3].isDuplicateInBatch).toBe(false);

    // Verify all four can be added (all valid and not duplicates)
    const canBeAdded = preview.filter((r) => r.isValid && !r.isDuplicateInBatch);
    expect(canBeAdded.length).toBe(4);
  });
});

