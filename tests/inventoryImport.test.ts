import { describe, expect, it } from "vitest";
import {
  MAX_BATCH_ROWS,
  buildUpsertSql,
  chunk,
  normalizeSkuList,
  parseAmount,
  prepareBatch,
} from "@/lib/inventoryImport";
import { formatUpdateName } from "@/lib/pricing";

const row = (sku: string, over: Record<string, unknown> = {}) => ({
  sku,
  productNumber: "PN-1",
  description: "Whey Protein",
  vendor: "A.O.R. INC.",
  brand: "BrandX",
  listCost: "10.5",
  price: "24.99",
  sizeDesc: "2 LB",
  ...over,
});

/** Deterministic id factory, so generated ids can be asserted. */
const idGen = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe("chunk", () => {
  it("splits 21,000 rows into batches of 1,000", () => {
    const rows = Array.from({ length: 21000 }, (_, i) => i);
    const batches = chunk(rows, MAX_BATCH_ROWS);
    expect(batches).toHaveLength(21);
    expect(batches[0]).toHaveLength(1000);
    expect(batches[20]).toHaveLength(1000);
    expect(batches.flat()).toHaveLength(21000);
  });

  it("rejects a non-positive size", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("parseAmount", () => {
  it("treats blank as zero, matching the legacy importer", () => {
    expect(parseAmount("", "Price")).toEqual({ ok: true, value: "0" });
    expect(parseAmount(null, "Price")).toEqual({ ok: true, value: "0" });
  });

  it("strips currency symbols and formats to 2dp", () => {
    expect(parseAmount("$1,234.5", "Price")).toEqual({ ok: true, value: "1234.50" });
  });

  it("fails a single bad value instead of aborting the import", () => {
    const r = parseAmount("abc", "Price");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("is not a number");
  });

  it("rejects values beyond NUMERIC(12,2)", () => {
    expect(parseAmount("99999999999", "Price").ok).toBe(false);
  });
});

describe("prepareBatch", () => {
  it("normalizes SKU, amounts and id/timestamps", () => {
    const { rows, failures } = prepareBatch([row("0588-5404522-7")], { makeId: idGen(), now: new Date("2026-10-01T00:00:00Z") });
    expect(failures).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].normalizedSku).toBe("05885404522");
    expect(rows[0].listCost).toBe("10.50");
    expect(rows[0].id).toBe("id-1");
  });

  it("collapses duplicate SKUs and counts them as skipped", () => {
    const res = prepareBatch([row("A1", { price: "1" }), row("A1", { price: "2" })], { makeId: idGen() });
    expect(res.rows).toHaveLength(1);
    expect(res.duplicates).toBe(1);
    // Last occurrence wins.
    expect(res.rows[0].price).toBe("2.00");
  });

  it("records a failure for a blank SKU and for a bad amount", () => {
    const res = prepareBatch([row(""), row("A1", { price: "n/a" })], { makeId: idGen(), startRow: 2 });
    expect(res.rows).toHaveLength(0);
    expect(res.failures).toEqual([
      { row: 2, sku: "", reason: "Missing SKU" },
      { row: 3, sku: "A1", reason: 'Price "n/a" is not a number' },
    ]);
  });
});

describe("buildUpsertSql", () => {
  const { rows } = prepareBatch([row("A1"), row("A2")], { makeId: idGen(), now: new Date("2026-10-01T00:00:00Z") });
  const { sql, params } = buildUpsertSql(rows);

  it("emits ONE statement with one row per product", () => {
    expect(sql).toContain('ON CONFLICT ("sku") DO UPDATE');
    expect(sql).toContain('RETURNING "sku", (xmax = 0) AS "inserted"');
    expect(sql.match(/VALUES/g)).toHaveLength(1);
    expect(params).toHaveLength(24); // 12 columns x 2 rows
  });

  it("resets isInactive to false on conflict, so a re-import restores Active", () => {
    // A full inventory import is the source of truth for status: rows present in
    // the file come back Active, and the inactive list is applied afterwards to
    // re-flag the exceptions. New rows take the schema default (false).
    expect(sql).toContain('"isInactive"=false');
    expect(sql).not.toContain('"isInactive"=EXCLUDED');
    // Still 12 bound columns: isInactive is a literal, not a bind param.
    expect(params).toHaveLength(24);
  });

  it("stays under PostgreSQL's 65,535 bind-parameter limit at max batch size", () => {
    const big = Array.from({ length: MAX_BATCH_ROWS }, (_, i) => row(`SKU-${i}`));
    const { params } = buildUpsertSql(prepareBatch(big, { makeId: idGen() }).rows);
    expect(params.length).toBe(MAX_BATCH_ROWS * 12);
    expect(params.length).toBeLessThan(65535);
  });
});

describe("normalizeSkuList", () => {
  it("de-duplicates and trims", () => {
    expect(normalizeSkuList([" A1 ", "A1", "A2", "", null]).sort()).toEqual(["A1", "A2"]);
  });
});

describe("formatUpdateName", () => {
  const when = new Date(2026, 9, 1, 15, 42); // October 1, 2026 local time

  it("generates a readable name from vendor + date", () => {
    expect(formatUpdateName("A.O.R. INC.", when)).toBe("A.O.R. INC. - October 1, 2026");
  });

  it("falls back to the date when no vendor is chosen", () => {
    expect(formatUpdateName("", when)).toBe("October 1, 2026");
  });

  it("collapses stray whitespace in the vendor", () => {
    expect(formatUpdateName("  A.O.R.   INC. ", when)).toBe("A.O.R. INC. - October 1, 2026");
  });
});