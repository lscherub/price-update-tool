import { describe, expect, it } from "vitest";
import { getItemFlags, flagsText, parseSortParam, sortItems } from "@/lib/itemSort";

const rows = [
  { id: "1", brand: "Zebra", nearest9: "22.99", matched: true, oldRetailPrice: "21.99" },
  { id: "2", brand: "apple", nearest9: "19.79", matched: true, oldRetailPrice: "19.79" },
  { id: "3", brand: "Mango", nearest9: null, matched: false, oldRetailPrice: null },
];

describe("getItemFlags", () => {
  it("identifies distinct flags correctly", () => {
    expect(getItemFlags({ matched: false })).toEqual(["Not Found"]);
    expect(getItemFlags({ matched: true, isInactive: true })).toEqual(["Inactive"]);
    expect(getItemFlags({ matched: true, cleanedOverridden: true })).toEqual(["Manual SKU"]);
    expect(getItemFlags({ matched: true, nearest9Custom: "15.99" })).toEqual(["Custom"]);
    expect(getItemFlags({ matched: true, nearest9: "19.99", oldRetailPrice: "17.99" })).toEqual(["Changed"]);
    expect(getItemFlags({ matched: true, nearest9: "19.99", oldRetailPrice: "19.99" })).toEqual(["No change"]);
  });

  it("handles multiple flags simultaneously on a single row", () => {
    const multi = {
      matched: true,
      isInactive: true,
      cleanedOverridden: true,
      nearest9Custom: "14.99",
      nearest9: "14.99",
      oldRetailPrice: "12.99",
    };
    expect(getItemFlags(multi)).toEqual(["Inactive", "Manual SKU", "Custom", "Changed"]);
    expect(flagsText(multi)).toBe("Inactive, Manual SKU, Custom, Changed");
  });
});

describe("item sorting", () => {
  it("sorts text A->Z and Z->A", () => {
    expect(sortItems(rows, "brand", "asc").map((r) => r.id)).toEqual(["2", "3", "1"]);
    expect(sortItems(rows, "brand", "desc").map((r) => r.id)).toEqual(["1", "3", "2"]);
  });

  it("sorts numbers with blanks last", () => {
    expect(sortItems(rows, "nearest9", "asc").map((r) => r.id)).toEqual(["2", "1", "3"]);
    expect(sortItems(rows, "nearest9", "desc").map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("sorts by flags text and rejects bad descriptors", () => {
    expect(flagsText(rows[0])).toBe("Changed");
    expect(flagsText(rows[2])).toBe("Not Found");
    expect(parseSortParam("nope", "asc")).toBeNull();
    expect(parseSortParam("brand", "sideways")).toBeNull();
    expect(sortItems(rows, "nope", "asc")).toBe(rows);
    expect(sortItems(rows, null, null)).toBe(rows);
  });
});
