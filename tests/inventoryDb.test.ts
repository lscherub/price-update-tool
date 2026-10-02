import { describe, expect, it } from "vitest";
import { applyInactiveSkuList, importInventoryBatch } from "@/lib/inventoryDb";
import {
  buildExactSkuFlagSql,
  exactSkuList,
  MAX_BATCH_ROWS,
  prepareBatch,
} from "@/lib/inventoryImport";

/**
 * The regression that broke weekly imports was one SQL statement per product.
 * These tests assert the new contract: a batch of N rows costs ONE statement
 * in the happy path, and a failing statement is bisected so a single bad row is
 * isolated instead of discarding the whole batch.
 */

type FakeOptions = {
  /** SKUs already present in the database (counted as updates). */
  existing?: Set<string>;
  /** Simulate a statement-level failure when any row matches. */
  explodeFor?: (sku: string) => boolean;
};

function makeFakeDb(opts: FakeOptions = {}) {
  const existing = opts.existing ?? new Set<string>();
  const calls: { sql: string; paramCount: number }[] = [];

  const db = {
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      calls.push({ sql, paramCount: params.length });
      // Params are ordered sku, normalizedSku, ... 12 columns per row.
      const skus = params.filter((_, i) => i % 12 === 0).map(String);
      if (skus.some((s) => opts.explodeFor?.(s))) {
        throw new Error('invalid input syntax for type numeric: "bad"');
      }
      return skus.map((sku) => ({ sku, inserted: !existing.has(sku) }));
    },
    $executeRawUnsafe: async () => 0,
    product: {} as never,
  };

  return { db, calls, existing };
}

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    sku: `SKU-${i}`,
    productNumber: `PN-${i}`,
    description: "Product",
    vendor: "A.O.R. INC.",
    brand: "B",
    listCost: "1.00",
    price: "2.00",
    sizeDesc: "",
  }));

describe("importInventoryBatch — statement count", () => {
  it("applies a full 1,000-row batch in exactly ONE statement", async () => {
    const fake = makeFakeDb();
    const out = await importInventoryBatch(fake.db as never, rows(MAX_BATCH_ROWS));

    expect(fake.calls).toHaveLength(1);
    expect(out.processed).toBe(1000);
    expect(out.inserted).toBe(1000);
    expect(out.updated).toBe(0);
    expect(out.failed).toEqual([]);
  });

  it("splits existing vs new SKUs using the RETURNING insert flag", async () => {
    const existing = new Set(Array.from({ length: 400 }, (_, i) => `SKU-${i}`));
    const fake = makeFakeDb({ existing });
    const out = await importInventoryBatch(fake.db as never, rows(1000));

    expect(fake.calls).toHaveLength(1);
    expect(out.updated).toBe(400);
    expect(out.inserted).toBe(600);
  });
});

describe("importInventoryBatch — failure isolation", () => {
  it("bisects a failing statement so one bad row does not lose the batch", async () => {
    const fake = makeFakeDb({ explodeFor: (sku) => sku === "SKU-500" });
    const out = await importInventoryBatch(fake.db as never, rows(1000));

    // Everything except the bad row still imported.
    expect(out.processed).toBe(999);
    expect(out.inserted).toBe(999);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0]).toMatchObject({ sku: "SKU-500", row: 502 });
    expect(out.failed[0].reason).toContain("invalid input syntax");
  });

  it("reports validation failures without touching the database", async () => {
    const fake = makeFakeDb();
    const base = rows(1)[0];
    const out = await importInventoryBatch(fake.db as never, [
      { ...base, sku: "" },
      { ...base, sku: "OK-1" },
      { ...base, sku: "BAD-1", price: "twelve" },
    ]);

    expect(fake.calls).toHaveLength(1); // only the valid row is sent
    expect(out.processed).toBe(1);
    expect(out.inserted).toBe(1);
    expect(out.failed).toEqual([
      { row: 2, sku: "", reason: "Missing SKU" },
      { row: 4, sku: "BAD-1", reason: 'Price "twelve" is not a number' },
    ]);
  });

  it("counts duplicate SKUs in a batch as skipped, not duplicated", async () => {
    const fake = makeFakeDb();
    const base = rows(1)[0];
    const out = await importInventoryBatch(fake.db as never, [
      { ...base, sku: "DUP" },
      { ...base, sku: "DUP" },
    ]);
    expect(out.skipped).toBe(1);
    expect(out.processed).toBe(1);
    expect(fake.calls).toHaveLength(1);
  });
});

describe("importInventoryBatch — history safety", () => {
  it("resets isInactive to false on conflict but never DELETEs history", async () => {
    const fake = makeFakeDb({ existing: new Set(["SKU-0"]) });
    await importInventoryBatch(fake.db as never, rows(3));

    for (const call of fake.calls) {
      // A full inventory import is the source of truth for status, so an
      // existing row is reset to Active; the inactive list is applied after.
      expect(call.sql).toContain('"isInactive"=false');
      expect(call.sql).not.toContain("DELETE");
      expect(call.sql).not.toContain("PriceUpdateItem");
    }
    // 12 bind params per row (numeric/timestamps cast explicitly). isInactive
    // is set as a literal, so the parameter count is unchanged.
    expect(fake.calls[0].paramCount).toBe(3 * 12);
  });

  it("is idempotent: re-importing the same rows only updates", async () => {
    const fake = makeFakeDb({ existing: new Set(["SKU-0", "SKU-1", "SKU-2"]) });
    const out = await importInventoryBatch(fake.db as never, rows(3));
    expect(out.inserted).toBe(0);
    expect(out.updated).toBe(3);
  });

  it("assigns a unique id per row so cuid columns stay valid", () => {
    let n = 0;
    const prepared = prepareBatch(rows(50), { makeId: () => `id-${n++}` });
    expect(new Set(prepared.rows.map((r) => r.id)).size).toBe(50);
  });
});

