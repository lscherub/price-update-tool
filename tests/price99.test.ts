import { describe, it, expect, beforeEach } from "vitest";
import {
  buildPrice99Workbook,
  generatePrice99Filename,
  generateBatchId,
  rankProductMatches,
  parsePastedSkus,
  type Price99Item,
} from "../src/lib/price99";
import {
  createPrice99BatchRecord,
  listPrice99Batches,
  getPrice99Batch,
  deletePrice99Batches,
} from "../src/lib/price99Server";
import { emptyStore, saveFileStore } from "../src/lib/store";
import * as XLSX from "xlsx";

describe("price99 export and logic", () => {
  it("generates correct filename for CHECK and UNCHECK", () => {
    const d = new Date("2026-10-29T12:00:00Z");
    expect(generatePrice99Filename("CHECK", d)).toBe(
      "Amber_POS_99_Price_Check_2026-10-29.xlsx"
    );
    expect(generatePrice99Filename("UNCHECK", d)).toBe(
      "Amber_POS_99_Price_Uncheck_2026-10-29.xlsx"
    );
  });

  it("generates unique batch IDs", () => {
    const id1 = generateBatchId();
    const id2 = generateBatchId();
    expect(id1).toMatch(/^BATCH-\d{8}-[A-Z0-9]{4}$/);
    expect(id2).toMatch(/^BATCH-\d{8}-[A-Z0-9]{4}$/);
    expect(id1).not.toBe(id2);
  });

  it("builds workbook for CHECK with 'Y' and text SKU preserving leading zeros", () => {
    const items = [
      { sku: "0012345" },
      { sku: "62363699339" },
    ];
    const wb = buildPrice99Workbook(items, "CHECK");
    const ws = wb.Sheets["99 Price Import"];
    expect(ws["A1"]).toEqual({ v: "Sku", t: "s" });
    expect(ws["B1"]).toEqual({ v: "99 Price", t: "s" });

    // Cell A2 should have string type and exact value
    expect(ws["A2"]).toEqual({ t: "s", v: "0012345" });
    expect(ws["B2"]).toEqual({ t: "s", v: "Y" });

    expect(ws["A3"]).toEqual({ t: "s", v: "62363699339" });
    expect(ws["B3"]).toEqual({ t: "s", v: "Y" });
  });

  it("builds workbook for UNCHECK with genuine blank cell (null) in 99 Price column", () => {
    const items = [
      { sku: "0012345" },
      { sku: "62363699339" },
    ];
    const wb = buildPrice99Workbook(items, "UNCHECK");
    const ws = wb.Sheets["99 Price Import"];
    expect(ws["A1"]).toEqual({ v: "Sku", t: "s" });
    expect(ws["B1"]).toEqual({ v: "99 Price", t: "s" });

    // Cell A2 should have string type and exact value
    expect(ws["A2"]).toEqual({ t: "s", v: "0012345" });
    // B2 should NOT exist or be empty/blank, never "Y", "N", "FALSE", or "0"
    expect(ws["B2"]).toBeUndefined();

    expect(ws["A3"]).toEqual({ t: "s", v: "62363699339" });
    expect(ws["B3"]).toBeUndefined();
  });
});

describe("price99 search ranking", () => {
  it("ranks exact SKU match FIRST, partial SKU matches second, description matches third", () => {
    const query = "62491704304";
    const candidates: Price99Item[] = [
      { sku: "62491704300", description: "Product 300" },
      { sku: "62491704301", description: "Product 301" },
      { sku: "99999999999", description: "Contains 62491704304 in description" },
      { sku: "62491704304-B", description: "Variant 304 B" },
      { sku: "62491704304", description: "Exact Target Product" },
    ];

    const ranked = rankProductMatches(candidates, query);

    // Exact SKU must be index 0
    expect(ranked[0].sku).toBe("62491704304");

    // Partial prefix SKU matches immediately after
    expect(ranked[1].sku).toBe("62491704304-B");

    // Other matches follow
    const otherSkus = ranked.slice(2).map((r) => r.sku);
    expect(otherSkus).toContain("99999999999");
  });
});

