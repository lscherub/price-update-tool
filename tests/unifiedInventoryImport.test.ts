import { describe, expect, it } from "vitest";
import {
  buildUnifiedUpsertSql,
  MAX_BATCH_ROWS,
  prepareUnifiedBatch,
} from "@/lib/inventoryImport";
import { importUnifiedInventoryBatch } from "@/lib/inventoryDb";

const idGen = () => {
  let n = 0;
  return () => `id-${++n}`;
};

const row = (sku: string, over: Record<string, unknown> = {}) => ({
  sku,
  productNumber: "PN-1",
  description: "Whey Protein",
  vendor: "A.O.R. INC.",
  brand: "BrandX",
  listCost: "10.50",
  price: "24.99",
  sizeDesc: "2 LB",
  isInactive: false,
  ...over,
});

describe("prepareUnifiedBatch", () => {
  it("preserves active and inactive status correctly", () => {
    const raw = [
      row("SKU-1", { isInactive: false }),
      row("SKU-2", { isInactive: true }),
      row("SKU-3", { inactive: "Y" }),
      row("SKU-4", { inactive: "N" }),
      row("SKU-5", { status: "Inactive" }),
    ];
    const { rows, failures } = prepareUnifiedBatch(raw, { makeId: idGen() });
    expect(failures).toEqual([]);
    expect(rows).toHaveLength(5);
    expect(rows[0].isInactive).toBe(false);
    expect(rows[1].isInactive).toBe(true);
    expect(rows[2].isInactive).toBe(true);
    expect(rows[3].isInactive).toBe(false);
    expect(rows[4].isInactive).toBe(true);
  });

  it("normalizes SKU with leading zeros and amounts", () => {
    const { rows } = prepareUnifiedBatch([row("00123-A", { listCost: "$15.5", price: "29.99" })], {
      makeId: idGen(),
    });
    expect(rows[0].sku).toBe("00123-A");
    expect(rows[0].listCost).toBe("15.50");
    expect(rows[0].price).toBe("29.99");
  });

  it("collapses duplicate SKUs, with last occurrence winning", () => {
    const res = prepareUnifiedBatch(
      [
        row("DUP", { price: "10.00", isInactive: false }),
        row("DUP", { price: "20.00", isInactive: true }),
      ],
      { makeId: idGen() }
    );
    expect(res.rows).toHaveLength(1);
    expect(res.duplicates).toBe(1);
    expect(res.rows[0].price).toBe("20.00");
    expect(res.rows[0].isInactive).toBe(true);
  });

  it("records failures for missing SKU and non-numeric price", () => {
    const res = prepareUnifiedBatch([row(""), row("BAD", { price: "invalid" })], {
      makeId: idGen(),
      startRow: 2,
    });
    expect(res.rows).toHaveLength(0);
    expect(res.failures).toEqual([
      { row: 2, sku: "", reason: "Missing SKU" },
      { row: 3, sku: "BAD", reason: 'Price "invalid" is not a number' },
    ]);
  });
});

describe("buildUnifiedUpsertSql", () => {
  const { rows } = prepareUnifiedBatch(
    [row("A1", { isInactive: false }), row("A2", { isInactive: true })],
    { makeId: idGen(), now: new Date("2026-10-01T00:00:00Z") }
  );
  const { sql, params } = buildUnifiedUpsertSql(rows);

  it("emits ONE statement with 13 bind parameters per row", () => {
    expect(sql).toContain('ON CONFLICT ("sku") DO UPDATE');
    expect(sql).toContain('RETURNING "sku", (xmax = 0) AS "inserted"');
    expect(params).toHaveLength(26); // 13 columns x 2 rows
  });

  it("updates isInactive from EXCLUDED.isInactive on conflict", () => {
    expect(sql).toContain('"isInactive"=EXCLUDED."isInactive"');
    expect(sql).not.toContain('"isInactive"=false');
  });

  it("stays under PostgreSQL parameter limits at MAX_BATCH_ROWS", () => {
    const big = Array.from({ length: MAX_BATCH_ROWS }, (_, i) => row(`SKU-${i}`));
    const { params: bigParams } = buildUnifiedUpsertSql(
      prepareUnifiedBatch(big, { makeId: idGen() }).rows
    );
    expect(bigParams.length).toBe(MAX_BATCH_ROWS * 13);
    expect(bigParams.length).toBeLessThan(65535);
  });
});

describe("importUnifiedInventoryBatch", () => {
  it("applies a batch in ONE statement and reports inserted vs updated", async () => {
    const existing = new Set(["SKU-0"]);
    const calls: { sql: string; params: unknown[] }[] = [];
    const db = {
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
        calls.push({ sql, params });
        const skus = params.filter((_, i) => i % 13 === 0).map(String);
        return skus.map((sku) => ({ sku, inserted: !existing.has(sku) }));
      },
      $executeRawUnsafe: async () => 0,
      product: {} as never,
    };

    const out = await importUnifiedInventoryBatch(db as never, [
      row("SKU-0", { isInactive: true }),
      row("SKU-1", { isInactive: false }),
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('"isInactive"=EXCLUDED."isInactive"');
    expect(out.processed).toBe(2);
    expect(out.updated).toBe(1);
    expect(out.inserted).toBe(1);
    expect(out.failed).toHaveLength(0);
  });
});

