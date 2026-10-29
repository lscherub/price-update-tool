import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  cleanPrice,
  parseFullVendorPaste,
  planFullVendorRows,
  planSummaryMarkdown,
  type FvProduct,
} from "@/lib/fullVendor";
import {
  buildFullVendorCountWorkbook,
  formatCountDate,
  fullVendorEffectivePrice,
  fullVendorNewPrice,
  FULL_VENDOR_COUNT_HEADER,
  FULL_VENDOR_COUNT_INSTRUCTIONS,
  FULL_VENDOR_COUNT_NOTE,
  type FullVendorCountRow,
} from "@/lib/fullVendorExcel";

describe("parseFullVendorPaste", () => {
  it("parses tab-separated 2-column SKU and price", () => {
    const text = "058854045227\t19.99\n624-917-74008-0\t24.50\n00123\t5.00";
    const parsed = parseFullVendorPaste(text);
    expect(parsed).toEqual([
      { raw: "058854045227", price: "19.99", line: 1 },
      { raw: "624-917-74008-0", price: "24.50", line: 2 },
      { raw: "00123", price: "5.00", line: 3 },
    ]);
  });

  it("preserves leading zeros on raw SKUs without truncation", () => {
    const text = "000456\t12.99\n01\t3.50";
    const parsed = parseFullVendorPaste(text);
    expect(parsed[0].raw).toBe("000456");
    expect(parsed[1].raw).toBe("01");
  });

  it("skips header rows when header keywords are present", () => {
    const text = "Vendor SKU\tNew List Price\n058854\t15.25\n999123\t8.00";
    const parsed = parseFullVendorPaste(text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].raw).toBe("058854");
    expect(parsed[0].price).toBe("15.25");
  });

  it("handles multi-column Excel paste by locating SKU and Price columns", () => {
    const text = "Item Code\tDescription\tOld Price\tNew List Price\nSKU-100\tWidget A\t10.00\t12.50";
    const parsed = parseFullVendorPaste(text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].raw).toBe("SKU-100");
    expect(parsed[0].price).toBe("12.50");
  });
});

describe("cleanPrice", () => {
  it("cleans currency symbols and whitespace", () => {
    expect(cleanPrice("$19.99")).toEqual({ ok: true, value: "19.99" });
    expect(cleanPrice(" 24.50 ")).toEqual({ ok: true, value: "24.50" });
    expect(cleanPrice("")).toEqual({ ok: true, value: null });
  });

  it("rejects non-numeric and negative values", () => {
    expect(cleanPrice("N/A")).toEqual({ ok: false });
    expect(cleanPrice("-15.00")).toEqual({ ok: false });
  });
});

