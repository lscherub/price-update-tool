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
  const cases: [string, string][] = [
    ["58.03", "58.09"],
    ["58.07", "58.09"],
    ["58.09", "57.99"],
    ["58.12", "58.09"],
    ["58.15", "58.19"],
    ["14.09", "13.99"],
    ["77.09", "76.99"],
  ];
  for (const [input, expected] of cases) {
    it(`${input} -> ${expected}`, () => {
      expect(calcNearest9(input)).toBe(expected);
    });
  }
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
