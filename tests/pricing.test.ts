import { describe, expect, it } from "vitest";
import {
  calcOurNewListPrice,
  calcOurNewRetailPrice,
  normalizeSku,
  skuCandidates,
} from "@/lib/pricing";
import { calcNearest9, calculateRow } from "@/lib/nearest9";
import { cellText, parseInactiveFile, parsePastedVendorData, parseVendorFile } from "@/lib/importers";
import { productionDbGuard } from "@/lib/db";

describe("SKU cleaning", () => {
  it("cleans '0 58854 04522 7' -> '05885404522'", () => {
    expect(normalizeSku("0 58854 04522 7")).toBe("05885404522");
  });
  it("removes hyphens and trims", () => {
    expect(normalizeSku("  624-917-74008-0 ")).toBe("62491774008");
  });
  it("keeps leading zeros as string", () => {
    expect(normalizeSku("05885404522X")).toBe("05885404522");
  });
  it("candidates include fallback keys", () => {
    expect(skuCandidates("0 58854 04522 7")).toContain("05885404522");
  });
});

describe("vendor discount", () => {
  it("20.00 with 10% -> 18.00", () => {
    expect(calcOurNewListPrice("20.00", "10")).toBe("18.00");
  });
  it("missing discount -> 0", () => {
    expect(calcOurNewListPrice("20.00", null)).toBe("20.00");
  });
});

describe("margin divisor", () => {
  it("default divisor 0.605", () => {
    expect(calcOurNewRetailPrice("18.00", null)).toBe("29.7521");
  });
  it("custom divisor", () => {
    expect(calcOurNewRetailPrice("18.00", "0.5")).toBe("36.0000");
  });
});

describe("nearest 9", () => {
  // Every example required by the spec, verbatim.
  const cases: [string, string][] = [
    ["33.7355", "33.69"],
    ["62.0992", "61.99"],
    ["49.2397", "49.19"],
    ["58.03", "57.99"],
    ["58.07", "57.99"],
    ["58.09", "57.99"],
    ["58.12", "57.99"],
    ["58.15", "58.19"],
    ["63.24", "63.19"],
    ["54.65", "54.69"],
    ["54.63", "54.59"],
    ["54.19", "54.19"],
    ["54.09", "53.99"],
    ["54.12", "53.99"],
    ["54.15", "54.19"],
    ["54.17", "54.19"],
    // Midpoint rounds up mathematically.
    ["33.75", "33.79"],
    ["33.76", "33.79"],
    // The stated price-point lattice.
    ["33.69", "33.69"],
    ["33.79", "33.79"],
    ["33.89", "33.89"],
    ["33.99", "33.99"],
    ["34.19", "34.19"],
    // Legacy cases that must keep working.
    ["14.09", "13.99"],
    ["77.09", "76.99"],
  ];
  for (const [input, expected] of cases) {
    it(`${input} -> ${expected}`, () => {
      expect(calcNearest9(input)).toBe(expected);
    });
  }

  it("regression: no 2-cent pre-offset (33.7355 must not round up to 33.79)", () => {
    // The old `value + 0.02` offset pushed this across the midpoint.
    expect(calcNearest9("33.7355")).toBe("33.69");
    expect(calcNearest9("49.2397")).toBe("49.19");
    expect(calcNearest9("63.24")).toBe("63.19");
  });

  it("always lands on a price ending in 9 cents", () => {
    for (let c = 3300; c <= 3600; c++) {
      expect(calcNearest9((c / 100).toFixed(2))?.endsWith("9")).toBe(true);
    }
  });

  it("is monotonic and idempotent across a whole dollar", () => {
    let prev = -Infinity;
    for (let c = 3300; c <= 3600; c++) {
      const input = (c / 100).toFixed(2);
      const r = calcNearest9(input) as string;
      expect(Number(r)).toBeGreaterThanOrEqual(prev);
      // Re-applying to a price point must not move it again.
      expect(calcNearest9(r)).toBe(r);
      prev = Number(r);
    }
  });

  it("steps by 10 cents across a dollar boundary (33.99 -> 34.19)", () => {
    expect(calcNearest9("33.99")).toBe("33.99");
    expect(calcNearest9("34.19")).toBe("34.19");
  });

  it("applies the .09 rule to an exact .09 and its neighbourhood", () => {
    // The .09 tier resolves down, so everything up to the 54.145 midpoint
    // collapses to the previous .99; only above it does .19 win.
    expect(calcNearest9("54.08")).toBe("53.99");
    expect(calcNearest9("54.09")).toBe("53.99");
    expect(calcNearest9("54.12")).toBe("53.99");
    expect(calcNearest9("54.14")).toBe("53.99");
    expect(calcNearest9("54.15")).toBe("54.19");
  });

  it("handles null, blank and unparseable input", () => {
    expect(calcNearest9(null)).toBeNull();
    expect(calcNearest9(undefined)).toBeNull();
    expect(calcNearest9("")).toBeNull();
    expect(calcNearest9("abc")).toBeNull();
  });

  it("strips currency formatting", () => {
    expect(calcNearest9("$33.7355")).toBe("33.69");
    expect(calcNearest9("33.74")).toBe("33.69");
  });

  it("never returns a negative price", () => {
    expect(calcNearest9("0.01")).toBe("0.00");
    expect(calcNearest9("0.00")).toBe("0.00");
  });
});

