import { describe, expect, it, vi } from "vitest";
import { resolveNearest9 } from "@/lib/nearest9";
import { recalcRow, type CurRow } from "@/lib/recalc";
import { resolveDefaultDiscount, type DiscountMaps } from "@/lib/lookup";
import { storeCountNewPrice } from "@/app/api/sessions/[id]/storecount/route";

// Force the local (empty) file store so these stay fast, hermetic calculation
// tests — no database needed to prove the override rules.
vi.mock("@/lib/db", () => ({ getPrisma: () => null }));

/**
 * Final Nearest 9 = Custom Nearest 9 when the user entered one, otherwise the
 * automatic Nearest 9 calculation (unchanged). These tests pin that rule and
 * the guarantee that a custom value survives recalculations of other fields.
 */
describe("resolveNearest9 (Calculated vs Custom)", () => {
  it("uses the calculated value when there is no custom override", () => {
    expect(resolveNearest9("62.29", null)).toBe("62.29");
    expect(resolveNearest9("62.29", undefined)).toBe("62.29");
    expect(resolveNearest9("62.29", "")).toBe("62.29");
    expect(resolveNearest9("62.29", "   ")).toBe("62.29");
  });

  it("prefers the custom value when the user entered one", () => {
    expect(resolveNearest9("62.29", "61.99")).toBe("61.99");
    expect(resolveNearest9("62.29", "62.49")).toBe("62.49");
    // A custom value also wins when there is nothing to calculate.
    expect(resolveNearest9(null, "12.99")).toBe("12.99");
  });

  it("returns null when nothing is available", () => {
    expect(resolveNearest9(null, null)).toBeNull();
    expect(resolveNearest9(null, "")).toBeNull();
  });
});

/** Map a recalc result back into the "current row" shape the next recalc reads. */
function toCur(r: Awaited<ReturnType<typeof recalcRow>>): CurRow {
  return {
    rawVendorSku: r.rawVendorSku, cleanedSku: r.cleanedSku, cleanedOverridden: r.cleanedOverridden,
    discount: r.discount, vendorListPriceNew: r.vendorListPriceNew, marginDivisor: r.marginDivisor,
    notes: r.notes, nearest9Custom: r.nearest9Custom,
  };
}

// A SKU that is deliberately absent from inventory, so this stays a pure
// calculation test (auto pricing, no product match).
const SEED: CurRow = {
  rawVendorSku: "ZZNOTFOUNDSKU9X", cleanedSku: "", cleanedOverridden: false,
  discount: "0.00", vendorListPriceNew: null, marginDivisor: "", notes: "",
};

describe("recalcRow Nearest 9 override", () => {
  it("calculates Nearest 9 automatically and stores no custom value", async () => {
    const auto = await recalcRow(SEED, { vendorListPriceNew: "10.00" });
    // 10.00 / 0.605 -> 16.5289 -> nearest .x9 price
    expect(auto.nearest9).toBe("16.49");
    expect(auto.nearest9Custom).toBeNull();
  });

  it("keeps a custom Nearest 9 when other fields are recalculated", async () => {
    const auto = await recalcRow(SEED, { vendorListPriceNew: "10.00" });
    const custom = await recalcRow(toCur(auto), { nearest9: "61.99" });
    expect(custom.nearest9Custom).toBe("61.99");
    expect(custom.nearest9).toBe("61.99");

    // Changing the discount recalculates auto pricing (10% off 10.00 -> 14.89)
    // but the user's custom Nearest 9 must survive.
    const afterEdit = await recalcRow(toCur(custom), { discount: "10" });
    expect(afterEdit.ourNewRetailPrice).toBe("14.8760");
    expect(afterEdit.nearest9Custom).toBe("61.99");
    expect(afterEdit.nearest9).toBe("61.99");

    // Editing unrelated fields (notes) must not disturb it either.
    const afterNotes = await recalcRow(toCur(afterEdit), { notes: "hello" });
    expect(afterNotes.nearest9Custom).toBe("61.99");
    expect(afterNotes.nearest9).toBe("61.99");
  });

  it("returns to the automatic calculation when the custom value is cleared", async () => {
    const auto = await recalcRow(SEED, { vendorListPriceNew: "10.00" });
    const custom = await recalcRow(toCur(auto), { nearest9: "61.99" });
    const afterEdit = await recalcRow(toCur(custom), { discount: "10" });

    const cleared = await recalcRow(toCur(afterEdit), { nearest9: "" });
    expect(cleared.nearest9Custom).toBeNull();
    expect(cleared.nearest9).toBe("14.89");

    // ...and the automatic value keeps tracking later edits.
    const later = await recalcRow(toCur(cleared), { vendorListPriceNew: "20.00" });
    expect(later.nearest9Custom).toBeNull();
    expect(later.nearest9).toBe("29.79");
  });
});

