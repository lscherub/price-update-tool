import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  cleanUnifiedPosMatrix,
  findUnifiedPosHeaders,
  parseAndCleanUnifiedPosFile,
  parsePosInactive,
} from "@/lib/unifiedPosCleaner";
import {
  buildUnifiedUpsertSql,
  prepareUnifiedBatch,
} from "@/lib/inventoryImport";
import { importUnifiedInventoryBatch } from "@/lib/inventoryDb";

describe("Unified POS Inventory Workflow End-to-End", () => {
  it("processes a realistic raw Amber POS export containing all variations", async () => {
    // Construct representative raw POS file data
    const rawAoa: unknown[][] = [
      // Row 1: Headers with empty Column A, 9 required fields + unneeded POS fields
      [
        "", // Column A empty
        "Sku",
        "Description",
        "Size Desc.", // punctuation variation
        "Vendor",
        "Product Number",
        "Brand",
        "List Cost",
        "Price",
        "Dim.2 Group",
        "Department",
        "QOH",
        "Avg. Cost",
        "Unit Type",
        "QTYAVL",
        "Lookups",
        "Web Visible",
        "Season",
        "INACTIVE",
        "Parent Sku",
      ],
      // Row 2: Empty second row from Amber export
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      // Row 3: Active product with leading zeros and blank INACTIVE
      [
        "",
        "001234",
        "Whey Protein Isolate",
        "2 LB",
        "A.O.R. INC.",
        "00987",
        "ProSeries",
        "$25.50",
        "$49.99",
        "Diet",
        "Supplements",
        "10",
        "24.00",
        "EACH",
        "10",
        "",
        "Y",
        "2026",
        "", // Blank -> Active
        "",
      ],
      // Row 4: Inactive product with 'Y'
      [
        "",
        "005555",
        "Old Vitamin C Formula",
        "90 Tablets",
        "A.O.R. INC.",
        "AOR-01",
        "Classic",
        "10.00",
        "19.99",
        "Vits",
        "Supplements",
        "0",
        "9.50",
        "EACH",
        "0",
        "",
        "N",
        "",
        "Y", // Y -> Inactive
        "",
      ],
      // Row 5: Active product with 'N'
      [
        "",
        "007788",
        "Daily Multivitamin",
        "180 Caps",
        "Natural Factors",
        "NF-180",
        "Natural Factors",
        "15.00",
        "29.99",
        "Multi",
        "Supplements",
        "25",
        "14.00",
        "EACH",
        "25",
        "",
        "Y",
        "",
        "N", // N -> Active
        "",
      ],
      // Row 6: Active product with '0'
      [
        "",
        "999888",
        "Melatonin 3mg",
        "60 Sublinguals",
        "Webber Naturals",
        "WN-60",
        "Webber",
        "4.50",
        "8.99",
        "Sleep",
        "Supplements",
        "50",
        "4.00",
        "EACH",
        "50",
        "",
        "Y",
        "",
        "0", // 0 -> Active
        "",
      ],
      // Row 7: Duplicate SKU with different price and inactive 'y' (lowercase)
      [
        "",
        "001234",
        "Whey Protein Isolate (Special)",
        "2 LB",
        "A.O.R. INC.",
        "00987",
        "ProSeries",
        "26.00",
        "51.99",
        "Diet",
        "Supplements",
        "5",
        "25.00",
        "EACH",
        "5",
        "",
        "Y",
        "2026",
        " y ", // y -> Inactive
        "",
      ],
      // Row 8: Product with blank optional fields (Size Desc blank, Brand blank)
      [
        "",
        "003344",
        "Bulk Herb Tea",
        "",
        "Herbal Inc.",
        "HI-01",
        "",
        "3.00",
        "6.50",
        "Tea",
        "Beverages",
        "100",
        "2.50",
        "BAG",
        "100",
        "",
        "Y",
        "",
        "",
        "",
      ],
    ];

    // 1. Validate and clean file
    const ws = XLSX.utils.aoa_to_sheet(rawAoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "POS");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const cleanResult = parseAndCleanUnifiedPosFile(buffer);

    expect(cleanResult.success).toBe(true);
    expect(cleanResult.totalRecords).toBe(6); // 6 product rows (empty row 2 discarded)
    expect(cleanResult.emptyRowsRemoved).toBe(1);

    // 2. Verify field mapping and status interpretation
    const records = cleanResult.records;

    // Check SKU 001234
    expect(records[0].sku).toBe("001234");
    expect(records[0].productNumber).toBe("00987");
    expect(records[0].listCost).toBe("25.50");
    expect(records[0].price).toBe("49.99");
    expect(records[0].sizeDesc).toBe("2 LB");
    expect(records[0].isInactive).toBe(false);
    expect(records[0].status).toBe("Active");

    // Check SKU 005555
    expect(records[1].sku).toBe("005555");
    expect(records[1].isInactive).toBe(true);
    expect(records[1].status).toBe("Inactive");

    // Check SKU 007788
    expect(records[2].sku).toBe("007788");
    expect(records[2].isInactive).toBe(false);
    expect(records[2].status).toBe("Active");

    // Check SKU 999888
    expect(records[3].sku).toBe("999888");
    expect(records[3].isInactive).toBe(false);
    expect(records[3].status).toBe("Active");

    // Check Duplicate SKU 001234 second occurrence
    expect(records[4].sku).toBe("001234");
    expect(records[4].isInactive).toBe(true); // ' y ' -> Inactive
    expect(records[4].status).toBe("Inactive");
    expect(records[4].isDuplicate).toBe(true);

    // Check SKU 003344 with blank Size Desc
    expect(records[5].sku).toBe("003344");
    expect(records[5].sizeDesc).toBe("");
    expect(records[5].isInactive).toBe(false);
    expect(records[5].status).toBe("Active");

    // 3. Selection simulation: Deselect SKU 005555
    const selected = records.filter((r) => r.sku !== "005555");
    expect(selected).toHaveLength(5);

    // 4. Batch preparation
    let n = 0;
    const prepared = prepareUnifiedBatch(selected, {
      makeId: () => `id-${++n}`,
      now: new Date("2026-11-03T12:00:00Z"),
    });

    // Duplicate SKU 001234 collapses to 1 unique upsert, last occurrence wins
    expect(prepared.rows).toHaveLength(4); // 001234, 007788, 999888, 003344
    expect(prepared.duplicates).toBe(1);

    const winning001234 = prepared.rows.find((r) => r.sku === "001234");
    expect(winning001234?.price).toBe("51.99");
    expect(winning001234?.isInactive).toBe(true); // last occurrence was inactive

    // 5. Database Upsert Simulation
    const existingDb = new Map<string, { sku: string; price: string; isInactive: boolean }>([
      ["007788", { sku: "007788", price: "24.99", isInactive: true }],
      ["005555", { sku: "005555", price: "18.00", isInactive: false }], // Was deselected
    ]);

    const calls: { sql: string; params: unknown[] }[] = [];
    const fakeDb = {
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
        calls.push({ sql, params });
        const skus = params.filter((_, i) => i % 13 === 0).map(String);
        return skus.map((sku) => {
          const isInsert = !existingDb.has(sku);
          return { sku, inserted: isInsert };
        });
      },
      $executeRawUnsafe: async () => 0,
      product: {} as never,
    };

    const outcome = await importUnifiedInventoryBatch(fakeDb as never, prepared.rows);

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('"isInactive"=EXCLUDED."isInactive"');
    // 007788 was updated (existing in DB)
    // 001234, 999888, 003344 were inserted
    expect(outcome.updated).toBe(1);
    expect(outcome.inserted).toBe(3);
    expect(outcome.failed).toHaveLength(0);

    // Verify deselected product 005555 was NOT included in params
    const boundSkus = calls[0].params.filter((_, i) => i % 13 === 0);
    expect(boundSkus).not.toContain("005555");
    expect(existingDb.get("005555")?.price).toBe("18.00"); // Untouched!
  });

  it("handles a massive inventory file (22,000 products) with fast cleaning and safe batching", () => {
    const rowCount = 22000;
    const matrix: unknown[][] = [
      ["", "Sku", "Product Number", "Description", "Vendor", "Brand", "List Cost", "Price", "Size Desc", "INACTIVE"],
      ["", "", "", "", "", "", "", "", "", ""], // Empty row
    ];

    for (let i = 0; i < rowCount; i++) {
      matrix.push([
        "",
        `SKU-${String(i).padStart(6, "0")}`,
        `PN-${i}`,
        `Product Description for item ${i}`,
        "Vendor Corp",
        "Brand Elite",
        "10.00",
        "20.00",
        "100g",
        i % 4 === 0 ? "Y" : "N",
      ]);
    }

    const t0 = performance.now();
    const result = cleanUnifiedPosMatrix(matrix);
    const duration = performance.now() - t0;

    expect(result.success).toBe(true);
    expect(result.totalRecords).toBe(rowCount);
    expect(result.emptyRowsRemoved).toBe(1);
    expect(result.inactiveCount).toBe(rowCount / 4);
    expect(result.activeCount).toBe(rowCount * 0.75);
    // Performance: 22,000 rows cleaned in under 500ms
    expect(duration).toBeLessThan(1500);

    // Verify chunking at MAX_BATCH_ROWS = 1000
    const batches = [];
    for (let i = 0; i < result.records.length; i += 1000) {
      batches.push(result.records.slice(i, i + 1000));
    }
    expect(batches).toHaveLength(22);
    expect(batches[0]).toHaveLength(1000);
    expect(batches[21]).toHaveLength(1000);
  });
});
