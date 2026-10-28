import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST as addProductPost } from "@/app/api/inventory/product/route";
import { POST as fullVendorSessionPost } from "@/app/api/fullvendor/sessions/route";
import { POST as fullVendorStorecountPost } from "@/app/api/fullvendor/sessions/[id]/storecount/excel/route";
import * as storeModule from "@/lib/store";
import * as authModule from "@/lib/auth";
import * as XLSX from "xlsx";

// Hermetic testing using file store fallback
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

beforeEach(() => {
  fakeStore = {
    products: [
      {
        id: "p1",
        sku: "058854045227",
        normalizedSku: "05885404522",
        productNumber: "PN-101",
        description: "Zinc Lozenge",
        vendor: "A.O.R. INC.",
        brand: "AOR",
        listCost: "10.00",
        price: "19.99",
        sizeDesc: "60 caps",
        isInactive: false,
      },
      {
        id: "p2",
        sku: "058854045234",
        normalizedSku: "05885404523",
        productNumber: "PN-102",
        description: "B-Complex",
        vendor: "A.O.R. INC.",
        brand: "AOR",
        listCost: "15.00",
        price: "29.99",
        sizeDesc: "90 caps",
        isInactive: true,
      },
    ],
    vendorDiscounts: [
      {
        id: "vd1",
        vendor: "A.O.R. INC.",
        normalizedVendor: "a.o.r. inc.",
        defaultDiscount: "10.00",
      },
    ],
    brandDiscounts: [],
    sessions: [],
    items: [],
    users: [],
    exports: [],
  };

  vi.mocked(authModule.getSession).mockResolvedValue({
    id: "user-1",
    email: "admin@example.com",
    role: "admin",
  });
});

describe("POST /api/inventory/product (Feature 1)", () => {
  it("rejects unauthorized requests", async () => {
    vi.mocked(authModule.getSession).mockResolvedValueOnce(null);
    const req = new Request("http://localhost/api/inventory/product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku: "123" }),
    });
    const res = await addProductPost(req);
    expect(res.status).toBe(401);
  });

  it("validates required SKU", async () => {
    const req = new Request("http://localhost/api/inventory/product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku: "" }),
    });
    const res = await addProductPost(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("SKU is required.");
  });

  it("validates numeric List Cost and Price", async () => {
    const req = new Request("http://localhost/api/inventory/product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku: "NEW-1", listCost: "invalid" }),
    });
    const res = await addProductPost(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("List Cost");
  });

  it("rejects negative numeric prices", async () => {
    const req = new Request("http://localhost/api/inventory/product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku: "NEW-1", price: "-12.50" }),
    });
    const res = await addProductPost(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("negative");
  });

  it("enforces SKU uniqueness against existing inventory", async () => {
    const req = new Request("http://localhost/api/inventory/product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku: "058854045227" }), // already in fakeStore
    });
    const res = await addProductPost(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("already exists");
  });

  it("successfully creates a new product with all required fields", async () => {
    const req = new Request("http://localhost/api/inventory/product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku: "00998877",
        productNumber: "PN-99",
        description: "Omega-3 EPA/DHA",
        vendor: "A.O.R. INC.",
        brand: "AOR",
        listCost: "12.50",
        price: "24.99",
        sizeDesc: "120 softgels",
        status: "active",
      }),
    });
    const res = await addProductPost(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.product.sku).toBe("00998877");
    expect(data.product.description).toBe("Omega-3 EPA/DHA");
    expect(data.product.isInactive).toBe(false);
    expect(data.product.listCost).toBe("12.50");
    expect(data.product.price).toBe("24.99");

    // Product is now in store
    const inStore = fakeStore.products.find((p) => p.sku === "00998877");
    expect(inStore).toBeDefined();
    expect(inStore?.normalizedSku).toBe("0099887");
  });

  it("creates inactive product when status is 'inactive'", async () => {
    const req = new Request("http://localhost/api/inventory/product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku: "INACT-99",
        productNumber: "PN-99",
        description: "Old item",
        vendor: "V",
        brand: "B",
        listCost: "5.00",
        price: "10.00",
        sizeDesc: "50ml",
        status: "inactive",
      }),
    });
    const res = await addProductPost(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.product.isInactive).toBe(true);
  });
});