describe("planFullVendorRows matching logic", () => {
  const mockProducts: FvProduct[] = [
    {
      id: "prod-1",
      sku: "058854045227",
      normalizedSku: "05885404522",
      productNumber: "P101",
      description: "Zinc 50mg",
      vendor: "AOR",
      brand: "AOR",
      listCost: "10.00",
      price: "20.00",
      sizeDesc: "60 caps",
      isInactive: false,
    },
    {
      id: "prod-2",
      sku: "0012345",
      normalizedSku: "001234",
      productNumber: "P102",
      description: "Magnesium Synergist",
      vendor: "AOR",
      brand: "AOR",
      listCost: "15.00",
      price: "30.00",
      sizeDesc: "120 caps",
      isInactive: false,
    },
    {
      id: "prod-3",
      sku: "999888",
      normalizedSku: "99988",
      productNumber: "P103",
      description: "Discontinued Tonic",
      vendor: "AOR",
      brand: "AOR",
      listCost: "8.00",
      price: "16.00",
      sizeDesc: "250 ml",
      isInactive: true,
    },
  ];

  it("matches products and retains every vendor product (including unmatched and inactive)", () => {
    // Pasted has match for prod-1 and prod-3, but NOT prod-2
    const pasted = [
      { raw: "058854-04522-7", price: "12.50", line: 1 },
      { raw: "999888", price: "9.50", line: 2 },
    ];
    const plan = planFullVendorRows(mockProducts, pasted);

    expect(plan.rows).toHaveLength(3);

    // Prod-1: matched and priced
    const r1 = plan.rows.find((r) => r.product?.id === "prod-1")!;
    expect(r1.status).toBe("priced");
    expect(r1.vendorListPriceNew).toBe("12.50");

    // Prod-2: missing from vendor list, retained with null price
    const r2 = plan.rows.find((r) => r.product?.id === "prod-2")!;
    expect(r2.status).toBe("missing");
    expect(r2.vendorListPriceNew).toBeNull();
    expect(r2.note).toContain("not in vendor price list");

    // Prod-3: inactive product matched and retained with inactive flag
    const r3 = plan.rows.find((r) => r.product?.id === "prod-3")!;
    expect(r3.status).toBe("priced");
    expect(r3.vendorListPriceNew).toBe("9.50");
    expect(r3.product?.isInactive).toBe(true);

    expect(plan.counts.total).toBe(3);
    expect(plan.counts.priced).toBe(2);
    expect(plan.counts.missing).toBe(1);
    expect(plan.counts.inactive).toBe(1);
  });

  it("handles leading-zero SKUs properly", () => {
    const pasted = [{ raw: "0012345", price: "18.00", line: 1 }];
    const plan = planFullVendorRows(mockProducts, pasted);
    const r2 = plan.rows.find((r) => r.product?.id === "prod-2")!;
    expect(r2.status).toBe("priced");
    expect(r2.vendorListPriceNew).toBe("18.00");
  });

  it("flags ambiguous matches when one pasted SKU matches multiple products", () => {
    const productsWithDupes: FvProduct[] = [
      {
        id: "prod-a",
        sku: "123456",
        normalizedSku: "12345",
        productNumber: "A1",
        description: "Size 60",
        vendor: "V",
        brand: "B",
        listCost: "5.00",
        price: "10.00",
        sizeDesc: "60 caps",
        isInactive: false,
      },
      {
        id: "prod-b",
        sku: "123459",
        normalizedSku: "12345", // same normalized prefix
        productNumber: "A2",
        description: "Size 120",
        vendor: "V",
        brand: "B",
        listCost: "9.00",
        price: "18.00",
        sizeDesc: "120 caps",
        isInactive: false,
      },
    ];

    // Raw vendor SKU that strips to '12345', matching both prod-a and prod-b
    const pasted = [{ raw: "12345-0", price: "7.00", line: 1 }];
    const plan = planFullVendorRows(productsWithDupes, pasted);

    expect(plan.ambiguousPasted).toHaveLength(1);
    expect(plan.counts.ambiguous).toBe(2);
    // Neither row receives an ambiguous fabricated price
    expect(plan.rows[0].vendorListPriceNew).toBeNull();
    expect(plan.rows[1].vendorListPriceNew).toBeNull();
    expect(plan.rows[0].note).toContain("Review: vendor SKU");
  });

  it("never creates duplicate product rows", () => {
    // Pasting the same SKU twice
    const pasted = [
      { raw: "058854045227", price: "12.00", line: 1 },
      { raw: "058854045227", price: "12.00", line: 2 },
    ];
    const plan = planFullVendorRows(mockProducts, pasted);
    // Number of planned rows must strictly equal number of inventory products
    expect(plan.rows).toHaveLength(mockProducts.length);
  });

  it("flags conflict if duplicate paste rows have different prices", () => {
    const pasted = [
      { raw: "058854045227", price: "12.00", line: 1 },
      { raw: "058854045227", price: "14.00", line: 2 },
    ];
    const plan = planFullVendorRows(mockProducts, pasted);
    const r1 = plan.rows.find((r) => r.product?.id === "prod-1")!;
    expect(r1.status).toBe("conflict");
    expect(r1.vendorListPriceNew).toBeNull();
    expect(r1.note).toContain("conflicting vendor prices");
  });

  it("sets cleanedOverridden to false on all automatically loaded inventory rows", () => {
    const pasted = [{ raw: "058854045227", price: "12.00", line: 1 }];
    const plan = planFullVendorRows(mockProducts, pasted);
    for (const r of plan.rows) {
      if (r.product) {
        expect(r.cleanedOverridden).toBe(false);
      }
    }
  });

  it("keeps unmatched vendor products as worksheet rows with product=null and status=not-found", () => {
    const pasted = [
      { raw: "058854045227", price: "12.00", line: 1 }, // matched to prod-1
      { raw: "UNKNOWN-SKU-999", price: "45.00", line: 2 }, // not in inventory
      { raw: "000888777", price: "19.95", line: 3 }, // not in inventory
    ];
    const plan = planFullVendorRows(mockProducts, pasted);

    // 3 inventory products + 2 unmatched vendor rows = 5 rows
    expect(plan.rows).toHaveLength(5);
    expect(plan.counts.total).toBe(5);
    expect(plan.counts.notFound).toBe(2);

    const unmatched1 = plan.rows.find((r) => r.rawVendorSku === "UNKNOWN-SKU-999")!;
    expect(unmatched1).toBeDefined();
    expect(unmatched1.product).toBeNull();
    expect(unmatched1.status).toBe("not-found");
    expect(unmatched1.vendorListPriceNew).toBe("45.00");
    expect(unmatched1.cleanedOverridden).toBe(false);
    expect(unmatched1.note).toContain("Review: not found in inventory.");

    const unmatched2 = plan.rows.find((r) => r.rawVendorSku === "000888777")!;
    expect(unmatched2).toBeDefined();
    expect(unmatched2.product).toBeNull();
    expect(unmatched2.status).toBe("not-found");
    expect(unmatched2.vendorListPriceNew).toBe("19.95");
    expect(unmatched2.cleanedSku).toBe("00088877");
  });

  it("deduplicates unmatched vendor rows and flags conflicting prices", () => {
    const pasted = [
      { raw: "UNMATCHED-1", price: "10.00", line: 1 },
      { raw: "UNMATCHED-1", price: "12.00", line: 2 }, // conflict!
      { raw: "UNMATCHED-2", price: "25.00", line: 3 },
      { raw: "UNMATCHED-2", price: "25.00", line: 4 }, // duplicate identical price
    ];
    const plan = planFullVendorRows(mockProducts, pasted);

    const c1 = plan.rows.find((r) => r.rawVendorSku === "UNMATCHED-1")!;
    expect(c1.status).toBe("conflict");
    expect(c1.vendorListPriceNew).toBeNull();
    expect(c1.note).toContain("Conflicting vendor prices");

    const c2 = plan.rows.filter((r) => r.rawVendorSku === "UNMATCHED-2");
    expect(c2).toHaveLength(1);
    expect(c2[0].status).toBe("not-found");
    expect(c2[0].vendorListPriceNew).toBe("25.00");
  });

  it("generates markdown summary with counts and notes", () => {
    const pasted = [{ raw: "058854045227", price: "12.00", line: 1 }];
    const plan = planFullVendorRows(mockProducts, pasted);
    const md = planSummaryMarkdown("AOR", plan);
    expect(md).toContain("**Full Vendor Price Update — AOR**");
    expect(md).toContain("Inventory products: 3");
    expect(md).toContain("With new vendor price: 1");
    expect(md).toContain("Not in vendor list (no price): 2");
  });
});

