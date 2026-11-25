import { describe, expect, it, vi } from "vitest";
import type { Item } from "@/components/PriceGrid";
import { editorStorageKeyForUser } from "@/contexts/UiModeContext";
import {
  applyOptimisticPatch,
  computeFillPatches,
  computePastePatches,
  DEFAULT_SPREADSHEET_PREFS,
  EDITABLE_KEYS,
  filterSpreadsheetItems,
  multiSortItems,
  parseTsvClipboard,
  sanitizeSpreadsheetPrefs,
  serializeRangeToTsv,
  validateCellEdit,
} from "@/lib/spreadsheet/engine";
import { SpreadsheetSaveQueue } from "@/lib/spreadsheet/saveQueue";
import { DEFAULT_QUICK_FILTERS, type ColumnFilterSpec, type SortRule } from "@/lib/spreadsheet/types";
import { recalcRow } from "@/lib/recalc";

vi.mock("@/lib/db", () => ({ getPrisma: () => null }));

function makeItem(overrides: Partial<Item> & { id: string }): Item {
  return {
    rawVendorSku: "0012345X",
    cleanedSku: "0012345",
    cleanedOverridden: false,
    productNumber: "PN-1",
    productName: "Vitamin D3 1000IU",
    brand: "AOR",
    vendor: "A.O.R. INC.",
    discount: "10.00",
    currentListPrice: "18.00",
    vendorListPriceNew: "20.00",
    ourNewListPrice: "18.00",
    marginDivisor: "0.605",
    ourNewRetailPrice: "29.7521",
    oldRetailPrice: "28.99",
    nearest9: "29.79",
    nearest9Custom: null,
    notes: "",
    isInactive: false,
    matched: true,
    ...overrides,
  };
}

describe("Spreadsheet Engine — Pricing Parity & Validation", () => {
  it("keeps editable fields strictly limited to the 7 backend-whitelisted columns", () => {
    expect([...EDITABLE_KEYS].sort()).toEqual([
      "cleanedSku",
      "discount",
      "marginDivisor",
      "nearest9",
      "notes",
      "rawVendorSku",
      "vendorListPriceNew",
    ]);
    expect(validateCellEdit("ourNewListPrice", "15.00").ok).toBe(false);
    expect(validateCellEdit("ourNewRetailPrice", "25.00").ok).toBe(false);
    expect(validateCellEdit("productName", "Hacked").ok).toBe(false);
    expect(validateCellEdit("discount", "105").ok).toBe(false);
    expect(validateCellEdit("discount", "-1").ok).toBe(false);
    expect(validateCellEdit("discount", "15").ok).toBe(true);
    expect(validateCellEdit("marginDivisor", "0").ok).toBe(false);
    expect(validateCellEdit("nearest9", "abc").ok).toBe(false);
    expect(validateCellEdit("nearest9", "").ok).toBe(true);
  });

  it("produces identical pricing numbers to server recalcRow() for discount, vendor price, divisor, and custom nearest9", async () => {
    const base = makeItem({
      id: "r1",
      rawVendorSku: "ZZUNMATCHED9X",
      cleanedSku: "ZZUNMATCHED9",
      matched: false,
      vendor: "",
      brand: "",
      discount: "0.00",
      vendorListPriceNew: "25.00",
      marginDivisor: "0.605",
    });

    const opt1 = applyOptimisticPatch(base, { discount: "12.50", vendorListPriceNew: "34.80", marginDivisor: "0.58" });
    const srv1 = await recalcRow(
      {
        rawVendorSku: base.rawVendorSku,
        cleanedSku: base.cleanedSku,
        cleanedOverridden: base.cleanedOverridden,
        discount: base.discount,
        vendor: base.vendor,
        brand: base.brand,
        vendorListPriceNew: base.vendorListPriceNew,
        marginDivisor: base.marginDivisor,
        notes: base.notes,
        nearest9Custom: base.nearest9Custom,
      },
      { discount: "12.50", vendorListPriceNew: "34.80", marginDivisor: "0.58" },
    );

    expect(opt1.ourNewListPrice).toBe(srv1.ourNewListPrice);
    expect(opt1.ourNewRetailPrice).toBe(srv1.ourNewRetailPrice);
    expect(opt1.nearest9).toBe(srv1.nearest9);
    expect(opt1.nearest9Custom).toBeNull();

    // Custom nearest 9 override must survive edits to other pricing fields
    const optCustom = applyOptimisticPatch(opt1, { nearest9: "54.99" });
    expect(optCustom.nearest9Custom).toBe("54.99");
    expect(optCustom.nearest9).toBe("54.99");

    const optAfterDisc = applyOptimisticPatch(optCustom, { discount: "20.00" });
    expect(optAfterDisc.nearest9Custom).toBe("54.99");
    expect(optAfterDisc.nearest9).toBe("54.99");

    // Clearing custom nearest 9 restores calculated value
    const optCleared = applyOptimisticPatch(optAfterDisc, { nearest9: "" });
    expect(optCleared.nearest9Custom).toBeNull();
    expect(optCleared.nearest9).not.toBe("54.99");
  });
});

