import { describe, it, expect } from "vitest";
import {
  POS_OUTPUT_COLUMNS,
  findPosHeaderRow,
  normalizePosHeader,
  validateAndExtractPosRows,
  buildCleanedPosWorkbook,
  generateCleanedPosFilename,
} from "../src/lib/posCleaner";
import * as XLSX from "xlsx";

describe("posCleaner", () => {
  it("normalizes headers correctly", () => {
    expect(normalizePosHeader("  Sku  ")).toBe("sku");
    expect(normalizePosHeader("Product\u00a0Number")).toBe("product number");
    expect(normalizePosHeader("Size   Desc")).toBe("size desc");
  });

  it("finds header row within the first 15 rows", () => {
    const matrix = [
      ["Title", "Amber Export Report"],
      ["Date", "2026-10-29"],
      ["", ""],
      ["Sku", "Description", "Price"],
    ];
    const info = findPosHeaderRow(matrix);
    expect(info).not.toBeNull();
    expect(info?.index).toBe(3);
  });

  it("fails to find header if after row 15", () => {
    const matrix = Array(16).fill(["junk", "junk"]);
    matrix.push(["Sku", "Description"]);
    expect(findPosHeaderRow(matrix)).toBeNull();
  });

  it("fails validation if required columns are missing and identifies missing columns", () => {
    const matrix = [
      ["Sku", "Description", "Vendor", "Brand"],
      ["1001", "Whey Protein", "Vendor A", "Brand X"],
    ];
    const res = validateAndExtractPosRows(matrix);
    expect(res.success).toBe(false);
    expect(res.missingColumns).toContain("Product Number");
    expect(res.missingColumns).toContain("List Cost");
    expect(res.missingColumns).toContain("Price");
    expect(res.missingColumns).toContain("Size Desc");
    expect(res.foundColumns["Sku"]).toBe(0);
    expect(res.foundColumns["Description"]).toBe(1);
  });

  it("successfully extracts columns regardless of original column order", () => {
    const header = [
      "Vendor",
      "Sku",
      "Brand",
      "List Cost",
      "Extra Col",
      "Description",
      "Size Desc",
      "Price",
      "Product Number",
    ];
    const row1 = [
      "Vendor A",
      "001234",
      "Brand X",
      "12.50",
      "ignored",
      "Creatine Monohydrate 500g",
      "500g",
      "24.99",
      "PN-998",
    ];
    const row2 = [
      "Vendor B",
      "005678",
      "Brand Y",
      "8.00",
      "ignored",
      "Glutamine 300g",
      "300g",
      "16.99",
      "PN-101",
    ];
    const emptyRow = ["", "", "", "", "", "", "", "", ""];

    const res = validateAndExtractPosRows([header, row1, row2, emptyRow]);
    expect(res.success).toBe(true);
    expect(res.totalProducts).toBe(2);
    expect(res.rows[0]["Sku"]).toBe("001234");
    expect(res.rows[0]["Product Number"]).toBe("PN-998");
    expect(res.rows[0]["Description"]).toBe("Creatine Monohydrate 500g");
    expect(res.rows[0]["Vendor"]).toBe("Vendor A");
    expect(res.rows[0]["Brand"]).toBe("Brand X");
    expect(res.rows[0]["List Cost"]).toBe("12.50");
    expect(res.rows[0]["Price"]).toBe("24.99");
    expect(res.rows[0]["Size Desc"]).toBe("500g");

    expect(res.rows[1]["Sku"]).toBe("005678");
  });

  it("builds clean workbook with exact 8 columns", () => {
    const rows = [
      {
        Sku: "001234",
        "Product Number": "PN-998",
        Description: "Creatine 500g",
        Vendor: "Vendor A",
        Brand: "Brand X",
        "List Cost": "12.50",
        Price: "24.99",
        "Size Desc": "500g",
      },
    ];
    const wb = buildCleanedPosWorkbook(rows);
    expect(wb.SheetNames).toEqual(["Cleaned POS"]);
    const sheet = wb.Sheets["Cleaned POS"];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    expect(json[0]).toEqual([...POS_OUTPUT_COLUMNS]);
    expect(json[1]).toEqual([
      "001234",
      "PN-998",
      "Creatine 500g",
      "Vendor A",
      "Brand X",
      "12.50",
      "24.99",
      "500g",
    ]);
  });

  it("generates filename formatted properly", () => {
    const date = new Date("2026-10-29T12:00:00Z");
    expect(generateCleanedPosFilename("Amber POS Export (1).xlsx", date)).toBe(
      "Amber_POS_Export_1_Cleaned_2026-10-29.xlsx"
    );
    expect(generateCleanedPosFilename("", date)).toBe("Genesis_POS_Cleaned_2026-10-29.xlsx");
  });
});