describe("POST /api/fullvendor/sessions (Feature 2)", () => {
  it("creates a Full Vendor Price Update session matching vendor inventory", async () => {
    const pasted = "058854045227\t11.50"; // matches p1 only; p2 is missing from paste
    const req = new Request("http://localhost/api/fullvendor/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendor: "A.O.R. INC.",
        pastedData: pasted,
      }),
    });
    const res = await fullVendorSessionPost(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.total).toBe(2); // both products in vendor inventory retained
    expect(data.priced).toBe(1); // p1 matched
    expect(data.missing).toBe(1); // p2 missing

    const sid = data.sessionId;
    expect(sid).toBeDefined();

    // Verify session in store
    const session = fakeStore.sessions.find((s) => s.id === sid);
    expect(session).toBeDefined();
    expect(session?.vendor).toBe("A.O.R. INC.");

    // Verify items in store: both products present!
    const sessionItems = fakeStore.items.filter((i) => i.sessionId === sid);
    expect(sessionItems).toHaveLength(2);

    const item1 = sessionItems.find((i) => i.productId === "p1")!;
    expect(item1.vendorListPriceNew).toBe("11.50");
    expect(item1.ourNewListPrice).toBeDefined();
    expect(item1.nearest9).toBeDefined();

    const item2 = sessionItems.find((i) => i.productId === "p2")!;
    // p2 was not in the vendor pasted list: no fabricated price!
    expect(item2.vendorListPriceNew).toBeNull();
    expect(item2.ourNewListPrice).toBeNull();
    expect(item2.nearest9).toBeNull();
    expect(item2.isInactive).toBe(true); // inactive status preserved
    expect(item2.notes).toContain("Review: not in vendor price list");
  });

  it("includes only selected products when selectedProductIds is provided", async () => {
    // Select ONLY p1; exclude p2
    const req = new Request("http://localhost/api/fullvendor/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendor: "A.O.R. INC.",
        pastedData: "058854045227\t11.50\n058854045234\t15.00",
        selectedProductIds: ["p1"],
      }),
    });
    const res = await fullVendorSessionPost(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.total).toBe(1); // only 1 product in session

    const sid = data.sessionId;
    const sessionItems = fakeStore.items.filter((i) => i.sessionId === sid);
    expect(sessionItems).toHaveLength(1);
    expect(sessionItems[0].productId).toBe("p1");

    // Crucial safeguard: verify p2 was NOT deleted or altered in inventory!
    const p2InInventory = fakeStore.products.find((p) => p.id === "p2");
    expect(p2InInventory).toBeDefined();
    expect(p2InInventory?.sku).toBe("058854045234");
  });

  it("rejects request if selectedProductIds is empty", async () => {
    const req = new Request("http://localhost/api/fullvendor/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendor: "A.O.R. INC.",
        pastedData: "058854045227\t11.50",
        selectedProductIds: [],
      }),
    });
    const res = await fullVendorSessionPost(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("No products selected");
  });
});

describe("POST /api/fullvendor/sessions/[id]/storecount/excel (Feature 3)", () => {
  it("exports Digital Store Count Excel for full vendor session", async () => {
    // 1. Create session first
    const createReq = new Request("http://localhost/api/fullvendor/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendor: "A.O.R. INC.",
        pastedData: "058854045227\t11.50",
      }),
    });
    const createRes = await fullVendorSessionPost(createReq);
    const { sessionId } = await createRes.json();

    // 2. Request Excel export
    const excelReq = new Request(`http://localhost/api/fullvendor/sessions/${sessionId}/storecount/excel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const excelRes = await fullVendorStorecountPost(excelReq, { params: Promise.resolve({ id: sessionId }) });
    expect(excelRes.status).toBe(200);
    expect(excelRes.headers.get("Content-Type")).toContain("spreadsheetml");

    const buf = Buffer.from(await excelRes.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets["Store Count"];
    expect(ws).toBeDefined();

    const aoa: (string | number)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    // Header row is index 5
    expect(aoa[5]).toEqual([
      "SKU", "Description", "Size Desc.", "New Price", "QOH", "Layaway", "Prepaid", "Expiry", "Notes",
    ]);

    // Data rows: both products exported
    expect(aoa.length).toBe(6 + 2);
    // Product 1 (has price change)
    expect(aoa[6][0]).toBe("058854045227");
    expect(aoa[6][1]).toBe("Zinc Lozenge");
    expect(aoa[6][2]).toBe("60 caps");
    expect(aoa[6][3]).not.toBe(""); // has new price

    // Product 2 (missing from vendor list, unchanged)
    expect(aoa[7][0]).toBe("058854045234");
    expect(aoa[7][1]).toBe("B-Complex");
    expect(aoa[7][2]).toBe("90 caps");
    expect(aoa[7][3]).toBe(""); // blank new price when unchanged!
  });

  it("rejects non-full-vendor sessions", async () => {
    // Normal session without fullvendor-created marker
    fakeStore.sessions.push({
      id: "norm-1",
      vendor: "Vendor",
      name: "Normal Update",
      status: "Ready",
      notes: "",
      createdBy: "admin@example.com",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const req = new Request("http://localhost/api/fullvendor/sessions/norm-1/storecount/excel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await fullVendorStorecountPost(req, { params: Promise.resolve({ id: "norm-1" }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("only available for Full Vendor");
  });
});

