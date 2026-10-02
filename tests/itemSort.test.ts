import { describe, expect, it } from "vitest";
import { flagsText, parseSortParam, sortItems } from "@/lib/itemSort";

const rows = [
  { id: "1", brand: "Zebra", nearest9: "22.99", matched: true, oldRetailPrice: "21.99" },
  { id: "2", brand: "apple", nearest9: "19.79", matched: true, oldRetailPrice: "19.79" },
  { id: "3", brand: "Mango", nearest9: null, matched: false, oldRetailPrice: null },
];

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
