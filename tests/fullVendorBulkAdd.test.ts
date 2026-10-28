import { describe, expect, it, vi } from "vitest";
import {
  buildWorksheetItemIndex,
  matchWorksheetItem,
  computeFullVendorBulkPreview,
  applyFullVendorBulkUpsert,
  type WorksheetItemLite,
} from "@/lib/fullVendorBulkAdd";
import { computeBulkAddPreview } from "@/lib/bulkAddServer";
import type { StoreShape } from "@/lib/store";
import type { BulkAddInputRow } from "@/lib/bulkAdd";

// Mock DB to null for hermetic testing
vi.mock("@/lib/db", () => ({
  getPrisma: () => null,
  isDbConnectionError: () => false,
  dbUnreachableResponse: () => ({ status: 503 }),
  productionDbGuard: () => null,
}));

const TEST_STORE: StoreShape = {
  products: [
    {
      id: "prod-1",
      sku: "06895801011",
      normalizedSku: "06895801011",
      productNumber: "ECO1011",
      description: "ORGANIC APPLE CIDER VINEGAR 473ML",
      vendor: "ECOTREND GREENS",
      brand: "BRAGG",
      listCost: "6.20",
      price: "10.49",
      sizeDesc: "473ML",
      isInactive: false,
    },
    {
      id: "prod-2",
      sku: "06895801014",
      normalizedSku: "06895801014",
      productNumber: "ECO1014",
      description: "ORGANIC APPLE CIDER VINEGAR 946ML",
      vendor: "ECOTREND GREENS",
      brand: "BRAGG",
      listCost: "11.50",
      price: "18.99",
      sizeDesc: "946ML",
      isInactive: false,
    },
    {
      id: "prod-3",
      sku: "62491774008",
      normalizedSku: "62491774008",
      productNumber: "AOR74008",
      description: "NA VIT K2 SOFTGEL",
      vendor: "A.O.R. INC.",
      brand: "AOR",
      listCost: "19.66",
      price: "31.70",
      sizeDesc: "60VSG",
      isInactive: false,
    },
  ],
  vendorDiscounts: [
    { id: "vd-1", vendor: "ECOTREND GREENS", normalizedVendor: "ecotrend greens", defaultDiscount: "5.00" },
    { id: "vd-2", vendor: "A.O.R. INC.", normalizedVendor: "a.o.r. inc.", defaultDiscount: "10.00" },
  ],
  brandDiscounts: [],
  sessions: [
    {
      id: "sess-fv-1",
      name: "Full Vendor - Ecotrend",
      vendor: "ECOTREND GREENS",
      status: "draft",
      notes: "",
      createdBy: "test@example.com",
      createdAt: "2026-10-28T12:00:00Z",
      updatedAt: "2026-10-28T12:00:00Z",
    },
  ],
  items: [],
  users: [],
  exports: [{ id: "exp-1", sessionId: "sess-fv-1", kind: "fullvendor-created", createdAt: "2026-10-28T12:00:00Z", createdBy: "test@example.com", detail: "{}" }],
};

let storeState: StoreShape = JSON.parse(JSON.stringify(TEST_STORE));

vi.mock("@/lib/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/store")>();
  return {
    ...actual,
    loadFileStore: () => storeState,
    saveFileStore: (s: StoreShape) => {
      storeState = JSON.parse(JSON.stringify(s));
    },
  };
});