describe("fullVendorNewPrice rule", () => {
  it("leaves New Price blank when price is unchanged", () => {
    expect(fullVendorNewPrice("29.99", "29.99")).toBe("");
    expect(fullVendorNewPrice("29.9900", "29.99")).toBe("");
  });

  it("returns the effective New Price when price is changed", () => {
    expect(fullVendorNewPrice("34.99", "29.99")).toBe("34.99");
    expect(fullVendorNewPrice("24.99", "29.99")).toBe("24.99");
  });

  it("returns blank when there is no new price (unmatched or missing)", () => {
    expect(fullVendorNewPrice(null, "29.99")).toBe("");
    expect(fullVendorNewPrice("", "29.99")).toBe("");
    expect(fullVendorNewPrice(undefined, "29.99")).toBe("");
  });

  it("returns new price when there was no old price", () => {
    expect(fullVendorNewPrice("19.99", null)).toBe("19.99");
    expect(fullVendorNewPrice("19.99", "")).toBe("19.99");
  });

  describe("fullVendorEffectivePrice with priceMode options", () => {
    it("changed mode: returns blank when price is unchanged", () => {
      expect(fullVendorEffectivePrice("29.99", "29.99", "changed")).toBe("");
      expect(fullVendorEffectivePrice("29.99", "29.99")).toBe("");
    });

    it("changed mode: returns new price when price is changed", () => {
      expect(fullVendorEffectivePrice("34.99", "29.99", "changed")).toBe("34.99");
    });

    it("all mode: returns effective price for every product, even if unchanged", () => {
      expect(fullVendorEffectivePrice("29.99", "29.99", "all")).toBe("29.99");
      expect(fullVendorEffectivePrice("34.99", "29.99", "all")).toBe("34.99");
    });

    it("all mode: falls back to old retail price if nearest9 is missing", () => {
      expect(fullVendorEffectivePrice(null, "19.99", "all")).toBe("19.99");
      expect(fullVendorEffectivePrice("", "19.99", "all")).toBe("19.99");
    });
  });
});