describe("importers: SKU text + paste parsing", () => {
  it("paste parser splits tab/comma/space price pairs", () => {
    expect(parsePastedVendorData("0 58854 04522 7\t19.99\n624-917-74008-0, 24.50")).toEqual([
      { raw: "0 58854 04522 7", price: "19.99" },
      { raw: "624-917-74008-0", price: "24.50" },
    ]);
  });
  it("cellText keeps numeric SKUs as plain text (no exponent)", () => {
    expect(cellText(62491774008)).toBe("62491774008");
    expect(cellText(" 05885404522 ")).toBe("05885404522");
    expect(cellText(null)).toBe("");
  });
  it("parseVendorFile reads CSV buffer with sku/price mapping", () => {
    const csv = "Vendor SKU,New Price\n0 58854 04522 7,12.00\n624-917-74008-0,24.50\n";
    const { rows } = parseVendorFile(Buffer.from(csv), "vendor.csv");
    expect(rows).toEqual([
      { raw: "0 58854 04522 7", price: "12.00" },
      { raw: "624-917-74008-0", price: "24.50" },
    ]);
  });
  it("parseInactiveFile reads first-column SKU list", () => {
    const csv = "Sku\n62491774008\n62491774007\n";
    expect(parseInactiveFile(Buffer.from(csv))).toEqual(["62491774008", "62491774007"]);
  });
});

describe("auth/db guards", () => {
  it("productionDbGuard returns 503 in production without DATABASE_URL", async () => {
    const prevNode = (process.env as Record<string, string | undefined>).NODE_ENV;
    const prevDb = process.env.DATABASE_URL;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete (process.env as Record<string, string | undefined>).DATABASE_URL;
    const res = productionDbGuard(null);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toBe("DatabaseUnavailable");
    if (prevNode === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string | undefined>).NODE_ENV = prevNode;
    if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
  });
  it("productionDbGuard passes through when prisma exists", () => {
    expect(productionDbGuard({} as never)).toBeNull();
  });
});

describe("full row", () => {
  it("computes row with discount and divisor", () => {
    const r = calculateRow({
      rawVendorSku: "624917740080",
      vendorListPriceNew: "20.00",
      product: {
        productNumber: "AOR74008", description: "NA VIT K2 SOFTGEL",
        brand: "AOR", vendor: "A.O.R. INC.", listCost: "19.66", price: "31.70",
      },
      defaultDiscount: "10",
    });
    expect(r.ourNewListPrice).toBe("18.00");
    expect(r.matched).toBe(true);
  });
  it("inactive product still calculates but flags inactive", () => {
    const r = calculateRow({
      rawVendorSku: "X", vendorListPriceNew: "10",
      product: { description: "D", listCost: "5", price: "8", isInactive: true },
      defaultDiscount: "0",
    });
    expect(r.matched).toBe(true);
    expect(r.isInactive).toBe(true);
    expect(r.ourNewListPrice).toBe("10.00");
  });
  it("unmatched does not crash", () => {
    const r = calculateRow({ rawVendorSku: "NOPE1", vendorListPriceNew: "10", product: null, defaultDiscount: "0" });
    expect(r.matched).toBe(false);
    expect(r.ourNewListPrice).toBe("10.00");
  });
  it("manual cleaned override survives", () => {
    const r = calculateRow({
      rawVendorSku: "AAAA0", cleanedSku: "CUSTOM1", cleanedOverridden: true,
      vendorListPriceNew: "10", product: null, defaultDiscount: "0",
    });
    expect(r.cleanedSku).toBe("CUSTOM1");
  });
});