describe("Full Vendor Bulk Add Rows — Upsert Behavior", () => {
  const baseExistingItems: WorksheetItemLite[] = [
    {
      id: "item-1",
      sessionId: "sess-fv-1",
      rawVendorSku: "06895801011",
      cleanedSku: "06895801011",
      cleanedOverridden: false,
      productId: "prod-1",
      productNumber: "ECO1011",
      productName: "ORGANIC APPLE CIDER VINEGAR 473ML",
      brand: "BRAGG",
      vendor: "ECOTREND GREENS",
      discount: "5.00",
      currentListPrice: "6.20",
      vendorListPriceNew: null, // blank price
      ourNewListPrice: null,
      marginDivisor: "0.605",
      ourNewRetailPrice: null,
      oldRetailPrice: "10.49",
      nearest9: null,
      nearest9Custom: null,
      notes: "not in vendor price list",
      isInactive: false,
      matched: true,
    },
    {
      id: "item-2",
      sessionId: "sess-fv-1",
      rawVendorSku: "06895801014",
      cleanedSku: "06895801014",
      cleanedOverridden: false,
      productId: "prod-2",
      productNumber: "ECO1014",
      productName: "ORGANIC APPLE CIDER VINEGAR 946ML",
      brand: "BRAGG",
      vendor: "ECOTREND GREENS",
      discount: "5.00",
      currentListPrice: "11.50",
      vendorListPriceNew: "12.00", // already populated price
      ourNewListPrice: "11.40",
      marginDivisor: "0.605",
      ourNewRetailPrice: "18.84",
      oldRetailPrice: "18.99",
      nearest9: "18.99",
      nearest9Custom: "19.49", // custom override
      notes: "Existing custom note",
      isInactive: false,
      matched: true,
    },
  ];

  it("1. An existing worksheet product with blank Vendor List Price (New) receives pasted price in its existing row", async () => {
    const input: BulkAddInputRow[] = [
      { cleanedSku: "06895801011", vendorListPriceNew: "9.49" },
    ];

    const preview = await computeFullVendorBulkPreview(input, baseExistingItems);
    expect(preview).toHaveLength(1);
    expect(preview[0].isValid).toBe(true);
    expect(preview[0].targetAction).toBe("update");
    expect(preview[0].existingItemId).toBe("item-1");
    expect(preview[0].vendorListPriceNew).toBe("9.49");
    expect(preview[0].ourNewListPrice).toBeTruthy();
    expect(preview[0].ourNewRetailPrice).toBeTruthy();
    expect(preview[0].nearest9).toBeTruthy();
    // Default "not in vendor price list" should be cleared when new price is supplied
    expect(preview[0].notes).toBe("");
  });

  it("2. An existing product with a populated price is updated when a new price is supplied", async () => {
    const input: BulkAddInputRow[] = [
      { cleanedSku: "06895801014", vendorListPriceNew: "17.36" },
    ];

    const preview = await computeFullVendorBulkPreview(input, baseExistingItems);
    expect(preview).toHaveLength(1);
    expect(preview[0].isValid).toBe(true);
    expect(preview[0].targetAction).toBe("update");
    expect(preview[0].existingItemId).toBe("item-2");
    expect(preview[0].vendorListPriceNew).toBe("17.36");
  });

  it("3. A genuinely new SKU is added as a new row", async () => {
    const input: BulkAddInputRow[] = [
      { cleanedSku: "62491774008", vendorListPriceNew: "22.50" },
    ];

    const preview = await computeFullVendorBulkPreview(input, baseExistingItems);
    expect(preview).toHaveLength(1);
    expect(preview[0].isValid).toBe(true);
    expect(preview[0].targetAction).toBe("add");
    expect(preview[0].existingItemId).toBeUndefined();
    expect(preview[0].productName).toBe("NA VIT K2 SOFTGEL");
    expect(preview[0].vendorListPriceNew).toBe("22.50");
  });

  it("4. A blank or omitted pasted field does not erase existing worksheet information (custom retail price, discount, margin, notes)", async () => {
    const input: BulkAddInputRow[] = [
      {
        cleanedSku: "06895801014",
        vendorListPriceNew: "15.00",
        // discount, marginDivisor, notes omitted
      },
    ];

    const preview = await computeFullVendorBulkPreview(input, baseExistingItems);
    expect(preview[0].targetAction).toBe("update");
    expect(preview[0].discount).toBe("5.00"); // preserved
    expect(preview[0].marginDivisor).toBe("0.605"); // preserved
    expect(preview[0].notes).toBe("Existing custom note"); // preserved
    // Custom nearest9 (19.49) is preserved over automatic recalculation
    expect(preview[0].nearest9).toBe("19.49");
  });

  it("5. Leading-zero SKUs match correctly", async () => {
    const index = buildWorksheetItemIndex(baseExistingItems);
    // Exact match with leading zeros preserved
    const match1 = matchWorksheetItem({ cleanedSku: "06895801011" }, index);
    expect(match1.match?.id).toBe("item-1");

    // Also matches if pasted without leading zeros or with spaces
    const match2 = matchWorksheetItem({ cleanedSku: "6895801011" }, index);
    expect(match2.match?.id).toBe("item-1");

    const match3 = matchWorksheetItem({ rawVendorSku: " 06895801011 " }, index);
    expect(match3.match?.id).toBe("item-1");
  });

  it("6. Multiple different SKUs each receive their own correct product details and prices independently", async () => {
    const input: BulkAddInputRow[] = [
      { cleanedSku: "06895801011", vendorListPriceNew: "9.49" },
      { cleanedSku: "06895801014", vendorListPriceNew: "17.36" },
      { cleanedSku: "62491774008", vendorListPriceNew: "22.50" },
    ];

    const preview = await computeFullVendorBulkPreview(input, baseExistingItems);
    expect(preview).toHaveLength(3);

    expect(preview[0].cleanedSku).toBe("06895801011");
    expect(preview[0].vendorListPriceNew).toBe("9.49");
    expect(preview[0].targetAction).toBe("update");
    expect(preview[0].productNumber).toBe("ECO1011");

    expect(preview[1].cleanedSku).toBe("06895801014");
    expect(preview[1].vendorListPriceNew).toBe("17.36");
    expect(preview[1].targetAction).toBe("update");
    expect(preview[1].productNumber).toBe("ECO1014");

    expect(preview[2].cleanedSku).toBe("62491774008");
    expect(preview[2].vendorListPriceNew).toBe("22.50");
    expect(preview[2].targetAction).toBe("add");
    expect(preview[2].productNumber).toBe("AOR74008");
  });

  it("7. Duplicate SKUs within one pasted batch are flagged for review", async () => {
    const input: BulkAddInputRow[] = [
      { cleanedSku: "06895801011", vendorListPriceNew: "9.49" },
      { cleanedSku: "06895801011", vendorListPriceNew: "10.00" }, // duplicate in batch
    ];

    const preview = await computeFullVendorBulkPreview(input, baseExistingItems);
    expect(preview).toHaveLength(2);
    expect(preview[0].isDuplicateInBatch).toBe(true);
    expect(preview[1].isDuplicateInBatch).toBe(true);
  });

  it("8. applyFullVendorBulkUpsert updates matching rows and inserts new rows without duplicating", async () => {
    // Setup file store items
    storeState.items = [
      {
        id: "item-1",
        sessionId: "sess-fv-1",
        rawVendorSku: "06895801011",
        cleanedSku: "06895801011",
        cleanedOverridden: false,
        productId: "prod-1",
        productNumber: "ECO1011",
        productName: "ORGANIC APPLE CIDER VINEGAR 473ML",
        brand: "BRAGG",
        vendor: "ECOTREND GREENS",
        discount: "5.00",
        currentListPrice: "6.20",
        vendorListPriceNew: null,
        ourNewListPrice: null,
        marginDivisor: "0.605",
        ourNewRetailPrice: null,
        oldRetailPrice: "10.49",
        nearest9: null,
        nearest9Custom: null,
        notes: "not in vendor price list",
        isInactive: false,
        matched: true,
        updatedAt: "2026-10-28T12:00:00Z",
      },
    ];

    const input: BulkAddInputRow[] = [
      { cleanedSku: "06895801011", vendorListPriceNew: "9.49" },
      { cleanedSku: "62491774008", vendorListPriceNew: "22.50" },
    ];

    const result = await applyFullVendorBulkUpsert(
      "sess-fv-1",
      input,
      baseExistingItems,
      null, // file store
    );

    expect(result.updatedCount).toBe(1);
    expect(result.addedCount).toBe(1);

    // Verify item-1 in store was updated, not duplicated
    const sessionItems = storeState.items.filter((i) => i.sessionId === "sess-fv-1");
    expect(sessionItems).toHaveLength(2);

    const updated = sessionItems.find((i) => i.id === "item-1");
    expect(updated?.vendorListPriceNew).toBe("9.49");
    expect(updated?.ourNewListPrice).toBeTruthy();

    const added = sessionItems.find((i) => i.id !== "item-1");
    expect(added?.cleanedSku).toBe("62491774008");
    expect(added?.vendorListPriceNew).toBe("22.50");
  });

  it("9. Standard New Price Update Bulk Add continues to behave unchanged (flags worksheet duplicates)", async () => {
    const existingSkus = ["06895801011"];
    const input: BulkAddInputRow[] = [
      { cleanedSku: "06895801011", vendorListPriceNew: "9.49" },
    ];

    const preview = await computeBulkAddPreview(input, existingSkus);
    expect(preview).toHaveLength(1);
    // In standard workflow, it is flagged as Duplicate (Worksheet)
    expect(preview[0].isDuplicateInWorksheet).toBe(true);
    expect(preview[0].targetAction).toBeUndefined();
  });
});