describe("flags + store count PDF use the FINAL Nearest 9", () => {
  const oldRetail = "61.99";
  const calculated = "62.29";

  it("custom equal to Old Retail -> No change -> blank New Price", () => {
    const final9 = resolveNearest9(calculated, "61.99");
    const flag = final9 === oldRetail ? "No change" : "Changed";
    expect(flag).toBe("No change");
    expect(storeCountNewPrice(final9, oldRetail)).toBe("");
  });

  it("custom different from Old Retail -> Changed -> custom New Price", () => {
    const final9 = resolveNearest9(calculated, "62.49");
    const flag = final9 === oldRetail ? "No change" : "Changed";
    expect(flag).toBe("Changed");
    expect(storeCountNewPrice(final9, oldRetail)).toBe("62.49");
  });

  it("no custom value -> calculated value drives flag and New Price", () => {
    const final9 = resolveNearest9(calculated, null);
    const flag = final9 === oldRetail ? "No change" : "Changed";
    expect(flag).toBe("Changed");
    expect(storeCountNewPrice(final9, oldRetail)).toBe("62.29");
  });

describe("brand-first discount lookup (Vendor + Brand priority)", () => {
  const maps: DiscountMaps = {
    vendors: new Map([["ecotrend", "10.00"], ["a.o.r. inc.", "10.00"]]),
    brands: new Map([
      ["ecotrend|provita", "5.00"],
      ["ecotrend|sierrasil health", "8.00"],
      // Same brand under a different vendor is a separate row.
      ["other vendor|provita", "3.00"],
    ]),
  };
  it("uses the exact Vendor+Brand override first", () => {
    expect(resolveDefaultDiscount(maps, "Ecotrend", "Provita")).toBe("5.00");
    expect(resolveDefaultDiscount(maps, "ECOTREND", "Sierrasil Health")).toBe("8.00");
  });
  it("falls back to the vendor default for unconfigured brands", () => {
    expect(resolveDefaultDiscount(maps, "Ecotrend", "Ecotrend")).toBe("10.00");
    expect(resolveDefaultDiscount(maps, "Ecotrend", "An unconfigured brand")).toBe("10.00");
  });
  it("never applies another vendor's brand discount (exact Vendor+Brand pair)", () => {
    expect(resolveDefaultDiscount(maps, "Other Vendor", "Provita")).toBe("3.00");
    expect(resolveDefaultDiscount(maps, "Ecotrend", "Provita")).toBe("5.00");
  });
  it("returns 0% when neither brand nor vendor is configured", () => {
    expect(resolveDefaultDiscount(maps, "Unknown Vendor", "Any Brand")).toBe("0.00");
    expect(resolveDefaultDiscount(maps, "", "")).toBe("0.00");
  });
});

describe("recalcRow discount override preservation", () => {
  // Store-backed recalc: vendor/brand identity comes from the caller's stored
  // row values (no DB needed — SEED is unmatched so defaults are "0.00").
  const auto = (discount: string): CurRow => ({
    rawVendorSku: "ZZNOTFOUNDSKU9X", cleanedSku: "", cleanedOverridden: false,
    discount, vendorListPriceNew: null, marginDivisor: "", notes: "",
    vendor: "", brand: "",
  });
  it("keeps a manual discount override when unrelated fields change", async () => {
    const manual = await recalcRow(auto("0.00"), { discount: "25" });
    expect(manual.discount).toBe("25.00");
    const after = await recalcRow(
      { ...auto(manual.discount), vendorListPriceNew: manual.vendorListPriceNew, marginDivisor: manual.marginDivisor, notes: manual.notes, nearest9Custom: manual.nearest9Custom },
      { vendorListPriceNew: "20.00" },
    );
    expect(after.discount).toBe("25.00");
    expect(after.ourNewListPrice).toBe("15.00");
  });
  it("restores the automatic default when the discount cell is cleared", async () => {
    const manual = await recalcRow(auto("0.00"), { discount: "25" });
    const cleared = await recalcRow(
      { ...auto(manual.discount), vendorListPriceNew: manual.vendorListPriceNew, marginDivisor: manual.marginDivisor, notes: manual.notes, nearest9Custom: manual.nearest9Custom },
      { discount: "" },
    );
    expect(cleared.discount).toBe("0.00");
  });
});

});