describe("buildFullVendorCountWorkbook", () => {
  const rows: FullVendorCountRow[] = [
    { sku: "00123", description: "Alpha Vitamin", sizeDesc: "60 caps", newPrice: "19.99" },
    { sku: "00456", description: "Beta Mineral", sizeDesc: "120 tabs", newPrice: "" }, // unchanged
    { sku: "00789", description: "Gamma Herb", sizeDesc: "200 ml", newPrice: "24.99" },
  ];

  it("produces a valid .xlsx buffer with all 9 exact columns in order", () => {
    const date = new Date(2026, 9, 28); // October 28, 2026
    const buf = buildFullVendorCountWorkbook(rows, { vendor: "AOR", date });

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);

    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toContain("Store Count");

    const ws = wb.Sheets["Store Count"];
    const aoa: (string | number)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    // Row 1: Today's date formatted
    expect(aoa[0][0]).toBe("October 28, 2026");

    // Row 2: Staff field
    expect(aoa[1][0]).toBe("Staff:");

    // Row 3: Instructions
    expect(aoa[2][0]).toBe(FULL_VENDOR_COUNT_INSTRUCTIONS);

    // Row 4: Note about empty New Price
    expect(aoa[3][0]).toBe(FULL_VENDOR_COUNT_NOTE);

    // Row 6: Table headers (index 5)
    expect(aoa[5]).toEqual([...FULL_VENDOR_COUNT_HEADER]);

    // Data rows
    expect(aoa[6][0]).toBe("00123");
    expect(aoa[6][1]).toBe("Alpha Vitamin");
    expect(aoa[6][2]).toBe("60 caps");
    expect(aoa[6][3]).toBe(19.99);

    // Row with no price change has blank new price
    expect(aoa[7][0]).toBe("00456");
    expect(aoa[7][3]).toBe("");

    // Total data rows preserved
    expect(aoa.length).toBe(6 + rows.length);
  });

  it("preserves leading zeros on SKUs in excel", () => {
    const date = new Date(2026, 9, 28);
    const buf = buildFullVendorCountWorkbook([{ sku: "0009876", description: "Test", sizeDesc: "", newPrice: "" }], { vendor: "Test", date });
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets["Store Count"];
    const aoa: (string | number)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    expect(aoa[6][0]).toBe("0009876");
  });

  it("formats date like 'October 28, 2026'", () => {
    const formatted = formatCountDate(new Date(2026, 9, 28));
    expect(formatted).toBe("October 28, 2026");
  });

  it("updates Note in row 4 when priceMode is 'all'", () => {
    const buf = buildFullVendorCountWorkbook(
      [{ sku: "001", description: "Item 1", sizeDesc: "", newPrice: "10.00" }],
      { vendor: "Test Vendor", priceMode: "all" },
    );
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets["Store Count"];
    const aoa: (string | number)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    expect(aoa[3][0]).toContain("New Price shows the final effective retail price for all items");
  });

  it("includes legend in row 5 when all products include inactive items", () => {
    const buf = buildFullVendorCountWorkbook(
      [
        { sku: "001", description: "Active Item", sizeDesc: "", newPrice: "10.00", isInactive: false },
        { sku: "002", description: "Inactive Item", sizeDesc: "", newPrice: "15.00", isInactive: true },
      ],
      { vendor: "Test Vendor", productFilter: "all" },
    );
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets["Store Count"];
    const aoa: (string | number)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    expect(aoa[4][0]).toContain("Legend: Light-grey rows indicate Inactive products");
  });

  it("displays productFilter label in row 5 for active and inactive filters", () => {
    const bufActive = buildFullVendorCountWorkbook(
      [{ sku: "001", description: "Active", sizeDesc: "", newPrice: "10.00", isInactive: false }],
      { vendor: "Test Vendor", productFilter: "active" },
    );
    const wbActive = XLSX.read(bufActive, { type: "buffer" });
    const wsActive = wbActive.Sheets["Store Count"];
    const aoaActive: (string | number)[][] = XLSX.utils.sheet_to_json(wsActive, { header: 1, defval: "" });
    expect(aoaActive[4][0]).toContain("(Active Only)");

    const bufInactive = buildFullVendorCountWorkbook(
      [{ sku: "002", description: "Inactive", sizeDesc: "", newPrice: "10.00", isInactive: true }],
      { vendor: "Test Vendor", productFilter: "inactive" },
    );
    const wbInactive = XLSX.read(bufInactive, { type: "buffer" });
    const wsInactive = wbInactive.Sheets["Store Count"];
    const aoaInactive: (string | number)[][] = XLSX.utils.sheet_to_json(wsInactive, { header: 1, defval: "" });
    expect(aoaInactive[4][0]).toContain("(Inactive Only)");
  });
});

