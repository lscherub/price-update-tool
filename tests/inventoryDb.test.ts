import { describe, expect, it } from "vitest";
import { importInventoryBatch } from "@/lib/inventoryDb";
import { MAX_BATCH_ROWS, prepareBatch } from "@/lib/inventoryImport";

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
  it("never writes isInactive, so inactive flags and price history survive", async () => {
    const fake = makeFakeDb({ existing: new Set(["SKU-0"]) });
    await importInventoryBatch(fake.db as never, rows(3));

    for (const call of fake.calls) {
      expect(call.sql).not.toContain("isInactive");
      expect(call.sql).not.toContain("DELETE");
    }
    // 12 bind params per row (numeric/timestamps cast explicitly).
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
