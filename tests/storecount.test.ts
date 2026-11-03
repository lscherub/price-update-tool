import { describe, expect, it, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import {
  storeCountNewPrice,
  buildStoreCountWorkbook,
  STORE_COUNT_EXCEL_HEADER,
  storeCountExcelPrice,
} from "@/lib/storeCountPricing";
import { resolveLiveProducts } from "@/lib/lookup";
import { POST as storeCountExcelPost } from "@/app/api/sessions/[id]/storecount/excel/route";
import { POST as fullVendorStorecountPost } from "@/app/api/fullvendor/sessions/[id]/storecount/excel/route";
import { POST as storeCountPdfPost } from "@/app/api/sessions/[id]/storecount/route";
import * as storeModule from "@/lib/store";
import { FULL_VENDOR_KIND } from "@/lib/fullVendor";

// Mock auth & db for hermetic testing
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ email: "admin@example.com", role: "admin" }),
}));

vi.mock("@/lib/db", () => ({
  getPrisma: () => null,
  isDbConnectionError: () => false,
  dbUnreachableResponse: () => ({ status: 503 }),
  productionDbGuard: () => null,
}));

let fakeStore: storeModule.StoreShape;

vi.mock("@/lib/store", async () => {
  const actual = await vi.importActual<typeof storeModule>("@/lib/store");
  return {
    ...actual,
    loadFileStore: () => fakeStore,
    saveFileStore: (s: storeModule.StoreShape) => {
      fakeStore = s;
    },
  };
});

