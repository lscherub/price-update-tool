import { describe, it, expect, beforeEach, vi } from "vitest";
import * as XLSX from "xlsx";

// Hermetic tests: bypass unreachable remote database in test environment
vi.mock("@/lib/db", () => ({
  getPrisma: () => null,
  isDbConnectionError: () => false,
  dbUnreachableResponse: () => ({ status: 503 }),
  productionDbGuard: () => null,
}));

import {
  parsePastedUpcs,
  analyzeDuplicates,
  defaultAdHocSheetName,
  generateTeamsCountFilename,
  type AdHocCountItemData,
} from "../src/lib/adhocCount";
import {
  buildAdHocCountWorkbook,
  AD_HOC_EXCEL_HEADERS,
  AD_HOC_HEADER_ROW,
} from "../src/lib/adhocCountExcel";
import {
  createAdHocSheet,
  listAdHocSheets,
  getAdHocSheet,
  updateAdHocSheet,
  deleteAdHocSheet,
  addAdHocItems,
  updateAdHocItem,
  syncAdHocItems,
  deleteAdHocItems,
  lookupSkusForAdHoc,
} from "../src/lib/adhocCountServer";
import { emptyStore, saveFileStore, type StoreShape } from "../src/lib/store";

describe("Ad Hoc Count Sheets - Pure Helpers & Parsing", () => {
  it("preserves leading zeros and cleans multiline pasted UPCs", () => {
    const input = `
      62773300207
      03367414961
      00123456789
      62354374619, 05881234567\t99999
    `;

    const parsed = parsePastedUpcs(input);
    expect(parsed).toEqual([
      "62773300207",
      "03367414961",
      "00123456789",
      "62354374619",
      "05881234567",
      "99999",
    ]);

    // Ensure leading zeros are preserved as strings
    expect(parsed[1]).toBe("03367414961");
    expect(parsed[2]).toBe("00123456789");
    expect(parsed[4]).toBe("05881234567");
  });

  it("handles duplicate detection within pasted list and against sheet", () => {
    const pasted = ["62773300207", "03367414961", "62773300207", "99999999999"];
    const existingInSheet = new Set(["03367414961", "11111111111"]);

    const { normalizedEntries } = analyzeDuplicates(pasted, existingInSheet);

    expect(normalizedEntries).toHaveLength(4);

    // 1st entry: clean
    expect(normalizedEntries[0].raw).toBe("62773300207");
    expect(normalizedEntries[0].isDuplicateInList).toBe(false);
    expect(normalizedEntries[0].isAlreadyInSheet).toBe(false);

    // 2nd entry: in sheet
    expect(normalizedEntries[1].raw).toBe("03367414961");
    expect(normalizedEntries[1].isDuplicateInList).toBe(false);
    expect(normalizedEntries[1].isAlreadyInSheet).toBe(true);

    // 3rd entry: duplicate in list
    expect(normalizedEntries[2].raw).toBe("62773300207");
    expect(normalizedEntries[2].isDuplicateInList).toBe(true);
    expect(normalizedEntries[2].isAlreadyInSheet).toBe(false);

    // 4th entry: clean
    expect(normalizedEntries[3].raw).toBe("99999999999");
    expect(normalizedEntries[3].isDuplicateInList).toBe(false);
    expect(normalizedEntries[3].isAlreadyInSheet).toBe(false);
  });

  it("formats default sheet name and export filename correctly", () => {
    const date = new Date(2026, 10, 16); // November 16, 2026
    const name = defaultAdHocSheetName(date);
    expect(name).toBe("Inventory Count - November 16, 2026");

    const filename = generateTeamsCountFilename(name, date);
    expect(filename).toBe("Inventory Count - November 16, 2026 - Teams Count - 2026-11-16.xlsx");
  });
});

