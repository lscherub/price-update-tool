import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  sanitizeSheetName,
  formatExportDate,
  buildExportFilename,
  buildContentDisposition,
  getFilenameFromContentDisposition,
} from "@/lib/exportFilename";
import { POST as storeCountExcelPost } from "@/app/api/sessions/[id]/storecount/excel/route";
import { POST as fullVendorStorecountPost } from "@/app/api/fullvendor/sessions/[id]/storecount/excel/route";
import { POST as storeCountPdfPost } from "@/app/api/sessions/[id]/storecount/route";
import { GET as posExportGet } from "@/app/api/sessions/[id]/export/route";
import * as storeModule from "@/lib/store";
import { FULL_VENDOR_KIND } from "@/lib/fullVendor";

// Mock auth & db
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
        id: "p1",
        sku: "SKU1",
        normalizedSku: "SKU1",
        productNumber: "PN1",
        description: "Product 1",
        vendor: "Test Vendor",
        brand: "Test Brand",
        listCost: "10.00",
        price: "20.00",
        sizeDesc: "60 caps",
        isInactive: false,
      },
    ],
    vendorDiscounts: [],
    brandDiscounts: [],
    sessions: [
      {
        id: "sess-flora",
        vendor: "Flora",
        name: "Flora November 2026",
        status: "Ready",
        notes: "",
        createdBy: "admin@example.com",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "sess-special",
        vendor: "Flora",
        name: "Flora / Organic Traditions: November 2026",
        status: "Ready",
        notes: "",
        createdBy: "admin@example.com",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "fv-sess-flora",
        vendor: "Flora",
        name: "Flora November 2026",
        status: "Ready",
        notes: "",
        createdBy: "admin@example.com",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "sess-historical",
        vendor: "Old Vendor",
        name: "Old Vendor - June 2025",
        status: "Exported",
        notes: "",
        createdBy: "admin@example.com",
        createdAt: "2025-06-01T00:00:00.000Z",
        updatedAt: "2025-06-01T00:00:00.000Z",
      },
    ],
    items: [
      {
        id: "item-1",
        sessionId: "sess-flora",
        rawVendorSku: "SKU1",
        cleanedSku: "SKU1",
        cleanedOverridden: false,
        productId: "p1",
        productNumber: "PN1",
        productName: "Product 1",
        brand: "Test Brand",
        vendor: "Flora",
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
        id: "item-special",
        sessionId: "sess-special",
        rawVendorSku: "SKU1",
        cleanedSku: "SKU1",
        cleanedOverridden: false,
        productId: "p1",
        productNumber: "PN1",
        productName: "Product 1",
        brand: "Test Brand",
        vendor: "Flora",
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
        id: "fv-item-1",
        sessionId: "fv-sess-flora",
        rawVendorSku: "SKU1",
        cleanedSku: "SKU1",
        cleanedOverridden: false,
        productId: "p1",
        productNumber: "PN1",
        productName: "Product 1",
        brand: "Test Brand",
        vendor: "Flora",
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
        id: "hist-item-1",
        sessionId: "sess-historical",
        rawVendorSku: "SKU1",
        cleanedSku: "SKU1",
        cleanedOverridden: false,
        productId: "p1",
        productNumber: "PN1",
        productName: "Product 1",
        brand: "Old Brand",
        vendor: "Old Vendor",
        discount: "0",
        currentListPrice: "10.00",
        vendorListPriceNew: "10.00",
        ourNewListPrice: "10.00",
        marginDivisor: "0.605",
        ourNewRetailPrice: "19.99",
        oldRetailPrice: "19.99",
        nearest9: "19.99",
        notes: "",
        isInactive: false,
        matched: true,
        updatedAt: "2025-06-01T00:00:00.000Z",
      },
    ],
    users: [],
    exports: [
      {
        id: "fv-exp-1",
        sessionId: "fv-sess-flora",
        kind: FULL_VENDOR_KIND,
        createdBy: "admin@example.com",
        createdAt: new Date().toISOString(),
        detail: "{}",
      },
    ],
  };
});