/**
 * Regression tests for the inactive-list import.
 *
 * The original implementation expanded each SKU from the inactive file into
 * fuzzy variants (spaceless, leading-zero-stripped, and normalizeSku() with its
 * final character removed) and matched them against BOTH `sku` and
 * `normalizedSku`. A 16,071-SKU file expanded to 29,024 keys and marked 16,559
 * products Inactive, silently flagging hundreds of products that were still on
 * sale. The inactive file must now be the exact source of truth.
 */
describe("exactSkuList — no fuzzy SKU expansion", () => {
  it("trims and de-duplicates without altering the SKU text", () => {
    expect(exactSkuList([" 62491774008 ", "62491774008", "62491774007"])).toEqual([
      "62491774008",
      "62491774007",
    ]);
  });

  it("preserves leading zeros instead of stripping them", () => {
    // The old code added both "0588123" and "588123", so the two matched each other.
    expect(exactSkuList(["0588123"])).toEqual(["0588123"]);
  });

  it("does not drop the last character the way normalizeSku does", () => {
    expect(exactSkuList(["62491774008"])).toEqual(["62491774008"]);
  });

  it("does not expand one SKU into several match keys", () => {
    // The bug: a single row used to yield raw, spaceless, stripped and
    // last-char-removed variants (up to 6 keys).
    expect(exactSkuList(["62491774008"]).length).toBe(1);
  });

  it("keeps SKUs as strings so numeric cells keep their digits", () => {
    expect(exactSkuList([62491774008, "0001234"])).toEqual(["62491774008", "0001234"]);
  });

  it("drops blank entries", () => {
    expect(exactSkuList(["", "   ", null, undefined, "A-1"])).toEqual(["A-1"]);
  });
});

describe("buildExactSkuFlagSql — exact equality only", () => {
  it("matches on the unique sku column with equality", () => {
    const [stmt] = buildExactSkuFlagSql(["62491774008"], true);
    expect(stmt?.sql).toContain('"sku" = ANY(');
    expect(stmt?.sql).not.toContain("normalizedSku");
    expect(stmt?.params).toEqual(["62491774008", true]);
  });

  it("chunks large lists so bind parameters stay bounded", () => {
    const skus = Array.from({ length: 12000 }, (_, i) => `SKU-${i}`);
    const stmts = buildExactSkuFlagSql(skus, true, 5000);
    expect(stmts).toHaveLength(3);
    expect(stmts[0]?.params).toHaveLength(5001);
    expect(stmts[2]?.params).toHaveLength(2001);
  });

  it("emits nothing for an empty list", () => {
    expect(buildExactSkuFlagSql([], true)).toEqual([]);
  });

  it("can also set rows back to Active", () => {
    const [stmt] = buildExactSkuFlagSql(["A-1"], false);
    expect(stmt?.params).toEqual(["A-1", false]);
  });
});

describe("applyInactiveSkuList — only listed SKUs go Inactive", () => {
  /** Records every statement so we can assert on order and parameters. */
  function makeRecordingDb() {
    const calls: { sql: string; params: unknown[] }[] = [];
    const db = {
      $queryRawUnsafe: async () => [],
      $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
        calls.push({ sql, params });
        // Report the number of SKUs bound as "rows affected".
        const m = /ARRAY\[/.test(sql) ? params.length - 1 : 0;
        return m;
      },
      product: {} as never,
    };
    return { db, calls };
  }

  it("clears existing flags first, then flags exactly the listed SKUs", async () => {
    const { db, calls } = makeRecordingDb();
    const out = await applyInactiveSkuList(db as never, ["62491774008", "62491774007"]);

    expect(calls).toHaveLength(2);
    // Step 1: everything returns to Active.
    expect(calls[0]?.sql).toContain('SET "isInactive" = false');
    // Step 2: only the listed SKUs are flagged, with exact equality.
    expect(calls[1]?.sql).toContain('"sku" = ANY(');
    expect(calls[1]?.params).toEqual(["62491774008", "62491774007", true]);
    expect(out).toEqual({ skus: 2, markedInactive: 2 });
  });

  it("never matches on normalizedSku (the source of the over-flagging)", async () => {
    const { db, calls } = makeRecordingDb();
    await applyInactiveSkuList(db as never, ["62491774008"]);
    for (const call of calls) expect(call.sql).not.toContain("normalizedSku");
  });

  it("never inserts a product, so the import cannot create duplicates", async () => {
    const { db, calls } = makeRecordingDb();
    await applyInactiveSkuList(db as never, ["NEW-SKU-NOT-IN-INVENTORY"]);
    for (const call of calls) expect(call.sql).not.toContain("INSERT");
  });

  it("still reactivates everything when the file is empty", async () => {
    const { db, calls } = makeRecordingDb();
    const out = await applyInactiveSkuList(db as never, []);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('SET "isInactive" = false');
    expect(out).toEqual({ skus: 0, markedInactive: 0 });
  });

  it("de-duplicates the file so a repeated SKU is counted once", async () => {
    const { db, calls } = makeRecordingDb();
    const out = await applyInactiveSkuList(db as never, ["A-1", "A-1", "A-1"]);
    expect(calls[1]?.params).toEqual(["A-1", true]);
    expect(out.skus).toBe(1);
  });
});