describe("Ad Hoc Count Sheets - Server Operations & Persistence", () => {
  beforeEach(() => {
    const store: StoreShape = {
      ...emptyStore(),
      products: [
        {
          id: "prod-1",
          sku: "62773300207",
          normalizedSku: "6277330020",
          productNumber: "P-101",
          description: "Vitamin D3 1000IU",
          vendor: "Natural Factors",
          brand: "Natural Factors",
          listCost: "8.50",
          price: "14.99",
          sizeDesc: "180 Softgels",
          isInactive: false,
        },
        {
          id: "prod-2",
          sku: "03367414961",
          normalizedSku: "0336741496",
          productNumber: "P-202",
          description: "Zinc Lozenges Berry",
          vendor: "Nature's Way",
          brand: "Nature's Way",
          listCost: "5.20",
          price: "9.99",
          sizeDesc: "60 Lozenges",
          isInactive: false,
        },
      ],
      adHocSheets: [],
      adHocItems: [],
    };
    saveFileStore(store);
  });

  it("creates a new empty count sheet with sensible default name", async () => {
    const sheet = await createAdHocSheet({ dbOverride: null });
    expect(sheet.id).toBeDefined();
    expect(sheet.name).toMatch(/^Inventory Count - /);
    expect(sheet.status).toBe("In Progress");
    expect(sheet.items).toHaveLength(0);
  });

  it("lists, renames, and updates status of count sheets", async () => {
    const sheet1 = await createAdHocSheet({ name: "AOR Missed Items", dbOverride: null });
    const sheet2 = await createAdHocSheet({ name: "Flora Discrepancies", dbOverride: null });

    const all = await listAdHocSheets({ dbOverride: null });
    expect(all).toHaveLength(2);

    // Update status and name
    await updateAdHocSheet(sheet1.id, { name: "AOR Missed - Renamed", status: "Completed" }, { dbOverride: null });

    const updated = await getAdHocSheet(sheet1.id, { dbOverride: null });
    expect(updated?.name).toBe("AOR Missed - Renamed");
    expect(updated?.status).toBe("Completed");

    // Status filter
    const inProgress = await listAdHocSheets({ status: "In Progress", dbOverride: null });
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0].id).toBe(sheet2.id);

    const completed = await listAdHocSheets({ status: "Completed", dbOverride: null });
    expect(completed).toHaveLength(1);
    expect(completed[0].id).toBe(sheet1.id);
  });

  it("adds products with automatic All Inventory lookup", async () => {
    const sheet = await createAdHocSheet({ name: "Test Count", dbOverride: null });

    // Add matched SKU and unmatched SKU
    const items = await addAdHocItems(
      sheet.id,
      [{ sku: "62773300207" }, { sku: "99999999999" }],
      { dbOverride: null },
    );

    expect(items).toHaveLength(2);

    // Matched item
    const matched = items.find((i) => i.sku === "62773300207");
    expect(matched).toBeDefined();
    expect(matched?.brand).toBe("Natural Factors");
    expect(matched?.description).toBe("Vitamin D3 1000IU");
    expect(matched?.sizeDesc).toBe("180 Softgels");
    expect(matched?.matched).toBe(true);
    expect(matched?.qqh).toBe("");
    expect(matched?.layway).toBe("");
    expect(matched?.prepaid).toBe("");
    expect(matched?.expiry).toBe("");
    expect(matched?.onTransfer).toBe("");

    // Unmatched item
    const unmatched = items.find((i) => i.sku === "99999999999");
    expect(unmatched).toBeDefined();
    expect(unmatched?.sku).toBe("99999999999");
    expect(unmatched?.brand).toBe("");
    expect(unmatched?.description).toBe("Not Found");
    expect(unmatched?.matched).toBe(false);
  });

  it("CRITICAL: editing SKU refreshes inventory details while strictly preserving staff-entered count data", async () => {
    const sheet = await createAdHocSheet({ name: "Preserve Count Test", dbOverride: null });

    // Add unmatched item
    const [item] = await addAdHocItems(sheet.id, [{ sku: "OLD-SKU-123" }], { dbOverride: null });
    expect(item.matched).toBe(false);

    // Staff enters count and expiry information
    await updateAdHocItem(
      sheet.id,
      item.id,
      {
        qqh: "14",
        layway: "2",
        prepaid: "1",
        expiry: "09/27",
        onTransfer: "Store 2 (3 units)",
      },
      { dbOverride: null },
    );

    // Verify staff data was saved
    let refreshed = await getAdHocSheet(sheet.id, { dbOverride: null });
    let currentItem = refreshed?.items.find((i) => i.id === item.id);
    expect(currentItem?.qqh).toBe("14");
    expect(currentItem?.layway).toBe("2");
    expect(currentItem?.prepaid).toBe("1");
    expect(currentItem?.expiry).toBe("09/27");
    expect(currentItem?.onTransfer).toBe("Store 2 (3 units)");

    // User edits the SKU to a valid All Inventory product: 03367414961
    await updateAdHocItem(
      sheet.id,
      item.id,
      { sku: "03367414961" },
      { dbOverride: null },
    );

    refreshed = await getAdHocSheet(sheet.id, { dbOverride: null });
    currentItem = refreshed?.items.find((i) => i.id === item.id);

    // Product info refreshed from All Inventory
    expect(currentItem?.sku).toBe("03367414961");
    expect(currentItem?.brand).toBe("Nature's Way");
    expect(currentItem?.description).toBe("Zinc Lozenges Berry");
    expect(currentItem?.sizeDesc).toBe("60 Lozenges");
    expect(currentItem?.matched).toBe(true);

    // Staff-entered counts are 100% PRESERVED
    expect(currentItem?.qqh).toBe("14");
    expect(currentItem?.layway).toBe("2");
    expect(currentItem?.prepaid).toBe("1");
    expect(currentItem?.expiry).toBe("09/27");
    expect(currentItem?.onTransfer).toBe("Store 2 (3 units)");
  });

  it("deleting a sheet deletes only the sheet and its items; never touches All Inventory products", async () => {
    const sheet = await createAdHocSheet({ name: "Deletion Test", dbOverride: null });
    await addAdHocItems(sheet.id, [{ sku: "62773300207" }], { dbOverride: null });

    const deleted = await deleteAdHocSheet(sheet.id, { dbOverride: null });
    expect(deleted).toBe(true);

    const sheetCheck = await getAdHocSheet(sheet.id, { dbOverride: null });
    expect(sheetCheck).toBeNull();

    // Verify All Inventory product is completely intact
    const store = (await import("../src/lib/store")).loadFileStore();
    expect(store.products.find((p) => p.sku === "62773300207")).toBeDefined();
    expect(store.products).toHaveLength(2);
  });

  it("ensures Sheet A and Sheet B are completely independent", async () => {
    const sheetA = await createAdHocSheet({ name: "Sheet A", dbOverride: null });
    const sheetB = await createAdHocSheet({ name: "Sheet B", dbOverride: null });

    await addAdHocItems(sheetA.id, [{ sku: "62773300207", qqh: "5" }], { dbOverride: null });
    await addAdHocItems(sheetB.id, [{ sku: "62773300207", qqh: "20" }], { dbOverride: null });

    const checkA = await getAdHocSheet(sheetA.id, { dbOverride: null });
    const checkB = await getAdHocSheet(sheetB.id, { dbOverride: null });

    expect(checkA?.items[0].qqh).toBe("5");
    expect(checkB?.items[0].qqh).toBe("20");

    // Deleting Sheet A does not affect Sheet B
    await deleteAdHocSheet(sheetA.id, { dbOverride: null });
    const postCheckB = await getAdHocSheet(sheetB.id, { dbOverride: null });
    expect(postCheckB?.items[0].qqh).toBe("20");
  });

  it("supports lookupSkusForAdHoc with duplicate analysis and inventory matching", async () => {
    const sheet = await createAdHocSheet({ name: "Lookup Test Sheet", dbOverride: null });
    await addAdHocItems(sheet.id, [{ sku: "62773300207" }], { dbOverride: null });

    // Look up 3 items:
    // 1. "62773300207" (matched, but already in sheet)
    // 2. "03367414961" (matched, not in sheet)
    // 3. "03367414961" (repeated in pasted list)
    // 4. "UNKNOWN-SKU" (not found)
    const results = await lookupSkusForAdHoc(
      ["62773300207", "03367414961", "03367414961", "UNKNOWN-SKU"],
      sheet.id,
      { dbOverride: null },
    );

    expect(results).toHaveLength(4);

    // Item 1: Already in sheet
    expect(results[0].sku).toBe("62773300207");
    expect(results[0].matched).toBe(true);
    expect(results[0].isAlreadyInSheet).toBe(true);
    expect(results[0].selected).toBe(false); // default unchecked to avoid duplicate rows

    // Item 2: Matched new
    expect(results[1].sku).toBe("03367414961");
    expect(results[1].matched).toBe(true);
    expect(results[1].brand).toBe("Nature's Way");
    expect(results[1].isDuplicateInList).toBe(false);
    expect(results[1].selected).toBe(true);

    // Item 3: Duplicate in pasted list
    expect(results[2].sku).toBe("03367414961");
    expect(results[2].isDuplicateInList).toBe(true);
    expect(results[2].selected).toBe(false); // default unchecked

    // Item 4: Unmatched / Not Found
    expect(results[3].sku).toBe("UNKNOWN-SKU");
    expect(results[3].matched).toBe(false);
    expect(results[3].description).toBe("Not Found");
  });

  it("supports bulk deleting selected items and clearing the entire sheet", async () => {
    const sheet = await createAdHocSheet({ name: "Bulk Delete Test", dbOverride: null });
    const items = await addAdHocItems(
      sheet.id,
      [{ sku: "62773300207" }, { sku: "03367414961" }, { sku: "SKU-3" }],
      { dbOverride: null },
    );
    expect(items).toHaveLength(3);

    // Delete single/selected item
    const deletedCount = await deleteAdHocItems(sheet.id, {
      itemIds: [items[0].id],
      dbOverride: null,
    });
    expect(deletedCount).toBe(1);

    let current = await getAdHocSheet(sheet.id, { dbOverride: null });
    expect(current?.items).toHaveLength(2);

    // Clear entire sheet
    const clearedCount = await deleteAdHocItems(sheet.id, {
      all: true,
      dbOverride: null,
    });
    expect(clearedCount).toBe(2);

    current = await getAdHocSheet(sheet.id, { dbOverride: null });
    expect(current?.items).toHaveLength(0);
  });

  it("supports syncAdHocItems for bulk saving and reordering", async () => {
    const sheet = await createAdHocSheet({ name: "Sync Test", dbOverride: null });
    const items = await addAdHocItems(
      sheet.id,
      [{ sku: "62773300207" }, { sku: "03367414961" }],
      { dbOverride: null },
    );

    // Update staff count fields in bulk
    const synced = await syncAdHocItems(
      sheet.id,
      [
        { id: items[0].id, sku: items[0].sku, qqh: "50", layway: "3", orderIndex: 0 },
        { id: items[1].id, sku: items[1].sku, qqh: "10", prepaid: "2", orderIndex: 1 },
      ],
      { dbOverride: null },
    );

    expect(synced).toHaveLength(2);
    expect(synced[0].qqh).toBe("50");
    expect(synced[0].layway).toBe("3");
    expect(synced[1].qqh).toBe("10");
    expect(synced[1].prepaid).toBe("2");
  });
});

