import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET as posExportGet, POST as posExportPost } from "@/app/api/sessions/[id]/export/route";
import { FULL_VENDOR_KIND } from "@/lib/fullVendor";
import * as storeModule from "@/lib/store";
import * as authModule from "@/lib/auth";

vi.mock("@/lib/db", () => ({
  getPrisma: () => null,
  isDbConnectionError: () => false,
  dbUnreachableResponse: () => ({ status: 503 }),
  productionDbGuard: () => null,
}));

let fakeStore: storeModule.StoreShape;

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

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

function parseCsv(csv: string): { headers: string[]; rows: string[][] } {
  const lines = csv.trim().split("\n").map((line) => line.split(","));
  return {
    headers: lines[0] ?? [],
    rows: lines.slice(1),
  };
}

beforeEach(() => {
  fakeStore = {
    products: [
      {
        id: "p1",
        sku: "SKU100",
        normalizedSku: "SKU100",
        productNumber: "PN-101",
        description: "Product 100",
        vendor: "Vendor A",
        brand: "Brand A",
        listCost: "10.00",
        price: "15.00",
        sizeDesc: "Small",
        isInactive: false,
      },
      {
        id: "p2",
        sku: "SKU200",
        normalizedSku: "SKU200",
        productNumber: "PN-102",
        description: "Product 200",
        vendor: "Vendor A",
        brand: "Brand A",
        listCost: "20.00",
        price: "25.00",
        sizeDesc: "Medium",
        isInactive: false,
      },
      {
        id: "p3",
        sku: "SKU300",
        normalizedSku: "SKU300",
        productNumber: "PN-103",
        description: "Product 300",
        vendor: "Vendor A",
        brand: "Brand A",
        listCost: "30.00",
        price: "35.00",
        sizeDesc: "Large",
        isInactive: true,
      },
    ],
    vendorDiscounts: [],
    brandDiscounts: [],
    sessions: [
      {
        id: "fv-sess-1",
        vendor: "Vendor A",
        name: "Full Vendor Update - Vendor A",
        status: "Ready",
        notes: "",
        createdBy: "staff@example.com",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "norm-sess-1",
        vendor: "Vendor A",
        name: "Regular Price Update",
        status: "Ready",
        notes: "",
        createdBy: "staff@example.com",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    items: [
      // 1. Changed price (nearest9: 18.99 != oldRetailPrice: 15.00)
      {
        id: "item-1",
        sessionId: "fv-sess-1",
        rawVendorSku: "RAW-SKU-1",
        cleanedSku: "SKU100",
        cleanedOverridden: false,
        productId: "p1",
        productNumber: "PN-101",
        productName: "Product 100",
        brand: "Brand A",
        vendor: "Vendor A",
        discount: "0",
        currentListPrice: "10.00",
        vendorListPriceNew: "11.00",
        ourNewListPrice: "11.00",
        marginDivisor: "0.605",
        ourNewRetailPrice: "18.18",
        oldRetailPrice: "15.00",
        nearest9: "18.99",
        nearest9Custom: null,
        notes: "",
        isInactive: false,
        matched: true,
        updatedAt: "2026-11-09T01:00:00Z",
      },
      // 2. Unchanged price (nearest9: 25.00 == oldRetailPrice: 25.00)
      {
        id: "item-2",
        sessionId: "fv-sess-1",
        rawVendorSku: "RAW-SKU-2",
        cleanedSku: "SKU200",
        cleanedOverridden: false,
        productId: "p2",
        productNumber: "PN-102",
        productName: "Product 200",
        brand: "Brand A",
        vendor: "Vendor A",
        discount: "0",
        currentListPrice: "20.00",
        vendorListPriceNew: "15.00",
        ourNewListPrice: "15.00",
        marginDivisor: "0.605",
        ourNewRetailPrice: "24.79",
        oldRetailPrice: "25.00",
        nearest9: "25.00",
        nearest9Custom: null,
        notes: "",
        isInactive: false,
        matched: true,
        updatedAt: "2026-11-09T02:00:00Z",
      },
      // 3. Empty New Price (nearest9 is null, oldRetailPrice: 35.00, inactive)
      {
        id: "item-3",
        sessionId: "fv-sess-1",
        rawVendorSku: "RAW-SKU-3",
        cleanedSku: "SKU300",
        cleanedOverridden: false,
        productId: "p3",
        productNumber: "PN-103",
        productName: "Product 300",
        brand: "Brand A",
        vendor: "Vendor A",
        discount: "0",
        currentListPrice: "30.00",
        vendorListPriceNew: null,
        ourNewListPrice: null,
        marginDivisor: "0.605",
        ourNewRetailPrice: null,
        oldRetailPrice: "35.00",
        nearest9: null,
        nearest9Custom: null,
        notes: "",
        isInactive: true,
        matched: true,
        updatedAt: "2026-11-09T03:00:00Z",
      },
      // 4. Manual SKU flag item with changed price
      {
        id: "item-4",
        sessionId: "fv-sess-1",
        rawVendorSku: "RAW-CUSTOM-4",
        cleanedSku: "MANUAL-SKU-400",
        cleanedOverridden: true,
        productId: null,
        productNumber: "",
        productName: "Manual Item",
        brand: "Brand A",
        vendor: "Vendor A",
        discount: "0",
        currentListPrice: null,
        vendorListPriceNew: "5.00",
        ourNewListPrice: "5.00",
        marginDivisor: "0.605",
        ourNewRetailPrice: "8.26",
        oldRetailPrice: "6.99",
        nearest9: "8.99",
        nearest9Custom: null,
        notes: "Manual SKU override",
        isInactive: false,
        matched: false,
        updatedAt: "2026-11-09T04:00:00Z",
      },
      // Item for normal session
      {
        id: "norm-item-1",
        sessionId: "norm-sess-1",
        rawVendorSku: "NORM-1",
        cleanedSku: "SKU100",
        cleanedOverridden: false,
        productId: "p1",
        productNumber: "PN-101",
        productName: "Product 100",
        brand: "Brand A",
        vendor: "Vendor A",
        discount: "0",
        currentListPrice: "10.00",
        vendorListPriceNew: "11.00",
        ourNewListPrice: "11.00",
        marginDivisor: "0.605",
        ourNewRetailPrice: "18.18",
        oldRetailPrice: "15.00",
        nearest9: "18.99",
        nearest9Custom: null,
        notes: "",
        isInactive: false,
        matched: true,
        updatedAt: "2026-11-09T01:00:00Z",
      },
    ],
    users: [],
    exports: [
      // fullvendor-created marker on fv-sess-1
      {
        id: "fv-exp-1",
        sessionId: "fv-sess-1",
        kind: FULL_VENDOR_KIND,
        createdBy: "staff@example.com",
        createdAt: new Date().toISOString(),
        detail: "{}",
      },
    ],
  };

  vi.mocked(authModule.getSession).mockResolvedValue({
    id: "user-1",
    email: "staff@example.com",
    role: "admin",
  });
});

describe("GET /api/sessions/[id]/export (Preserved Existing Functionality)", () => {
  it("normal session exports POS CSV without options", async () => {
    const req = new Request("http://localhost/api/sessions/norm-sess-1/export?kind=pos");
    const res = await posExportGet(req, { params: Promise.resolve({ id: "norm-sess-1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv");
    const csv = await res.text();
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(["Cleaned SKU", "Our New List Price", "Nearest 9"]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toEqual(["SKU100", "11.00", "18.99"]);
  });
});

describe("POST /api/sessions/[id]/export (Full Vendor Selection Options)", () => {
  it("rejects non-full-vendor sessions when attempting to use export options", async () => {
    const req = new Request("http://localhost/api/sessions/norm-sess-1/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "all" }),
    });
    const res = await posExportPost(req, { params: Promise.resolve({ id: "norm-sess-1" }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("only available for Full Vendor Price Updates");
  });

  it("Option 1: Export All Products exports every product including empty New Price and preserves empty price", async () => {
    const req = new Request("http://localhost/api/sessions/fv-sess-1/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "all" }),
    });
    const res = await posExportPost(req, { params: Promise.resolve({ id: "fv-sess-1" }) });
    expect(res.status).toBe(200);
    const csv = await res.text();
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(["Cleaned SKU", "Our New List Price", "Nearest 9"]);
    expect(parsed.rows).toHaveLength(4);

    // item 1: changed price
    expect(parsed.rows[0]).toEqual(["SKU100", "11.00", "18.99"]);
    // item 2: unchanged price
    expect(parsed.rows[1]).toEqual(["SKU200", "15.00", "25.00"]);
    // item 3: empty new price (preserved as empty string in CSV)
    expect(parsed.rows[2]).toEqual(["SKU300", "", ""]);
    // item 4: manual SKU flag item
    expect(parsed.rows[3]).toEqual(["MANUAL-SKU-400", "5.00", "8.99"]);
  });

  it("Option 2: Export All Products — Populate All Prices populates unchanged/empty prices with effective retail price", async () => {
    const req = new Request("http://localhost/api/sessions/fv-sess-1/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "all-populate" }),
    });
    const res = await posExportPost(req, { params: Promise.resolve({ id: "fv-sess-1" }) });
    expect(res.status).toBe(200);
    const csv = await res.text();
    const parsed = parseCsv(csv);
    expect(parsed.rows).toHaveLength(4);

    // item 1: changed price
    expect(parsed.rows[0]).toEqual(["SKU100", "11.00", "18.99"]);
    // item 2: unchanged price
    expect(parsed.rows[1]).toEqual(["SKU200", "15.00", "25.00"]);
    // item 3: empty new price is POPULATED with original retail price 35.00!
    expect(parsed.rows[2]).toEqual(["SKU300", "", "35.00"]);
    // item 4: manual SKU
    expect(parsed.rows[3]).toEqual(["MANUAL-SKU-400", "5.00", "8.99"]);
  });

  it("Option 3: Export Products with Price Changes Only excludes products without price change", async () => {
    const req = new Request("http://localhost/api/sessions/fv-sess-1/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "changed" }),
    });
    const res = await posExportPost(req, { params: Promise.resolve({ id: "fv-sess-1" }) });
    expect(res.status).toBe(200);
    const csv = await res.text();
    const parsed = parseCsv(csv);

    // item 1 (18.99 != 15.00) and item 4 (8.99 != 6.99) included
    // item 2 (25.00 == 25.00) and item 3 (no new price) excluded
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual(["SKU100", "11.00", "18.99"]);
    expect(parsed.rows[1]).toEqual(["MANUAL-SKU-400", "5.00", "8.99"]);
  });

  it("Option 4: Export Selected Products exports only rows selected by ID", async () => {
    // Select item-2 (unchanged) and item-3 (empty new price, inactive)
    const req = new Request("http://localhost/api/sessions/fv-sess-1/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "selected", selectedIds: ["item-2", "item-3"] }),
    });
    const res = await posExportPost(req, { params: Promise.resolve({ id: "fv-sess-1" }) });
    expect(res.status).toBe(200);
    const csv = await res.text();
    const parsed = parseCsv(csv);

    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual(["SKU200", "15.00", "25.00"]);
    expect(parsed.rows[1]).toEqual(["SKU300", "", ""]);
  });

  it("Option 4: returns 400 when no items are selected", async () => {
    const req = new Request("http://localhost/api/sessions/fv-sess-1/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "selected", selectedIds: [] }),
    });
    const res = await posExportPost(req, { params: Promise.resolve({ id: "fv-sess-1" }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("No products selected for export.");
  });

  it("sets session status to Exported and records export in ExportLog", async () => {
    const req = new Request("http://localhost/api/sessions/fv-sess-1/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "all" }),
    });
    await posExportPost(req, { params: Promise.resolve({ id: "fv-sess-1" }) });

    const sess = fakeStore.sessions.find((s) => s.id === "fv-sess-1");
    expect(sess?.status).toBe("Exported");

    const exportEntry = fakeStore.exports.find(
      (e) => e.sessionId === "fv-sess-1" && e.kind === "pos",
    );
    expect(exportEntry).toBeDefined();
    expect(exportEntry?.detail).toBe("4 rows");
  });
});
