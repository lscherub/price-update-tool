import { describe, expect, it, vi } from "vitest";
import {
  applyColumnMapping,
  generateTemplateCsv,
  generateTemplateXlsx,
  guessColumnMapping,
  looksLikeHeaderRow,
  parsePastedText,
  TARGET_COLUMNS,
  validateBulkRow,
} from "@/lib/bulkAdd";
import { computeBulkAddPreview } from "@/lib/bulkAddServer";
import { calculateRow } from "@/lib/nearest9";
import { DEFAULT_DIVISOR } from "@/lib/pricing";
import type { StoreShape } from "@/lib/store";

// Hermetic calculation tests: bypass unreachable remote database in test environment
vi.mock("@/lib/db", () => ({
  getPrisma: () => null,
  isDbConnectionError: () => false,
  dbUnreachableResponse: () => ({ status: 503 }),
}));

const TEST_STORE: StoreShape = {
  products: [
    {
      id: "prod-1",
      sku: "62491774008",
      normalizedSku: "62491774008",
      productNumber: "AOR74008",
      description: "NA VIT K2 SOFTGEL",
      vendor: "A.O.R. INC.",
      brand: "AOR",
      listCost: "19.66",
      price: "31.70",
      sizeDesc: "60VSG",
      isInactive: false,
    },
    {
      id: "prod-2",
      sku: "62491774007",
      normalizedSku: "62491774007",
      productNumber: "AOR74007",
      description: "NA VIT D3",
      vendor: "A.O.R. INC.",
      brand: "AOR",
      listCost: "20.70",
      price: "33.39",
      sizeDesc: "120VSG",
      isInactive: false,
    },
    {
      id: "prod-3",
      sku: "06895801011",
      normalizedSku: "06895801011",
      productNumber: "ECO1011",
      description: "ORGANIC APPLE CIDER VINEGAR",
      vendor: "ECOTREND GREENS",
      brand: "BRAGG",
      listCost: "6.20",
      price: "10.49",
      sizeDesc: "473ML",
      isInactive: false,
    },
    {
      id: "prod-4",
      sku: "62776501032",
      normalizedSku: "62776501032",
      productNumber: "CAN1032",
      description: "MAGNESIUM BIS-GLYCINATE",
      vendor: "CANPREV",
      brand: "CANPREV",
      listCost: "9.10",
      price: "15.99",
      sizeDesc: "120VCP",
      isInactive: false,
    },
  ],
  vendorDiscounts: [
    { id: "vd-1", vendor: "A.O.R. INC.", normalizedVendor: "a.o.r. inc.", defaultDiscount: "10.00" },
    { id: "vd-2", vendor: "ECOTREND GREENS", normalizedVendor: "ecotrend greens", defaultDiscount: "5.00" },
    { id: "vd-3", vendor: "CANPREV", normalizedVendor: "canprev", defaultDiscount: "7.00" },
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
    loadFileStore: () => TEST_STORE,
  };
});

describe("bulkAdd — validation", () => {
  it("rejects row with missing SKU (both raw and cleaned are blank)", () => {
    const res = validateBulkRow({ rawVendorSku: "", cleanedSku: "", vendorListPriceNew: "10.00" });
    expect(res.isValid).toBe(false);
    expect(res.error).toContain("Missing SKU");
  });

  it("accepts row with only cleaned SKU", () => {
    const res = validateBulkRow({ cleanedSku: "06895801011", vendorListPriceNew: "9.49" });
    expect(res.isValid).toBe(true);
  });

  it("accepts row with only raw vendor SKU", () => {
    const res = validateBulkRow({ rawVendorSku: "6-27765-01032-9", vendorListPriceNew: "13.54" });
    expect(res.isValid).toBe(true);
  });

  it("rejects invalid discount (out of 0-100 range)", () => {
    expect(validateBulkRow({ cleanedSku: "123", discount: "150" }).isValid).toBe(false);
    expect(validateBulkRow({ cleanedSku: "123", discount: "-5" }).isValid).toBe(false);
    expect(validateBulkRow({ cleanedSku: "123", discount: "abc" }).isValid).toBe(false);
    expect(validateBulkRow({ cleanedSku: "123", discount: "15%" }).isValid).toBe(true);
  });

  it("rejects invalid price", () => {
    expect(validateBulkRow({ cleanedSku: "123", vendorListPriceNew: "invalid" }).isValid).toBe(false);
    expect(validateBulkRow({ cleanedSku: "123", vendorListPriceNew: "-10" }).isValid).toBe(false);
    expect(validateBulkRow({ cleanedSku: "123", vendorListPriceNew: "$12.50" }).isValid).toBe(true);
    expect(validateBulkRow({ cleanedSku: "123", vendorListPriceNew: "" }).isValid).toBe(true); // blank allowed
  });

  it("rejects invalid margin divisor", () => {
    expect(validateBulkRow({ cleanedSku: "123", marginDivisor: "0" }).isValid).toBe(false);
    expect(validateBulkRow({ cleanedSku: "123", marginDivisor: "-0.5" }).isValid).toBe(false);
    expect(validateBulkRow({ cleanedSku: "123", marginDivisor: "abc" }).isValid).toBe(false);
    expect(validateBulkRow({ cleanedSku: "123", marginDivisor: "0.55" }).isValid).toBe(true);
  });
});