describe("sanitizeSheetName", () => {
  it("preserves standard sheet names", () => {
    expect(sanitizeSheetName("Flora November 2026")).toBe("Flora November 2026");
    expect(sanitizeSheetName("A.O.R. INC. - October 1, 2026")).toBe("A.O.R. INC. - October 1, 2026");
  });

  it("replaces slash and colon with ' - ' as specified in prompt example", () => {
    expect(sanitizeSheetName("Flora / Organic Traditions: November 2026")).toBe(
      "Flora - Organic Traditions - November 2026",
    );
  });

  it("removes invalid filesystem characters like * ? < > | \"", () => {
    expect(sanitizeSheetName('Special *Sheet* "Name" <v1> ?')).toBe("Special Sheet Name v1");
  });

  it("trims leading and trailing spaces, hyphens, and periods", () => {
    expect(sanitizeSheetName("  - . Flora November 2026 . -  ")).toBe("Flora November 2026");
  });

  it("falls back to 'Price Update' when empty, null, or only punctuation", () => {
    expect(sanitizeSheetName("")).toBe("Price Update");
    expect(sanitizeSheetName(null)).toBe("Price Update");
    expect(sanitizeSheetName(undefined)).toBe("Price Update");
    expect(sanitizeSheetName("   / : * ?   ")).toBe("Price Update");
  });
});

describe("formatExportDate", () => {
  it("formats date to YYYY-MM-DD", () => {
    const d = new Date(2026, 10, 3); // Nov 3, 2026
    expect(formatExportDate(d)).toBe("2026-11-03");
  });
});

describe("buildExportFilename", () => {
  const fixedDate = new Date(2026, 10, 3);

  it("generates Store Count Excel filename matching prompt specification", () => {
    expect(buildExportFilename("Flora November 2026", "Store Count", "xlsx", fixedDate)).toBe(
      "Flora November 2026 - Store Count - 2026-11-03.xlsx",
    );
  });

  it("generates Digital Store Count Excel filename matching prompt specification", () => {
    expect(buildExportFilename("Flora November 2026", "Digital Store Count", "xlsx", fixedDate)).toBe(
      "Flora November 2026 - Digital Store Count - 2026-11-03.xlsx",
    );
  });

  it("generates Store Count PDF filename matching prompt specification", () => {
    expect(buildExportFilename("Flora November 2026", "Store Count", "pdf", fixedDate)).toBe(
      "Flora November 2026 - Store Count - 2026-11-03.pdf",
    );
  });

  it("generates POS Export CSV filename matching prompt specification", () => {
    expect(buildExportFilename("Flora November 2026", "POS Export", "csv", fixedDate)).toBe(
      "Flora November 2026 - POS Export - 2026-11-03.csv",
    );
  });

  it("sanitizes slash/colon sheet name in full filename", () => {
    expect(buildExportFilename("Flora / Organic Traditions: November 2026", "Store Count", "xlsx", fixedDate)).toBe(
      "Flora - Organic Traditions - November 2026 - Store Count - 2026-11-03.xlsx",
    );
  });
});

describe("buildContentDisposition & getFilenameFromContentDisposition", () => {
  it("encodes and decodes filename in Content-Disposition header", () => {
    const filename = "Flora November 2026 - Store Count - 2026-11-03.xlsx";
    const header = buildContentDisposition(filename);
    expect(header).toContain('filename="Flora November 2026 - Store Count - 2026-11-03.xlsx"');
    expect(header).toContain("filename*=UTF-8''");
    expect(getFilenameFromContentDisposition(header)).toBe(filename);
  });
});

