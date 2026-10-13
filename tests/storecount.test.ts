import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { storeCountNewPrice } from "@/app/api/sessions/[id]/storecount/route";
import {
  buildStoreCountWorkbook,
  STORE_COUNT_EXCEL_HEADER,
  storeCountExcelPrice,
} from "@/app/api/sessions/[id]/storecount/excel/route";


describe("store count PDF New Price rule", () => {
  it("leaves New Price blank when Nearest 9 equals Old Retail", () => {
    expect(storeCountNewPrice("61.99", "61.99")).toBe("");
  });

  it("shows Nearest 9 when it differs from Old Retail", () => {
    expect(storeCountNewPrice("62.29", "61.99")).toBe("62.29");
  });

describe("store count Excel price rule (never blank when a price exists)", () => {
  it("uses the new retail price when the price changed", () => {
    expect(storeCountExcelPrice("62.29", "61.99")).toBe("62.29");
  });

  it("falls back to the current retail price when unchanged (PDF blanks here)", () => {
    expect(storeCountExcelPrice("61.99", "61.99")).toBe("61.99");
    // The PDF rule blanks this case — the Excel rule must not.
    expect(storeCountNewPrice("61.99", "61.99")).toBe("");
  });

  it("uses the current retail price when there is no new price", () => {
    expect(storeCountExcelPrice(null, "61.99")).toBe("61.99");
    expect(storeCountExcelPrice("", "61.99")).toBe("61.99");
  });

  it("uses the new price when there is no current price", () => {
    expect(storeCountExcelPrice("62.29", null)).toBe("62.29");
  });

  it("is blank only when neither price exists", () => {
    expect(storeCountExcelPrice(null, null)).toBe("");
  });
});

describe("store count Excel workbook (SKU/price association)", () => {
  it("builds a valid .xlsx with the Store Count columns and correct SKU-price pairs", () => {
    const buf = buildStoreCountWorkbook([
      { cleanedSku: "SKU-CHANGED", productName: "Changed Product", sizeDesc: "60VSG", price: "62.29" },
      { cleanedSku: "SKU-SAME", productName: "Unchanged Product", sizeDesc: "30CAP", price: "61.99" },
    ]);
    // A real workbook (ZIP magic), not a renamed CSV.
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets["Store Count"];
    expect(ws).toBeDefined();
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });
    expect(aoa[0]).toEqual([...STORE_COUNT_EXCEL_HEADER]);
    // Every row keeps its own SKU -> price association, in order.
    expect(aoa[1]).toEqual(["SKU-CHANGED", "Changed Product", "60VSG", "62.29", "", "", ""]);
    expect(aoa[2]).toEqual(["SKU-SAME", "Unchanged Product", "30CAP", "61.99", "", "", ""]);
  });
});


  it("handles missing values without new calculation", () => {
    expect(storeCountNewPrice(null, "61.99")).toBe("");
    expect(storeCountNewPrice("62.29", null)).toBe("62.29");
    expect(storeCountNewPrice("61.9", "61.90")).toBe("");
  });
});
