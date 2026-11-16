import { describe, it, expect, beforeEach, vi } from "vitest";

// Hermetic tests: mock auth & db
vi.mock("@/lib/auth", () => ({
  getSession: () => Promise.resolve({ user: { email: "admin@example.com", role: "admin" } }),
}));

vi.mock("@/lib/db", () => ({
  getPrisma: () => null,
  isDbConnectionError: () => false,
  dbUnreachableResponse: () => ({ status: 503 }),
  productionDbGuard: () => null,
}));

import { GET as listSheetsGet, POST as createSheetPost } from "../src/app/api/adhoc-counts/route";
import {
  GET as getSheetGet,
  PATCH as updateSheetPatch,
  DELETE as deleteSheetDelete,
} from "../src/app/api/adhoc-counts/[id]/route";
import {
  POST as addItemsPost,
  PUT as syncItemsPut,
  DELETE as deleteItemsDelete,
} from "../src/app/api/adhoc-counts/[id]/items/route";
import { PATCH as updateItemPatch } from "../src/app/api/adhoc-counts/[id]/items/[itemId]/route";
import { POST as lookupPost } from "../src/app/api/adhoc-counts/lookup/route";
import { GET as exportExcelGet } from "../src/app/api/adhoc-counts/[id]/export/excel/route";
import { emptyStore, saveFileStore, type StoreShape } from "../src/lib/store";
import * as XLSX from "xlsx";

describe("Ad Hoc Count Sheets - API Endpoints", () => {
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

  it("handles full lifecycle via API: create, add items, edit SKU, preserve staff data, and export Excel", async () => {
    // 1. Create a sheet
    const createReq = new Request("http://localhost/api/adhoc-counts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "End-to-End Test Sheet" }),
    });
    const createRes = await createSheetPost(createReq);
    expect(createRes.status).toBe(201);
    const createData = await createRes.json();
    const sheetId = createData.sheet.id;
    expect(sheetId).toBeDefined();
    expect(createData.sheet.name).toBe("End-to-End Test Sheet");

    // 2. Pre-lookup SKUs before adding
    const lookupReq = new Request("http://localhost/api/adhoc-counts/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skus: ["62773300207", "03367414961", "UNKNOWN-UPC"],
        sheetId,
      }),
    });
    const lookupRes = await lookupPost(lookupReq);
    expect(lookupRes.status).toBe(200);
    const lookupData = await lookupRes.json();
    expect(lookupData.items).toHaveLength(3);
    expect(lookupData.items[0].matched).toBe(true);
    expect(lookupData.items[1].matched).toBe(true);
    expect(lookupData.items[2].matched).toBe(false);

    // 3. Add products to sheet
    const addItemsReq = new Request(`http://localhost/api/adhoc-counts/${sheetId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { sku: "62773300207" },
          { sku: "UNKNOWN-UPC" },
        ],
      }),
    });
    const addItemsRes = await addItemsPost(addItemsReq, { params: Promise.resolve({ id: sheetId }) });
    expect(addItemsRes.status).toBe(201);
    const addData = await addItemsRes.json();
    expect(addData.items).toHaveLength(2);

    const unknownItem = addData.items.find((i: any) => i.sku === "UNKNOWN-UPC");
    expect(unknownItem).toBeDefined();

    // 4. Staff enters count information into the unknown item
    const updateItemReq = new Request(
      `http://localhost/api/adhoc-counts/${sheetId}/items/${unknownItem.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qqh: "24",
          layway: "3",
          prepaid: "1",
          expiry: "12/28",
          onTransfer: "Transfer from North",
        }),
      },
    );
    const updateItemRes = await updateItemPatch(updateItemReq, {
      params: Promise.resolve({ id: sheetId, itemId: unknownItem.id }),
    });
    expect(updateItemRes.status).toBe(200);

    // 5. User changes the SKU to valid product "03367414961"
    const editSkuReq = new Request(
      `http://localhost/api/adhoc-counts/${sheetId}/items/${unknownItem.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: "03367414961",
        }),
      },
    );
    const editSkuRes = await updateItemPatch(editSkuReq, {
      params: Promise.resolve({ id: sheetId, itemId: unknownItem.id }),
    });
    expect(editSkuRes.status).toBe(200);
    const editedItemData = (await editSkuRes.json()).item;

    // Check that Brand, Description, Size Desc. were refreshed from All Inventory
    expect(editedItemData.sku).toBe("03367414961");
    expect(editedItemData.brand).toBe("Nature's Way");
    expect(editedItemData.description).toBe("Zinc Lozenges Berry");
    expect(editedItemData.sizeDesc).toBe("60 Lozenges");
    expect(editedItemData.matched).toBe(true);

    // CHECK THAT STAFF COUNTS ARE PRESERVED!
    expect(editedItemData.qqh).toBe("24");
    expect(editedItemData.layway).toBe("3");
    expect(editedItemData.prepaid).toBe("1");
    expect(editedItemData.expiry).toBe("12/28");
    expect(editedItemData.onTransfer).toBe("Transfer from North");

    // 6. Test Excel Export endpoint
    const exportReq = new Request(`http://localhost/api/adhoc-counts/${sheetId}/export/excel`);
    const exportRes = await exportExcelGet(exportReq, { params: Promise.resolve({ id: sheetId }) });
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get("content-type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const contentDisposition = exportRes.headers.get("content-disposition");
    expect(decodeURIComponent(contentDisposition || "")).toContain("End-to-End Test Sheet");

    const arrayBuffer = await exportRes.arrayBuffer();
    const wb = XLSX.read(Buffer.from(arrayBuffer), { type: "buffer" });
    expect(wb.SheetNames).toContain("Inventory Count");
    const ws = wb.Sheets["Inventory Count"];

    // 9 columns
    expect(ws["A5"]?.v).toBe("SKU/UPC");
    expect(ws["B5"]?.v).toBe("Brand");
    expect(ws["C5"]?.v).toBe("Description");
    expect(ws["D5"]?.v).toBe("Size Desc.");
    expect(ws["E5"]?.v).toBe("QQH");
    expect(ws["F5"]?.v).toBe("LAYWAY");
    expect(ws["G5"]?.v).toBe("PREPAID");
    expect(ws["H5"]?.v).toBe("Expiry");
    expect(ws["I5"]?.v).toBe("On Transfer");

    // 7. Delete sheet
    const deleteReq = new Request(`http://localhost/api/adhoc-counts/${sheetId}`, {
      method: "DELETE",
    });
    const deleteRes = await deleteSheetDelete(deleteReq, { params: Promise.resolve({ id: sheetId }) });
    expect(deleteRes.status).toBe(200);

    // Verify sheet is gone
    const getReq = new Request(`http://localhost/api/adhoc-counts/${sheetId}`);
    const getRes = await getSheetGet(getReq, { params: Promise.resolve({ id: sheetId }) });
    expect(getRes.status).toBe(404);
  });
});