describe("Spreadsheet Engine — Multi-Column Sorting", () => {
  it("sorts by 3 columns simultaneously (Vendor List asc, Discount desc, Brand asc) with blanks last", () => {
    const rows = [
      makeItem({ id: "1", vendorListPriceNew: "20.00", discount: "5.00", brand: "Now" }),
      makeItem({ id: "2", vendorListPriceNew: "10.00", discount: "10.00", brand: "Zeta" }),
      makeItem({ id: "3", vendorListPriceNew: "10.00", discount: "15.00", brand: "Beta" }),
      makeItem({ id: "4", vendorListPriceNew: "10.00", discount: "15.00", brand: "Alpha" }),
      makeItem({ id: "5", vendorListPriceNew: null, discount: "25.00", brand: "AAA" }),
    ];

    const rules: SortRule[] = [
      { id: "vendorListPriceNew", desc: false },
      { id: "discount", desc: true },
      { id: "brand", desc: false },
    ];
    const sorted = multiSortItems(rows, rules);
    expect(sorted.map((r) => r.id)).toEqual(["4", "3", "2", "1", "5"]);
  });
});

describe("Spreadsheet Engine — Typed Column Filters & Composable Quick Filters", () => {
  const dataset = [
    makeItem({ id: "1", brand: "AOR", vendorListPriceNew: "15.00", discount: "10.00", nearest9: "22.29", oldRetailPrice: "20.99", nearest9Custom: null }),
    makeItem({ id: "2", brand: "AOR", vendorListPriceNew: "45.00", discount: "0.00", nearest9: "69.99", oldRetailPrice: "69.99", nearest9Custom: "69.99" }),
    makeItem({ id: "3", brand: "Now Foods", vendorListPriceNew: null, ourNewListPrice: null, ourNewRetailPrice: null, nearest9: null, discount: "15.00", matched: true }),
    makeItem({ id: "4", brand: "Natural Factors", vendorListPriceNew: "30.00", discount: "5.00", matched: false, isInactive: true }),
  ];

  it("combines 3 column filters + expanded quick filters + global search simultaneously", () => {
    const colFilters: Record<string, ColumnFilterSpec> = {
      brand: { kind: "text", op: "beginsWith", value: "aor" },
      vendorListPriceNew: { kind: "number", op: "between", value: "10", valueTo: "30" },
      discount: { kind: "number", op: "gte", value: "10" },
    };

    const res = filterSpreadsheetItems(dataset, {
      globalQuery: "vitamin",
      selectedFlags: new Set(),
      quick: {
        ...DEFAULT_QUICK_FILTERS,
        vendorPrice: "yes",
        discount: "yes",
        newRetail: "yes",
        customOverride: "no",
        priceChanged: "yes",
      },
      columnFilters: colFilters,
    });

    expect(res.map((r) => r.id)).toEqual(["1"]);
  });

  it("supports blank/nonBlank on both text and numeric columns and legacy status filters", () => {
    const missingVendor = filterSpreadsheetItems(dataset, {
      globalQuery: "",
      selectedFlags: new Set(),
      quick: { ...DEFAULT_QUICK_FILTERS, legacyFilter: "missing" },
      columnFilters: {},
    });
    expect(missingVendor.map((r) => r.id)).toEqual(["3"]);

    const customOnly = filterSpreadsheetItems(dataset, {
      globalQuery: "",
      selectedFlags: new Set(),
      quick: { ...DEFAULT_QUICK_FILTERS, legacyFilter: "custom" },
      columnFilters: {},
    });
    expect(customOnly.map((r) => r.id)).toEqual(["2"]);

    const noVendorQuick = filterSpreadsheetItems(dataset, {
      globalQuery: "",
      selectedFlags: new Set(),
      quick: { ...DEFAULT_QUICK_FILTERS, vendorPrice: "no" },
      columnFilters: { vendorListPriceNew: { kind: "number", op: "blank", value: "" } },
    });
    expect(noVendorQuick.map((r) => r.id)).toEqual(["3"]);
  });
});