describe("bulkAdd — parsing and column mapping", () => {
  it("detects header row from tab-separated pasted data", () => {
    const tsv = "Cleaned SKU\tVendor List Price (New)\n06895801011\t9.49\n62776501032\t13.54";
    const parsed = parsePastedText(tsv);
    expect(parsed.hasHeaderRow).toBe(true);
    expect(parsed.headers).toEqual(["Cleaned SKU", "Vendor List Price (New)"]);
    expect(parsed.rows.length).toBe(2);
    expect(parsed.rows[0]).toEqual(["06895801011", "9.49"]);
  });

  it("detects no-header row when data starts immediately", () => {
    const tsv = "06895801011\t9.49\n62776501032\t13.54";
    const parsed = parsePastedText(tsv);
    expect(parsed.hasHeaderRow).toBe(false);
    expect(parsed.rows.length).toBe(2);
  });

  it("guesses column mapping correctly for standard headers", () => {
    const headers = [
      "Raw Vendor SKU/Code",
      "Cleaned SKU",
      "Discount (%)",
      "Vendor List Price (New)",
      "Margin/Divisor",
      "Notes",
    ];
    const mapping = guessColumnMapping(headers);
    expect(mapping.rawVendorSku).toBe("Raw Vendor SKU/Code");
    expect(mapping.cleanedSku).toBe("Cleaned SKU");
    expect(mapping.discount).toBe("Discount (%)");
    expect(mapping.vendorListPriceNew).toBe("Vendor List Price (New)");
    expect(mapping.marginDivisor).toBe("Margin/Divisor");
    expect(mapping.notes).toBe("Notes");
  });

  it("guesses column mapping with loose/informal headers", () => {
    const headers = ["Vendor SKU", "Clean SKU", "Disc %", "New Cost", "Divisor", "Comment"];
    const mapping = guessColumnMapping(headers);
    expect(mapping.rawVendorSku).toBe("Vendor SKU");
    expect(mapping.cleanedSku).toBe("Clean SKU");
    expect(mapping.discount).toBe("Disc %");
    expect(mapping.vendorListPriceNew).toBe("New Cost");
    expect(mapping.marginDivisor).toBe("Divisor");
    expect(mapping.notes).toBe("Comment");
  });

  it("applies column mapping to extract target fields", () => {
    const headers = ["Cleaned SKU", "Vendor List Price (New)"];
    const rows = [["06895801011", "9.49"]];
    const mapping = guessColumnMapping(headers);
    const applied = applyColumnMapping(headers, rows, mapping);
    expect(applied).toEqual([
      {
        rawVendorSku: "",
        cleanedSku: "06895801011",
        discount: "",
        vendorListPriceNew: "9.49",
        marginDivisor: "",
        notes: "",
      },
    ]);
  });
});

