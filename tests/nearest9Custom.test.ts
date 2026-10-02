import { describe, expect, it, vi } from "vitest";
import { resolveNearest9 } from "@/lib/nearest9";
import { recalcRow, type CurRow } from "@/lib/recalc";
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
});