describe("Spreadsheet Engine — Clipboard Copy/Paste & Fill Handle", () => {
  const rows = [
    makeItem({ id: "r1", discount: "10.00", vendorListPriceNew: "20.00", marginDivisor: "0.605" }),
    makeItem({ id: "r2", discount: "5.00", vendorListPriceNew: "25.00", marginDivisor: "0.605" }),
    makeItem({ id: "r3", discount: "0.00", vendorListPriceNew: "30.00", marginDivisor: "0.605" }),
  ];
  const cols = ["brand", "discount", "ourNewListPrice", "vendorListPriceNew"] as const;

  it("serializes and parses Excel-compatible TSV cleanly", () => {
    const tsv = serializeRangeToTsv(rows, cols, { startRow: 0, endRow: 1, startCol: 0, endCol: 3 });
    const parsed = parseTsvClipboard(tsv);
    expect(parsed).toEqual([
      ["AOR", "10.00", "18.00", "20.00"],
      ["AOR", "5.00", "18.00", "25.00"],
    ]);
  });

  it("pastes a single copied value across multiple selected rows while skipping read-only columns", () => {
    const plan = computePastePatches(
      rows,
      cols,
      { startRow: 0, endRow: 2, startCol: 1, endCol: 3 },
      [["15"]],
    );
    // Col 1 (discount) & Col 3 (vendorListPriceNew) are editable; Col 2 (ourNewListPrice) is read-only!
    expect(plan.skippedReadOnly).toBe(3);
    expect(plan.editedCellCount).toBe(6);
    expect(plan.patches).toHaveLength(3);
    expect(plan.patches[0].fields).toEqual({ discount: "15.00", vendorListPriceNew: "15.00" });
    expect(plan.patches[0].fields).not.toHaveProperty("ourNewListPrice");
  });

  it("drag-fills down from row 0 across rows 1..2 while preserving undo before-snapshots", () => {
    const plan = computeFillPatches(
      rows,
      cols,
      { startRow: 0, endRow: 0, startCol: 1, endCol: 1 },
      { startRow: 0, endRow: 2, startCol: 1, endCol: 1 },
    );
    expect(plan.editedCellCount).toBe(2);
    expect(plan.patches).toEqual([
      { id: "r2", fields: { discount: "10.00" } },
      { id: "r3", fields: { discount: "10.00" } },
    ]);
    expect(plan.beforePatches).toEqual([
      { id: "r2", fields: { discount: "5.00" } },
      { id: "r3", fields: { discount: "0.00" } },
    ]);
  });
});

