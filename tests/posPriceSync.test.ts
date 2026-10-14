import { describe, expect, it } from "vitest";
import {
  buildPriceUpdateSql,
  collectSyncKeys,
  dedupeSyncRows,
  matchSku,
  selectPosSyncRows,
  validateSyncPrice,
} from "@/lib/posPriceSync";
import { getLastPriceSyncAt, setLastPriceSyncNow } from "@/lib/inventoryMeta";
import { applyPosPriceUpdates } from "@/lib/inventoryDb";

function makeMetaDb(initial = "") {
  const values = new Map<string, string>();
  if (initial) values.set("seeded", initial);
  return {
    db: {
      $queryRawUnsafe: async <T,>(sql: string, ...params: unknown[]): Promise<T> => {
        const key = String(params[0] ?? "");
        // Keyed lookup: only the price-sync key resolves; full-import key is separate.
        if (key === "inventory_last_price_sync") {
          const v = values.get(key) ?? "";
          return (v ? [{ value: v }] : []) as T;
        }
        if (key === "inventory_last_full_import") {
          void sql;
          return (initial ? [{ value: initial }] : []) as T;
        }
        return ([] as unknown) as T;
      },
      $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
        if (params.length >= 2 && sql.includes("ON CONFLICT")) {
          values.set(String(params[0]), String(params[1]));
        }
        return 1;
      },
    },
  };
}

describe("posPriceSync — selection mirrors the POS CSV export", () => {
  it("includes every row with a non-blank Cleaned SKU", () => {
    const rows = [
      { cleanedSku: "A1", ourNewListPrice: "1.00", nearest9: "1.99" },
      { cleanedSku: "  ", ourNewListPrice: "2.00", nearest9: "2.99" },
      { cleanedSku: "", ourNewListPrice: "3.00", nearest9: "3.99" },
      { cleanedSku: "B2", ourNewListPrice: null, nearest9: null },
    ];
    expect(selectPosSyncRows(rows).map((r) => r.cleanedSku)).toEqual(["A1", "B2"]);
  });

  it("dedupes repeat Cleaned SKUs (first wins)", () => {
    const rows = [
      { cleanedSku: "A1", ourNewListPrice: "1.00", nearest9: "1.99" },
      { cleanedSku: "A1", ourNewListPrice: "1.00", nearest9: "1.99" },
      { cleanedSku: "B2", ourNewListPrice: "2.00", nearest9: "2.99" },
    ];
    const { unique, duplicateSkus } = dedupeSyncRows(rows);
    expect(unique.map((r) => r.cleanedSku)).toEqual(["A1", "B2"]);
    expect(duplicateSkus).toEqual(["A1"]);
  });
});

describe("posPriceSync — price validation", () => {
  it("accepts valid prices and normalizes to 2dp", () => {
    expect(validateSyncPrice("12.9")).toEqual({ ok: true, value: "12.90" });
    expect(validateSyncPrice("$12.90")).toEqual({ ok: true, value: "12.90" });
  });
  it("reports blank vs invalid separately", () => {
    expect(validateSyncPrice(null)).toEqual({ ok: false, reason: "blank" });
    expect(validateSyncPrice("  ")).toEqual({ ok: false, reason: "blank" });
    expect(validateSyncPrice("abc")).toEqual({ ok: false, reason: "invalid" });
    expect(validateSyncPrice("-1")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("posPriceSync — SKU matching", () => {
  const index = [
    { id: "1", sku: "62491774008", normalizedSku: "62491774008" },
    { id: "2", sku: "0588222", normalizedSku: "058822" },
  ];
  it("prefers exact sku, falls back to stripped variants", () => {
    expect(matchSku("62491774008", index)).toEqual({ kind: "matched", productId: "1" });
    expect(matchSku("588222", index)).toEqual({ kind: "matched", productId: "2" });
    expect(matchSku("NOPE", index)).toEqual({ kind: "unmatched" });
  });
  it("reports ambiguous matches instead of guessing", () => {
    const dup = [
      { id: "1", sku: "ABC", normalizedSku: "ABC" },
      { id: "2", sku: "ABC", normalizedSku: "ABC" },
    ];
    expect(matchSku("ABC", dup)).toEqual({ kind: "ambiguous" });
  });
  it("collects exact + stripped lookup keys", () => {
    expect(collectSyncKeys(["0588222"])).toEqual(["0588222", "588222"]);
  });
});

describe("posPriceSync — batch SQL writes only price + listCost", () => {
  it("emits one UPDATE per chunk with price and listCost only", () => {
    const [stmt] = buildPriceUpdateSql([
      { productId: "p1", price: "9.99", listCost: "5.00" },
      { productId: "p2", price: "8.99", listCost: null },
    ]);
    expect(stmt?.sql).toContain('UPDATE "Product"');
    expect(stmt?.sql).toContain('"price"');
    expect(stmt?.sql).toContain('"listCost"');
    expect(stmt?.sql).not.toContain("INSERT");
    expect(stmt?.sql).not.toContain("description");
    expect(stmt?.params).toHaveLength(6);
  });
});

describe("applyPosPriceUpdates — batching + failure isolation", () => {
  it("updates in one statement and reports failures by id", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const db = {
      $queryRawUnsafe: async () => [],
      $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
        calls.push({ sql, params });
        const ids = params.filter((_, i) => i % 3 === 0).map(String);
        if (ids.includes("bad")) throw new Error("boom");
        return ids.length;
      },
      product: {} as never,
    };
    const out = await applyPosPriceUpdates(db as never, [
      { productId: "ok1", price: "1.99", listCost: "1.00" },
      { productId: "bad", price: "2.99", listCost: null },
    ]);
    // Bisection isolates the bad row: chunk of 2 -> 2 singles.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(out.failedIds).toEqual(["bad"]);
    expect(out.updated).toBe(1);
  });
});

describe("inventory last-updated timestamp — only successful syncs write", () => {
  it("returns null when no sync has occurred", async () => {
    const { db } = makeMetaDb("");
    // Seed the full-import key only; price-sync key stays empty.
    await db.$executeRawUnsafe(
      `INSERT INTO "AppSetting" ("key", "value", "updatedAt") VALUES ($1, $2, now()) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"`,
      "inventory_last_full_import",
      "2026-10-01T00:00:00.000Z",
    );
    expect(await getLastPriceSyncAt(db)).toBeNull();
  });
  it("records and reads back the sync time", async () => {
    const { db } = makeMetaDb("");
    const iso = await setLastPriceSyncNow(db, new Date("2026-10-14T10:45:00Z"));
    expect(iso).toBe("2026-10-14T10:45:00.000Z");
    expect(await getLastPriceSyncAt(db)).toBe(iso);
  });
});