describe("API Export Endpoints Content-Disposition filenames", () => {
  const todayStr = formatExportDate(new Date());

  it("Store Count Excel uses price sheet name in Content-Disposition", async () => {
    const req = new Request("http://localhost/api/sessions/sess-flora/storecount/excel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await storeCountExcelPost(req, { params: Promise.resolve({ id: "sess-flora" }) });
    expect(res.status).toBe(200);

    const cd = res.headers.get("Content-Disposition");
    const filename = getFilenameFromContentDisposition(cd);
    expect(filename).toBe(`Flora November 2026 - Store Count - ${todayStr}.xlsx`);
    expect(filename).not.toContain("sess-flora");
  });

  it("Digital Store Count Excel uses price sheet name in Content-Disposition", async () => {
    const req = new Request("http://localhost/api/fullvendor/sessions/fv-sess-flora/storecount/excel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await fullVendorStorecountPost(req, { params: Promise.resolve({ id: "fv-sess-flora" }) });
    expect(res.status).toBe(200);

    const cd = res.headers.get("Content-Disposition");
    const filename = getFilenameFromContentDisposition(cd);
    expect(filename).toBe(`Flora November 2026 - Digital Store Count - ${todayStr}.xlsx`);
    expect(filename).not.toContain("fv-sess-flora");
  });

  it("Store Count PDF uses price sheet name in Content-Disposition", async () => {
    const req = new Request("http://localhost/api/sessions/sess-flora/storecount", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await storeCountPdfPost(req, { params: Promise.resolve({ id: "sess-flora" }) });
    expect(res.status).toBe(200);

    const cd = res.headers.get("Content-Disposition");
    const filename = getFilenameFromContentDisposition(cd);
    expect(filename).toBe(`Flora November 2026 - Store Count - ${todayStr}.pdf`);
    expect(filename).not.toContain("sess-flora");
  });

  it("POS Export uses price sheet name in Content-Disposition", async () => {
    const req = new Request("http://localhost/api/sessions/sess-flora/export?kind=pos");
    const res = await posExportGet(req, { params: Promise.resolve({ id: "sess-flora" }) });
    expect(res.status).toBe(200);

    const cd = res.headers.get("Content-Disposition");
    const filename = getFilenameFromContentDisposition(cd);
    expect(filename).toBe(`Flora November 2026 - POS Export - ${todayStr}.csv`);
    expect(filename).not.toContain("sess-flora");
  });

  it("sanitizes special characters in sheet name during export", async () => {
    const req = new Request("http://localhost/api/sessions/sess-special/storecount/excel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await storeCountExcelPost(req, { params: Promise.resolve({ id: "sess-special" }) });
    expect(res.status).toBe(200);

    const cd = res.headers.get("Content-Disposition");
    const filename = getFilenameFromContentDisposition(cd);
    expect(filename).toBe(`Flora - Organic Traditions - November 2026 - Store Count - ${todayStr}.xlsx`);
  });

  it("uses updated name when price sheet is renamed", async () => {
    // Rename session
    const sess = fakeStore.sessions.find((s) => s.id === "sess-flora");
    if (sess) sess.name = "Flora Renamed December 2026";

    const req = new Request("http://localhost/api/sessions/sess-flora/storecount/excel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await storeCountExcelPost(req, { params: Promise.resolve({ id: "sess-flora" }) });
    expect(res.status).toBe(200);

    const cd = res.headers.get("Content-Disposition");
    const filename = getFilenameFromContentDisposition(cd);
    expect(filename).toBe(`Flora Renamed December 2026 - Store Count - ${todayStr}.xlsx`);
  });

  it("uses historical sheet's name for historical sheet exports", async () => {
    const req = new Request("http://localhost/api/sessions/sess-historical/storecount/excel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await storeCountExcelPost(req, { params: Promise.resolve({ id: "sess-historical" }) });
    expect(res.status).toBe(200);

    const cd = res.headers.get("Content-Disposition");
    const filename = getFilenameFromContentDisposition(cd);
    expect(filename).toBe(`Old Vendor - June 2025 - Store Count - ${todayStr}.xlsx`);
  });
});

