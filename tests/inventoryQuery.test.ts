import { describe, expect, it } from "vitest";
import {
  buildInventoryOrderBy,
  buildInventoryWhere,
  matchesInventoryFilters,
  parseInventoryQuery,
  parseInventorySort,
  sortInventoryRows,
  type InventoryQuery,
} from "@/lib/inventoryQuery";

const base: InventoryQuery = {
  q: "", sku: "", productNumber: "", description: "",
  vendor: "", brand: "", vendorExact: "", brandExact: "",
  inactive: "", sort: "", sortDir: "",
};

const prod = (over: Record<string, unknown> = {}) => ({
  sku: "62882600507", normalizedSku: "62882600507", productNumber: "PN-1",
  description: "Active Formula Caps", vendor: "AOR", brand: "Natural Factors",
  isInactive: false, listCost: "10.00", price: "19.99", sizeDesc: "60 caps",
  ...over,
});

describe("parseInventoryQuery — legacy params keep working", () => {
  it("maps q/page params and the legacy vendor exact param", () => {
    const q = parseInventoryQuery(new URLSearchParams("q=62882600507&vendor=AOR&inactive=true"));
    expect(q.q).toBe("62882600507");
    expect(q.vendorExact).toBe("AOR");
    expect(q.inactive).toBe("true");
  });
});

describe("buildInventoryWhere — global search AND column filters", () => {
  it("global search spans all columns (existing behavior)", () => {
    const w = buildInventoryWhere({ ...base, q: "62882600507" }) as { AND: { OR: unknown[] }[] };
    expect(w.AND).toHaveLength(1);
    expect(w.AND[0].OR).toHaveLength(6);
  });
  it("a vendor column filter searches ONLY the vendor column", () => {
    const w = buildInventoryWhere({ ...base, vendor: "Active" }) as unknown as { AND: Record<string, unknown>[] };
    expect(w.AND).toHaveLength(1);
    expect(w.AND[0]).toEqual({ vendor: { contains: "Active", mode: "insensitive" } });
    // "Active" in vendor must NOT match a product whose brand merely contains it.
    expect(matchesInventoryFilters(prod({ vendor: "OTHER", brand: "ACTIVE BRAND" }), { ...base, vendor: "Active" })).toBe(false);
    expect(matchesInventoryFilters(prod({ vendor: "ACTIVE SUPPLY" }), { ...base, vendor: "Active" })).toBe(true);
  });
  it("multiple column filters combine with AND", () => {
    const f: InventoryQuery = { ...base, vendorExact: "AOR", inactive: "false" };
    expect(matchesInventoryFilters(prod(), f)).toBe(true);
    expect(matchesInventoryFilters(prod({ vendor: "OTHER" }), f)).toBe(false);
    expect(matchesInventoryFilters(prod({ isInactive: true }), f)).toBe(false);
    expect(matchesInventoryFilters(prod({ brand: "Natural Factors", isInactive: true }), { ...base, brandExact: "Natural Factors", inactive: "true" })).toBe(true);
  });
  it("status filter: All shows both, Active/Inactive narrow correctly", () => {
    expect(matchesInventoryFilters(prod({ isInactive: false }), { ...base, inactive: "" })).toBe(true);
    expect(matchesInventoryFilters(prod({ isInactive: true }), { ...base, inactive: "" })).toBe(true);
    expect(matchesInventoryFilters(prod({ isInactive: false }), { ...base, inactive: "false" })).toBe(true);
    expect(matchesInventoryFilters(prod({ isInactive: true }), { ...base, inactive: "false" })).toBe(false);
    expect(matchesInventoryFilters(prod({ isInactive: true }), { ...base, inactive: "true" })).toBe(true);
    expect(matchesInventoryFilters(prod({ isInactive: false }), { ...base, inactive: "true" })).toBe(false);
  });
});

describe("sorting — column dropdowns", () => {
  it("accepts known columns and rejects unknown ones", () => {
    expect(parseInventorySort("vendor", "asc")).toEqual({ key: "vendor", dir: "asc" });
    expect(parseInventorySort("nope", "asc")).toBeNull();
    expect(parseInventorySort("vendor", "sideways")).toBeNull();
  });
  it("maps status to isInactive ordering", () => {
    expect(buildInventoryOrderBy("status", "asc")).toEqual({ isInactive: "asc" });
    expect(buildInventoryOrderBy("", "")).toEqual({ sku: "asc" });
  });
  it("vendor A→Z then Z→A, product name Z→A", () => {
    const rows = [prod({ vendor: "Zebra" }), prod({ vendor: "AOR" }), prod({ vendor: "Medi" })];
    expect(sortInventoryRows(rows, "vendor", "asc").map((r) => r.vendor)).toEqual(["AOR", "Medi", "Zebra"]);
    expect(sortInventoryRows(rows, "vendor", "desc").map((r) => r.vendor)).toEqual(["Zebra", "Medi", "AOR"]);
    const names = [prod({ description: "Apple" }), prod({ description: "Zinc" })];
    expect(sortInventoryRows(names, "description", "desc").map((r) => r.description)).toEqual(["Zinc", "Apple"]);
  });
});