describe("Ad Hoc Count Sheets - Excel Workbook Generation", () => {
  it("generates an Excel workbook with exact 9 columns, freeze panes, and protection", () => {
    const items: AdHocCountItemData[] = [
      {
        id: "item-1",
        sheetId: "sheet-1",
        orderIndex: 0,
        sku: "03367414961", // leading zero!
        brand: "Nature's Way",
        description: "Zinc Lozenges Berry",
        sizeDesc: "60 Lozenges",
        matched: true,
        qqh: "12",
        layway: "1",
        prepaid: "0",
        expiry: "11/27",
        onTransfer: "Hold for Jane",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const buffer = buildAdHocCountWorkbook(items, {
      sheetName: "Ad Hoc Count Sheet",
      date: new Date(2026, 10, 16),
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(100);

    // Verify that standard xlsx parser can read the workbook
    const wb = XLSX.read(buffer, { type: "buffer", raw: true });
    expect(wb.SheetNames).toContain("Inventory Count");

    const ws = wb.Sheets["Inventory Count"];

    // Check Header Row (Row 5)
    expect(ws[`A${AD_HOC_HEADER_ROW}`]?.v).toBe("SKU/UPC");
    expect(ws[`B${AD_HOC_HEADER_ROW}`]?.v).toBe("Brand");
    expect(ws[`C${AD_HOC_HEADER_ROW}`]?.v).toBe("Description");
    expect(ws[`D${AD_HOC_HEADER_ROW}`]?.v).toBe("Size Desc.");
    expect(ws[`E${AD_HOC_HEADER_ROW}`]?.v).toBe("QQH");
    expect(ws[`F${AD_HOC_HEADER_ROW}`]?.v).toBe("LAYWAY");
    expect(ws[`G${AD_HOC_HEADER_ROW}`]?.v).toBe("PREPAID");
    expect(ws[`H${AD_HOC_HEADER_ROW}`]?.v).toBe("Expiry");
    expect(ws[`I${AD_HOC_HEADER_ROW}`]?.v).toBe("On Transfer");

    // Check Data Row (Row 6)
    // SKU must strictly retain leading zero as string
    expect(ws["A6"]?.v).toBe("03367414961");
    expect(ws["B6"]?.v).toBe("Nature's Way");
    expect(ws["C6"]?.v).toBe("Zinc Lozenges Berry");
    expect(ws["D6"]?.v).toBe("60 Lozenges");
    expect(ws["E6"]?.v).toBe("12");
    expect(ws["F6"]?.v).toBe("1");
    expect(ws["G6"]?.v).toBe("0");
    expect(ws["H6"]?.v).toBe("11/27");
    expect(ws["I6"]?.v).toBe("Hold for Jane");

    // Verify Title and Layout
    expect(ws["A1"]?.v).toBe("INVENTORY COUNTS");
    expect(ws["A2"]?.v).toContain("Date: November 16, 2026");
    expect(ws["A3"]?.v).toBe("Staff:");

    // Inspect the underlying XML inside the CFB zip package to verify freeze panes and sheet protection
    const CFB = XLSX.CFB as any;
    const zip = CFB.read(buffer, { type: "buffer" });
    const sheetEntry = zip.FileIndex.find((f: any) => f.name.includes("sheet1.xml"));
    expect(sheetEntry).toBeDefined();

    const sheetXml = Buffer.from(sheetEntry.content).toString("utf8");

    // Verify freeze pane: xSplit="4" (columns A-D frozen), ySplit="5" (header row frozen), topLeftCell="E6"
    expect(sheetXml).toContain('xSplit="4"');
    expect(sheetXml).toContain(`ySplit="${AD_HOC_HEADER_ROW}"`);
    expect(sheetXml).toContain('topLeftCell="E6"');
    expect(sheetXml).toContain('state="frozen"');

    // Verify worksheet protection: sheet="1", selectLockedCells="1", selectUnlockedCells="1"
    expect(sheetXml).toContain('sheetProtection sheet="1"');
    expect(sheetXml).toContain('selectLockedCells="1"');
    expect(sheetXml).toContain('selectUnlockedCells="1"');

    // Verify style XML: locked="0" exists for editable cells (QQH..On Transfer and Staff)
    const styleEntry = zip.FileIndex.find((f: any) => f.name.includes("styles.xml"));
    expect(styleEntry).toBeDefined();
    const stylesXml = Buffer.from(styleEntry.content).toString("utf8");
    expect(stylesXml).toContain('<protection locked="0"/>');
  });
});