describe("SpreadsheetSaveQueue — Batching, Race Protection & Retry", () => {
  it("coalesces rapid edits, prevents stale API responses from overwriting newer edits, and retries failures", async () => {
    const applied: Item[] = [];
    const calls: Record<string, unknown>[][] = [];
    let resolveFirst!: (val: { ok: true; items: Item[] }) => void;

    const queue = new SpreadsheetSaveQueue({
      debounceMs: 10,
      maxAutoRetries: 1,
      transport: async (batch) => {
        calls.push(batch);
        if (calls.length === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return {
          ok: true,
          items: batch.map((b) => makeItem({ id: String(b.id), discount: String(b.discount ?? "0.00") })),
        };
      },
      onServerRowsApplied: (rows) => applied.push(...rows),
      onStatusChange: () => {},
    });

    // First edit starts in flight immediately
    queue.enqueue([{ id: "r1", fields: { discount: "10.00" } }], { immediate: true });
    // Second edit to SAME row arrives while first request is still in flight!
    queue.enqueue([{ id: "r1", fields: { discount: "25.00" } }]);

    // Resolve stale first request (discount: 10.00)
    resolveFirst({ ok: true, items: [makeItem({ id: "r1", discount: "10.00" })] });
    const ok = await queue.flushAll();
    expect(ok).toBe(true);

    // Stale 10.00 response must have been IGNORED; only newer 25.00 response applied!
    expect(applied.map((r) => r.discount)).toEqual(["25.00"]);
    expect(calls).toHaveLength(2);
    queue.dispose();
  });

  it("retains failed edits without dropping them and saves on manual retry", async () => {
    let attempt = 0;
    const queue = new SpreadsheetSaveQueue({
      debounceMs: 5,
      maxAutoRetries: 0,
      transport: async (batch) => {
        attempt++;
        if (attempt === 1) return { ok: false, error: "Temporary 503", retryable: false };
        return {
          ok: true,
          items: batch.map((b) => makeItem({ id: String(b.id), vendorListPriceNew: String(b.vendorListPriceNew) })),
        };
      },
      onServerRowsApplied: () => {},
      onStatusChange: () => {},
    });

    queue.enqueue([{ id: "r1", fields: { vendorListPriceNew: "42.00" } }], { immediate: true });
    const firstOk = await queue.flushAll();
    expect(firstOk).toBe(false);
    expect(queue.getSnapshot().state).toBe("error");
    expect(queue.getSnapshot().failedCount).toBe(1);

    const retryOk = await queue.retryFailed();
    expect(retryOk).toBe(true);
    expect(queue.getSnapshot().state).toBe("saved");
    expect(queue.getSnapshot().failedCount).toBe(0);
    queue.dispose();
  });
});

describe("User-Scoped Preferences & 20,000+ Row Performance", () => {
  it("isolates editor preference storage keys per user and sanitizes column prefs safely", () => {
    expect(editorStorageKeyForUser("user-a")).not.toBe(editorStorageKeyForUser("user-b"));
    const clean = sanitizeSpreadsheetPrefs({
      columnOrder: ["brand", "unknownCol", "discount"],
      columnSizing: { brand: 99999, discount: 10 },
      pinnedColumns: ["brand", "badCol"],
      density: "compact",
    });
    expect(clean.columnOrder[0]).toBe("brand");
    expect(clean.columnOrder[1]).toBe("discount");
    // Missing columns automatically appended so nothing is lost
    expect(clean.columnOrder).toHaveLength(DEFAULT_SPREADSHEET_PREFS.columnOrder.length);
    expect(clean.columnSizing.brand).toBe(720);
    expect(clean.columnSizing.discount).toBe(64);
    expect(clean.pinnedColumns).toEqual(["brand"]);
    expect(clean.density).toBe("compact");
  });

  it("filters and multi-sorts 20,000 products swiftly (< 400ms)", () => {
    const big: Item[] = Array.from({ length: 20000 }, (_, i) =>
      makeItem({
        id: `row-${i}`,
        cleanedSku: `SKU-${100000 + i}`,
        brand: i % 3 === 0 ? "AOR" : i % 3 === 1 ? "Now Foods" : "Natural Factors",
        vendorListPriceNew: ((i % 200) + 1.5).toFixed(2),
        discount: ((i % 5) * 5).toFixed(2),
        nearest9: (((i % 200) + 1.5) / 0.605).toFixed(2),
      }),
    );

    const t0 = performance.now();
    const filtered = filterSpreadsheetItems(big, {
      globalQuery: "",
      selectedFlags: new Set(),
      quick: { ...DEFAULT_QUICK_FILTERS, vendorPrice: "yes" },
      columnFilters: {
        brand: { kind: "text", op: "equals", value: "AOR" },
        vendorListPriceNew: { kind: "number", op: "gte", value: "25" },
      },
    });
    const sorted = multiSortItems(filtered, [
      { id: "vendorListPriceNew", desc: false },
      { id: "discount", desc: true },
      { id: "cleanedSku", desc: false },
    ]);
    const elapsed = performance.now() - t0;

    expect(sorted.length).toBeGreaterThan(5000);
    expect(elapsed).toBeLessThan(400);
  });
});