describe("bulkAdd — preview calculation and worksheet logic parity", () => {
  it("computes row with only Cleaned SKU and Vendor List Price (New)", async () => {
    const input = [{ cleanedSku: "62491774008", vendorListPriceNew: "20.00" }];
    const preview = await computeBulkAddPreview(input);
    expect(preview.length).toBe(1);
    const item = preview[0];

    expect(item.isValid).toBe(true);
    expect(item.cleanedSku).toBe("62491774008");
    expect(item.vendorListPriceNew).toBe("20.00");
    // Product details looked up
    expect(item.matched).toBe(true);
    expect(item.productName).toBe("NA VIT K2 SOFTGEL");
    expect(item.brand).toBe("AOR");
    expect(item.vendor).toBe("A.O.R. INC.");
    expect(item.discount).toBe("10.00"); // Vendor default discount
    expect(item.ourNewListPrice).toBe("18.00");
    expect(item.marginDivisor).toBe("0.605"); // Default divisor
    expect(item.ourNewRetailPrice).toBe("29.7521");
    expect(item.nearest9).toBe("29.79");

    // Parity check against calculateRow
    const expected = calculateRow({
      rawVendorSku: "",
      cleanedSku: "62491774008",
      cleanedOverridden: true,
      vendorListPriceNew: "20.00",
      marginDivisor: DEFAULT_DIVISOR,
      product: {
        productNumber: "AOR74008",
        description: "NA VIT K2 SOFTGEL",
        brand: "AOR",
        vendor: "A.O.R. INC.",
        listCost: "19.66",
        price: "31.70",
      },
      defaultDiscount: "10.00",
    });

    expect(item.ourNewListPrice).toBe(expected.ourNewListPrice);
    expect(item.ourNewRetailPrice).toBe(expected.ourNewRetailPrice);
    expect(item.nearest9).toBe(expected.nearest9);
  });

  it("respects explicit optional fields (custom discount, divisor, notes)", async () => {
    const input = [
      {
        rawVendorSku: "6-27765-01032-9",
        vendorListPriceNew: "13.54",
        discount: "15",
        marginDivisor: "0.55",
        notes: "need to review",
      },
    ];
    const preview = await computeBulkAddPreview(input);
    expect(preview.length).toBe(1);
    const item = preview[0];

    expect(item.isValid).toBe(true);
    expect(item.rawVendorSku).toBe("6-27765-01032-9");
    expect(item.discount).toBe("15.00");
    expect(item.marginDivisor).toBe("0.55");
    expect(item.notes).toBe("need to review");
    // Looked up CANPREV product by cleaned SKU of raw sku
    expect(item.matched).toBe(true);
    expect(item.productName).toBe("MAGNESIUM BIS-GLYCINATE");
  });

  it("handles unmatched SKUs gracefully without crashing", async () => {
    const input = [{ cleanedSku: "NONEXISTENT-SKU-9999", vendorListPriceNew: "15.00" }];
    const preview = await computeBulkAddPreview(input);
    expect(preview.length).toBe(1);
    const item = preview[0];

    expect(item.isValid).toBe(true);
    expect(item.matched).toBe(false);
    expect(item.productName).toBe("");
    expect(item.discount).toBe("0.00");
    expect(item.ourNewListPrice).toBe("15.00");
    expect(item.marginDivisor).toBe(DEFAULT_DIVISOR);
    expect(item.nearest9).not.toBeNull();
  });

  it("identifies duplicates in worksheet and within batch", async () => {
    const input = [
      { cleanedSku: "62491774008", vendorListPriceNew: "10.00" },
      { cleanedSku: "62491774008", vendorListPriceNew: "12.00" }, // duplicate in batch
      { cleanedSku: "62491774007", vendorListPriceNew: "15.00" }, // duplicate in worksheet
    ];
    const preview = await computeBulkAddPreview(input, ["62491774007"]);
    expect(preview[0].isDuplicateInBatch).toBe(false);
    expect(preview[0].isDuplicateInWorksheet).toBe(false);

    expect(preview[1].isDuplicateInBatch).toBe(true);

    expect(preview[2].isDuplicateInWorksheet).toBe(true);
  });

  it("marks invalid rows with error messages", async () => {
    const input = [
      { rawVendorSku: "", cleanedSku: "" }, // missing SKU
      { cleanedSku: "123", discount: "200" }, // invalid discount
    ];
    const preview = await computeBulkAddPreview(input);
    expect(preview[0].isValid).toBe(false);
    expect(preview[0].validationError).toContain("Missing SKU");
    expect(preview[1].isValid).toBe(false);
    expect(preview[1].validationError).toContain("Discount");
  });
});

describe("bulkAdd — template generator", () => {
  it("generates CSV template with required columns and examples", () => {
    const csv = generateTemplateCsv();
    expect(csv).toContain("Raw Vendor SKU/Code,Cleaned SKU,Discount (%),Vendor List Price (New),Margin/Divisor,Notes");
    expect(csv).toContain("06895801011");
    expect(csv).toContain("9.49");
    expect(csv).toContain("6-27765-01032-9");
    expect(csv).toContain("13.54");
    expect(csv).toContain("0.55");
    expect(csv).toContain("need to review");
  });

  it("generates XLSX template buffer", () => {
    const xlsx = generateTemplateXlsx();
    expect(xlsx).toBeInstanceOf(Uint8Array);
    expect(xlsx.byteLength).toBeGreaterThan(100);
  });
});
