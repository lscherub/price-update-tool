import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  cleanUnifiedPosMatrix,
  findUnifiedPosHeaders,
  normalizeHeaderString,
  parseAndCleanUnifiedPosFile,
  parsePosInactive,
} from "@/lib/unifiedPosCleaner";

describe("normalizeHeaderString", () => {
  it("normalizes variations in punctuation, casing, and spacing", () => {
    expect(normalizeHeaderString("Size Desc.")).toBe("size desc");
    expect(normalizeHeaderString("Size Desc")).toBe("size desc");
    expect(normalizeHeaderString("size desc")).toBe("size desc");
    expect(normalizeHeaderString("SIZE  DESC.")).toBe("size desc");
    expect(normalizeHeaderString("Product No.")).toBe("product no");
    expect(normalizeHeaderString("Product Number")).toBe("product number");
    expect(normalizeHeaderString("INACTIVE")).toBe("inactive");
    expect(normalizeHeaderString("  List Cost  ")).toBe("list cost");
  });
});

describe("parsePosInactive", () => {
  it("maps Y, y, and trimmed Y to Inactive", () => {
    expect(parsePosInactive("Y")).toEqual({ isInactive: true, status: "Inactive" });
    expect(parsePosInactive("y")).toEqual({ isInactive: true, status: "Inactive" });
    expect(parsePosInactive(" Y ")).toEqual({ isInactive: true, status: "Inactive" });
  });

  it("maps Blank, N, 0, YES, and other values to Active", () => {
    expect(parsePosInactive("")).toEqual({ isInactive: false, status: "Active" });
    expect(parsePosInactive(null)).toEqual({ isInactive: false, status: "Active" });
    expect(parsePosInactive(undefined)).toEqual({ isInactive: false, status: "Active" });
    expect(parsePosInactive("N")).toEqual({ isInactive: false, status: "Active" });
    expect(parsePosInactive("0")).toEqual({ isInactive: false, status: "Active" });
    expect(parsePosInactive("YES")).toEqual({ isInactive: false, status: "Active" });
    expect(parsePosInactive("ACTIVE")).toEqual({ isInactive: false, status: "Active" });
    expect(parsePosInactive("no")).toEqual({ isInactive: false, status: "Active" });
  });
});

describe("findUnifiedPosHeaders", () => {
  it("detects header row with empty Column A and variation in header names", () => {
    const matrix = [
      ["Export Title", "", ""],
      ["", "Sku", "Product No.", "Description", "Vendor", "Brand", "List Cost", "Price", "Size Desc.", "INACTIVE", "Extra Col"],
    ];
    const res = findUnifiedPosHeaders(matrix);
    expect(res).not.toBeNull();
    expect(res?.headerIndex).toBe(1);
    expect(res?.missingFields).toHaveLength(0);
    expect(res?.colIndexMap.sku).toBe(1);
    expect(res?.colIndexMap.productNumber).toBe(2);
    expect(res?.colIndexMap.sizeDesc).toBe(8);
    expect(res?.colIndexMap.inactive).toBe(9);
  });

  it("reports missing required columns", () => {
    const matrix = [
      ["", "Sku", "Description", "Vendor", "Brand", "Price"],
    ];
    const res = findUnifiedPosHeaders(matrix);
    expect(res).not.toBeNull();
    expect(res?.missingFields).toContain("productNumber");
    expect(res?.missingFields).toContain("listCost");
    expect(res?.missingFields).toContain("sizeDesc");
    expect(res?.missingFields).toContain("inactive");
  });
});