beforeEach(() => {
  fakeStore = {
    products: [
      {
        id: "prod-new-1",
        sku: "SKU-WITH-SIZE",
        normalizedSku: "SKU-WITH-SIZ",
        productNumber: "PN-1",
        description: "Product With Size",
        vendor: "Test Vendor",
        brand: "Test Brand",
        listCost: "10.00",
        price: "20.00",
        sizeDesc: "120TB",
        isInactive: false,
      },
      {
        id: "prod-new-2",
        sku: "SKU-WITHOUT-SIZE",
        normalizedSku: "SKU-WITHOUT-SIZ",
        productNumber: "PN-2",
        description: "Product Without Size",
        vendor: "Test Vendor",
        brand: "Test Brand",
        listCost: "15.00",
        price: "30.00",
        sizeDesc: "",
        isInactive: false,
      },
      {
        id: "prod-new-3",
        sku: "SKU-INACTIVE",
        normalizedSku: "SKU-INACTIV",
        productNumber: "PN-3",
        description: "Inactive Product",
        vendor: "Test Vendor",
        brand: "Test Brand",
        listCost: "5.00",
        price: "10.00",
        sizeDesc: "60CAP",
        isInactive: true,
      },
    ],
    vendorDiscounts: [],
    brandDiscounts: [],
    sessions: [
      {
        id: "sess-1",
        vendor: "Test Vendor",
        name: "Test Session",
        status: "Ready",
        notes: "",
        createdBy: "admin@example.com",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "fv-sess-1",
        vendor: "Test Vendor",
        name: "Full Vendor Session",
        status: "Ready",
        notes: "",
        createdBy: "admin@example.com",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    items: [
      {
        id: "item-1",
        sessionId: "sess-1",
        rawVendorSku: "SKU-WITH-SIZE",
        cleanedSku: "SKU-WITH-SIZE",
        cleanedOverridden: false,
        productId: null, // Detached! Simulates inventory re-import / clear
        productNumber: "PN-1",
        productName: "Product With Size",
        brand: "Test Brand",
        vendor: "Test Vendor",
        discount: "0",
        currentListPrice: "10.00",
        vendorListPriceNew: "12.00",
        ourNewListPrice: "12.00",
        marginDivisor: "0.605",
        ourNewRetailPrice: "19.99",
        oldRetailPrice: "20.00",
        nearest9: "19.99",
        notes: "",
        isInactive: false,
        matched: true,
        updatedAt: new Date().toISOString(),
      },
      {
        id: "item-2",
        sessionId: "sess-1",
        rawVendorSku: "SKU-WITHOUT-SIZE",
        cleanedSku: "SKU-WITHOUT-SIZE",
        cleanedOverridden: false,
        productId: null, // Detached!
        productNumber: "PN-2",
        productName: "Product Without Size",
        brand: "Test Brand",
        vendor: "Test Vendor",
        discount: "0",
        currentListPrice: "15.00",
        vendorListPriceNew: "15.00",
        ourNewListPrice: "15.00",
        marginDivisor: "0.605",
        ourNewRetailPrice: "30.00",
        oldRetailPrice: "30.00",
        nearest9: "29.99",
        notes: "",
        isInactive: false,
        matched: true,
        updatedAt: new Date().toISOString(),
      },
      {
        id: "fv-item-1",
        sessionId: "fv-sess-1",
        rawVendorSku: "SKU-WITH-SIZE",
        cleanedSku: "SKU-WITH-SIZE",
        cleanedOverridden: false,
        productId: null, // Detached!
        productNumber: "PN-1",
        productName: "Product With Size",
        brand: "Test Brand",
        vendor: "Test Vendor",
        discount: "0",
        currentListPrice: "10.00",
        vendorListPriceNew: "12.00",
        ourNewListPrice: "12.00",
        marginDivisor: "0.605",
        ourNewRetailPrice: "19.99",
        oldRetailPrice: "20.00",
        nearest9: "19.99",
        notes: "",
        isInactive: false,
        matched: true,
        updatedAt: new Date().toISOString(),
      },
      {
        id: "fv-item-2",
        sessionId: "fv-sess-1",
        rawVendorSku: "SKU-WITHOUT-SIZE",
        cleanedSku: "SKU-WITHOUT-SIZE",
        cleanedOverridden: false,
        productId: null, // Detached!
        productNumber: "PN-2",
        productName: "Product Without Size",
        brand: "Test Brand",
        vendor: "Test Vendor",
        discount: "0",
        currentListPrice: "15.00",
        vendorListPriceNew: "15.00",
        ourNewListPrice: "15.00",
        marginDivisor: "0.605",
        ourNewRetailPrice: "30.00",
        oldRetailPrice: "30.00",
        nearest9: "29.99",
        notes: "",
        isInactive: false,
        matched: true,
        updatedAt: new Date().toISOString(),
      },
    ],
    users: [],
    exports: [
      {
        id: "exp-1",
        sessionId: "fv-sess-1",
        kind: FULL_VENDOR_KIND,
        createdBy: "admin@example.com",
        createdAt: new Date().toISOString(),
        detail: "{}",
      },
    ],
  };
});

describe("resolveLiveProducts", () => {
  it("resolves sizeDesc even when productId is null", async () => {
    const items = [
      { cleanedSku: "SKU-WITH-SIZE", productId: null },
      { cleanedSku: "SKU-WITHOUT-SIZE", productId: null },
      { cleanedSku: "NONEXISTENT", productId: null },
    ];
    const resolve = await resolveLiveProducts(items, null);

    const hit1 = resolve(items[0]);
    expect(hit1).toBeDefined();
    expect(hit1?.sizeDesc).toBe("120TB");

    const hit2 = resolve(items[1]);
    expect(hit2).toBeDefined();
    expect(hit2?.sizeDesc).toBe("");

    const hit3 = resolve(items[2]);
    expect(hit3).toBeUndefined();
  });

  it("resolves sizeDesc via candidate matching", async () => {
    // rawVendorSku candidate lookup with vendor formatted SKU
    const items = [{ cleanedSku: "", rawVendorSku: "0 58854 04522 7", productId: null }];
    fakeStore.products.push({
      id: "prod-cand-1",
      sku: "058854045227",
      normalizedSku: "05885404522",
      productNumber: "PN-CAND",
      description: "Candidate Match",
      vendor: "Test Vendor",
      brand: "Test Brand",
      listCost: "10.00",
      price: "20.00",
      sizeDesc: "250ML",
      isInactive: false,
    });
    const resolve = await resolveLiveProducts(items, null);
    const hit = resolve(items[0]);
    expect(hit).toBeDefined();
    expect(hit?.sizeDesc).toBe("250ML");
  });
});

describe("Store Count Excel Export (POST /api/sessions/[id]/storecount/excel)", () => {
  it("populates Size Desc. when productId is null", async () => {
    const req = new Request("http://localhost/api/sessions/sess-1/storecount/excel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await storeCountExcelPost(req, { params: Promise.resolve({ id: "sess-1" }) });
    expect(res.status).toBe(200);

    const buf = Buffer.from(await res.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets["Store Count"];
    expect(ws).toBeDefined();

    const aoa: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    expect(aoa[0]).toEqual([...STORE_COUNT_EXCEL_HEADER]);

    // Row 1: SKU-WITH-SIZE must have sizeDesc "120TB"
    expect(aoa[1][0]).toBe("SKU-WITH-SIZE");
    expect(aoa[1][1]).toBe("Product With Size");
    expect(aoa[1][2]).toBe("120TB");
    expect(aoa[1][3]).toBe("19.99");

    // Row 2: SKU-WITHOUT-SIZE must remain blank
    expect(aoa[2][0]).toBe("SKU-WITHOUT-SIZE");
    expect(aoa[2][1]).toBe("Product Without Size");
    expect(aoa[2][2]).toBe("");
    expect(aoa[2][3]).toBe("29.99");
  });
});

describe("Digital Store Count Excel Export (POST /api/fullvendor/sessions/[id]/storecount/excel)", () => {
  it("populates Size Desc. when productId is null", async () => {
    const req = new Request("http://localhost/api/fullvendor/sessions/fv-sess-1/storecount/excel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await fullVendorStorecountPost(req, { params: Promise.resolve({ id: "fv-sess-1" }) });
    expect(res.status).toBe(200);

    const buf = Buffer.from(await res.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets["Store Count"];
    expect(ws).toBeDefined();

    const aoa: (string | number)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    // Header row is index 5
    expect(aoa[5]).toEqual([
      "SKU", "Description", "Size Desc.", "New Price", "QOH", "Layaway", "Prepaid", "Expiry", "Notes",
    ]);

    // Data rows
    expect(aoa[6][0]).toBe("SKU-WITH-SIZE");
    expect(aoa[6][1]).toBe("Product With Size");
    expect(aoa[6][2]).toBe("120TB");

    expect(aoa[7][0]).toBe("SKU-WITHOUT-SIZE");
    expect(aoa[7][1]).toBe("Product Without Size");
    expect(aoa[7][2]).toBe("");
  });
});

describe("Store Count PDF Export (POST /api/sessions/[id]/storecount)", () => {
  it("succeeds and generates PDF with live product size resolution", async () => {
    const req = new Request("http://localhost/api/sessions/sess-1/storecount", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await storeCountPdfPost(req, { params: Promise.resolve({ id: "sess-1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const bytes = await res.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});


describe("store count PDF New Price rule", () => {
  it("leaves New Price blank when Nearest 9 equals Old Retail", () => {
    expect(storeCountNewPrice("61.99", "61.99")).toBe("");
  });

  it("shows Nearest 9 when it differs from Old Retail", () => {
    expect(storeCountNewPrice("62.29", "61.99")).toBe("62.29");
  });

describe("store count Excel price rule (never blank when a price exists)", () => {
  it("uses the new retail price when the price changed", () => {
    expect(storeCountExcelPrice("62.29", "61.99")).toBe("62.29");
  });

  it("falls back to the current retail price when unchanged (PDF blanks here)", () => {
    expect(storeCountExcelPrice("61.99", "61.99")).toBe("61.99");
    // The PDF rule blanks this case — the Excel rule must not.
    expect(storeCountNewPrice("61.99", "61.99")).toBe("");
  });

  it("uses the current retail price when there is no new price", () => {
    expect(storeCountExcelPrice(null, "61.99")).toBe("61.99");
    expect(storeCountExcelPrice("", "61.99")).toBe("61.99");
  });

  it("uses the new price when there is no current price", () => {
    expect(storeCountExcelPrice("62.29", null)).toBe("62.29");
  });

  it("is blank only when neither price exists", () => {
    expect(storeCountExcelPrice(null, null)).toBe("");
  });
});

describe("store count Excel workbook (SKU/price association)", () => {
  it("builds a valid .xlsx with the Store Count columns and correct SKU-price pairs", () => {
    const buf = buildStoreCountWorkbook([
      { cleanedSku: "SKU-CHANGED", productName: "Changed Product", sizeDesc: "60VSG", price: "62.29" },
      { cleanedSku: "SKU-SAME", productName: "Unchanged Product", sizeDesc: "30CAP", price: "61.99" },
    ]);
    // A real workbook (ZIP magic), not a renamed CSV.
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets["Store Count"];
    expect(ws).toBeDefined();
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });
    expect(aoa[0]).toEqual([...STORE_COUNT_EXCEL_HEADER]);
    // Every row keeps its own SKU -> price association, in order.
    expect(aoa[1]).toEqual(["SKU-CHANGED", "Changed Product", "60VSG", "62.29", "", "", ""]);
    expect(aoa[2]).toEqual(["SKU-SAME", "Unchanged Product", "30CAP", "61.99", "", "", ""]);
  });
});


  it("handles missing values without new calculation", () => {
    expect(storeCountNewPrice(null, "61.99")).toBe("");
    expect(storeCountNewPrice("62.29", null)).toBe("62.29");
    expect(storeCountNewPrice("61.9", "61.90")).toBe("");
  });
});
