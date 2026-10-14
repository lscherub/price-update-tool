import { describe, expect, it } from "vitest";
import {
  buildDiscountMaps,
  calculateSingleItem,
  calculateUnitFromBox,
  calcPerUnitList,
  divisorFromMargin,
  divisorFromMarkup,
  resolveDiscountWithSource,
  roundRetailPrice,
  validateBoxInputs,
} from "@/lib/calculator";
import { calcNearest9, calculateRow } from "@/lib/nearest9";

function maps() {
  return buildDiscountMaps(
    [{ vendor: "Ecotrend", discount: "10.00" }],
    [{ vendor: "Ecotrend", brand: "Provita", discount: "5.00" }],
  );
}

describe("calculator discount resolution (worksheet rule)", () => {
  it("prefers the brand-specific rule", () => {
    const m = maps();
    expect(resolveDiscountWithSource(m.vendors, m.brands, "Ecotrend", "Provita")).toEqual({
      discount: "5.00",
      source: "brand",
    });
  });
  it("falls back to the vendor default", () => {
    const m = maps();
    expect(resolveDiscountWithSource(m.vendors, m.brands, "Ecotrend", "Other")).toEqual({
      discount: "10.00",
      source: "vendor",
    });
  });
  it("returns 0% with source none when unconfigured", () => {
    const m = maps();
    expect(resolveDiscountWithSource(m.vendors, m.brands, "Unknown", "X")).toEqual({
      discount: "0.00",
      source: "none",
    });
  });
});

describe("calculator pricing matches the worksheet", () => {
  it("single item equals calculateRow", () => {
    const single = calculateSingleItem({ listCost: "27.00", discountPct: "7", divisor: "0.605", rounding: "nearest9" });
    const row = calculateRow({
      rawVendorSku: "X",
      discount: "7",
      vendorListPriceNew: "27.00",
      marginDivisor: "0.605",
      product: null,
      defaultDiscount: "7",
    });
    expect(single.netCost).toBe(row.ourNewListPrice);
    expect(single.retailExact).toBe(row.ourNewRetailPrice);
    expect(single.retailRounded).toBe(row.nearest9);
  });
  it("box 24 x $24.00 -> $1.00 per unit before discount", () => {
    expect(calcPerUnitList("24.00", "24")).toBe("1.00");
  });
  it("box result is per-unit, not whole-box", () => {
    const box = calculateUnitFromBox({ boxPrice: "24.00", qtyPerBox: "24", discountPct: "10", divisor: "0.605" });
    const single = calculateSingleItem({ listCost: "1.00", discountPct: "10", divisor: "0.605", rounding: "nearest9" });
    expect(box.perUnitList).toBe("1.00");
    expect(box.netCost).toBe(single.netCost);
    expect(box.retailRounded).toBe(single.retailRounded);
    expect(box.retailRounded).toBe(calcNearest9(single.retailExact));
  });
  it("rejects bad box inputs", () => {
    expect(validateBoxInputs("", "")).not.toBeNull();
    expect(validateBoxInputs("24.00", "0")).not.toBeNull();
    expect(validateBoxInputs("24.00", "2.5")).not.toBeNull();
    expect(validateBoxInputs("24.00", "24")).toBeNull();
  });
  it("rounding methods", () => {
    expect(roundRetailPrice("16.53", "nearest9")).toBe(calcNearest9("16.53"));
    expect(roundRetailPrice("16.53", "99")).toBe("16.99");
    expect(roundRetailPrice("16.53", "95")).toBe("16.95");
    expect(roundRetailPrice("16.535", "exact")).toBe("16.54");
  });
  it("margin/markup imply divisors", () => {
    expect(divisorFromMargin("39.5")).toBe("0.6050");
    expect(divisorFromMarkup("65.2893")).toBe("0.6050");
    expect(divisorFromMargin("0")).toBeNull();
  });
});