describe("cleanUnifiedPosMatrix", () => {
  it("cleans raw POS export with empty Column A, empty second row, extra columns, leading zeros, and status mapping", () => {
    const matrix: unknown[][] = [
      // Row 0: Headers (Column A empty, extra unused POS columns)
      [
        "",
        "Sku",
        "Description",
        "Size Desc.",
        "Vendor",
        "Product Number",
        "Brand",
        "List Cost",
        "Price",
        "Dim.2 Group",
        "Department",
        "QOH",
        "INACTIVE",
        "Web Item",
      ],
      // Row 1: Empty second row from POS export
      ["", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      // Row 2: Active item with leading zeros and blank INACTIVE
      [
        "",
        "001234",
        "Vitamin C 1000mg",
        "100 Tabs",
        "Natural Factors",
        "00987",
        "Brand A",
        "$12.50",
        "$24.99",
        "Vits",
        "Supplements",
        "42",
        "",
        "Y",
      ],
      // Row 3: Inactive item with 'Y'
      [
        "",
        "005555",
        "Discontinued Omega 3",
        "200 Softgels",
        "Webber Naturals",
        "WN-55",
        "Brand B",
        "8.00",
        "16.99",
        "Oils",
        "Supplements",
        "0",
        "Y",
        "N",
      ],
      // Row 4: Active item with 'N'
      [
        "",
        "777888",
        "Magnesium Bisglycinate",
        "120 Vegi Caps",
        "CanPrev",
        "CP-77",
        "CanPrev",
        "14.20",
        "28.49",
        "Minerals",
        "Supplements",
        "15",
        "N",
        "Y",
      ],
      // Row 5: Active item with '0'
      [
        "",
        "999000",
        "Zinc Picolinate",
        "",
        "AOR",
        "AOR-99",
        "AOR",
        "9.10",
        "18.20",
        "Minerals",
        "Supplements",
        "5",
        "0",
        "Y",
      ],
    ];

    const result = cleanUnifiedPosMatrix(matrix);

    expect(result.success).toBe(true);
    expect(result.totalRecords).toBe(4);
    expect(result.activeCount).toBe(3);
    expect(result.inactiveCount).toBe(1);
    expect(result.emptyRowsRemoved).toBe(1); // Row 1 discarded

    // Item 1: 001234 (Active, leading zeros preserved, numeric formatted)
    const item1 = result.records[0];
    expect(item1.sku).toBe("001234");
    expect(item1.productNumber).toBe("00987");
    expect(item1.description).toBe("Vitamin C 1000mg");
    expect(item1.vendor).toBe("Natural Factors");
    expect(item1.brand).toBe("Brand A");
    expect(item1.listCost).toBe("12.50");
    expect(item1.price).toBe("24.99");
    expect(item1.sizeDesc).toBe("100 Tabs");
    expect(item1.isInactive).toBe(false);
    expect(item1.status).toBe("Active");

    // Item 2: 005555 (Inactive with 'Y')
    const item2 = result.records[1];
    expect(item2.sku).toBe("005555");
    expect(item2.isInactive).toBe(true);
    expect(item2.status).toBe("Inactive");

    // Item 3: 777888 (Active with 'N')
    const item3 = result.records[2];
    expect(item3.sku).toBe("777888");
    expect(item3.isInactive).toBe(false);
    expect(item3.status).toBe("Active");

    // Item 4: 999000 (Active with '0', blank Size Desc preserved)
    const item4 = result.records[3];
    expect(item4.sku).toBe("999000");
    expect(item4.sizeDesc).toBe("");
    expect(item4.isInactive).toBe(false);
    expect(item4.status).toBe("Active");
  });

  it("identifies duplicate SKUs and flags them", () => {
    const matrix: unknown[][] = [
      ["Sku", "Product Number", "Description", "Vendor", "Brand", "List Cost", "Price", "Size Desc", "INACTIVE"],
      ["SKU-DUP", "PN-1", "Product First", "V1", "B1", "10", "20", "100g", ""],
      ["SKU-DUP", "PN-2", "Product Duplicate", "V1", "B1", "12", "22", "100g", "Y"],
    ];

    const result = cleanUnifiedPosMatrix(matrix);
    expect(result.success).toBe(true);
    expect(result.records).toHaveLength(2);
    expect(result.duplicateCount).toBe(2);
    expect(result.records[0].isDuplicate).toBe(true);
    expect(result.records[1].isDuplicate).toBe(true);
  });

  it("stops and reports missing columns when a required column is absent", () => {
    const matrix: unknown[][] = [
      ["Sku", "Description", "Vendor", "Brand", "List Cost", "Price", "Size Desc"], // INACTIVE and Product Number missing
      ["SKU-1", "Desc", "V", "B", "1", "2", "100g"],
    ];

    const result = cleanUnifiedPosMatrix(matrix);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Required column(s) missing");
    expect(result.missingColumns).toContain("Product Number");
    expect(result.missingColumns).toContain("INACTIVE");
    expect(result.records).toHaveLength(0);
  });
});

describe("parseAndCleanUnifiedPosFile with SheetJS workbook", () => {
  it("correctly parses raw ArrayBuffer into cleaned records", () => {
    const aoa = [
      ["", "Sku", "Product Number", "Description", "Vendor", "Brand", "List Cost", "Price", "Size Desc.", "INACTIVE"],
      ["", "", "", "", "", "", "", "", "", ""],
      ["", "004321", "PN-10", "Test Product", "Test Vendor", "Test Brand", "$15.00", "$30.00", "500 ml", " y "],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const result = parseAndCleanUnifiedPosFile(buffer);
    expect(result.success).toBe(true);
    expect(result.totalRecords).toBe(1);
    expect(result.records[0].sku).toBe("004321");
    expect(result.records[0].isInactive).toBe(true);
    expect(result.records[0].status).toBe("Inactive");
  });
});