describe("price99 bulk SKU parsing", () => {
  it("parses single column SKUs and trims lines", () => {
    const raw = `
      62363699339
      62491704071
      62491704304
    `;
    const result = parsePastedSkus(raw);
    expect(result).toEqual(["62363699339", "62491704071", "62491704304"]);
  });

  it("parses Excel tab-separated rows and skips header and duplicates", () => {
    const raw = `SKU\tDescription\tCost\n62363699339\tWhey Protein\t25.00\n62491704071\tCreatine\t15.00\n62363699339\tWhey Protein Duplicate\t25.00`;
    const result = parsePastedSkus(raw);
    expect(result).toEqual(["62363699339", "62491704071"]);
  });

  it("strips quotes around SKUs if present", () => {
    const raw = `"0012345"\n'0056789'`;
    const result = parsePastedSkus(raw);
    expect(result).toEqual(["0012345", "0056789"]);
  });
});

describe("price99Server history persistence & deletion", () => {
  beforeEach(() => {
    // Clear local store for isolated test
    saveFileStore(emptyStore());
  });

  it("creates a batch record and retrieves it via list and get", async () => {
    const items = [
      { sku: "SKU1", description: "Product 1", brand: "Brand A", vendor: "Vendor 1" },
      { sku: "SKU2", description: "Product 2", brand: "Brand B", vendor: "Vendor 2" },
    ];

    const batch = await createPrice99BatchRecord({
      action: "UNCHECK",
      items,
      createdBy: "staff@test.com",
      dbOverride: null, // Force local store for test
    });

    expect(batch.batchId).toBeDefined();
    expect(batch.action).toBe("UNCHECK");
    expect(batch.productCount).toBe(2);
    expect(batch.items).toHaveLength(2);
    expect(batch.createdBy).toBe("staff@test.com");

    const list = await listPrice99Batches({ dbOverride: null });
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].batchId).toBe(batch.batchId);

    const fetched = await getPrice99Batch(batch.batchId, null);
    expect(fetched).not.toBeNull();
    expect(fetched?.batchId).toBe(batch.batchId);
    expect(fetched?.items[0].sku).toBe("SKU1");
  });

  it("preserves previous batch when a new batch is created with different action", async () => {
    const items = [{ sku: "SKU1", description: "Product 1" }];

    const batch1 = await createPrice99BatchRecord({
      action: "UNCHECK",
      items,
      createdBy: "user1@test.com",
      dbOverride: null,
    });

    const batch2 = await createPrice99BatchRecord({
      action: "CHECK",
      items,
      createdBy: "user1@test.com",
      dbOverride: null,
    });

    expect(batch1.batchId).not.toBe(batch2.batchId);

    const b1 = await getPrice99Batch(batch1.batchId, null);
    const b2 = await getPrice99Batch(batch2.batchId, null);

    expect(b1?.action).toBe("UNCHECK");
    expect(b2?.action).toBe("CHECK");
  });

  it("deletes selected batches while preserving unselected batches", async () => {
    const items = [{ sku: "SKU1", description: "Product 1" }];

    const batch1 = await createPrice99BatchRecord({
      action: "CHECK",
      items,
      createdBy: "user1@test.com",
      dbOverride: null,
    });

    const batch2 = await createPrice99BatchRecord({
      action: "UNCHECK",
      items,
      createdBy: "user2@test.com",
      dbOverride: null,
    });

    const batch3 = await createPrice99BatchRecord({
      action: "CHECK",
      items,
      createdBy: "user3@test.com",
      dbOverride: null,
    });

    // Delete batch1 and batch3
    const { deletedCount } = await deletePrice99Batches(
      [batch1.batchId, batch3.batchId],
      null
    );

    expect(deletedCount).toBe(2);

    const remaining = await listPrice99Batches({ dbOverride: null });
    expect(remaining.length).toBe(1);
    expect(remaining[0].batchId).toBe(batch2.batchId);

    expect(await getPrice99Batch(batch1.batchId, null)).toBeNull();
    expect(await getPrice99Batch(batch3.batchId, null)).toBeNull();
    expect(await getPrice99Batch(batch2.batchId, null)).not.toBeNull();
  });
});
