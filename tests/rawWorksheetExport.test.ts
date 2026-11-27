import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { POST as rawExportPost } from "@/app/api/sessions/[id]/raw-export/route";
import {
  buildRawWorksheetWorkbook,
  CANONICAL_RAW_WORKSHEET_COLUMNS,
  resolveRawWorksheetColumns,
  type RawWorksheetRowInput,
} from "@/lib/rawWorksheetExcel";
import * as authModule from "@/lib/auth";
import * as storeModule from "@/lib/store";

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
    saveFileStore: vi.fn((s: storeModule.StoreShape) => {
      fakeStore = s;
    }),
  };
});

const SAMPLE_ROWS: RawWorksheetRowInput[] = [
  {
    rawVendorSku: "0058854045227",
    cleanedSku: "005885404522",
    cleanedOverridden: false,
    productNumber: "AOR04522",
    productName: "Vitamin D3 Softgels 120ct",
    brand: "AOR",
    vendor: "A.O.R. INC.",
    discount: "10.00",
    currentListPrice: "18.00",
    vendorListPriceNew: "22.50",
    ourNewListPrice: "20.25",
    marginDivisor: "0.605",
    ourNewRetailPrice: "33.47",
    oldRetailPrice: "29.99",
    nearest9: "33.49",
    nearest9Custom: null,
    notes: "Price increase Q4",
    isInactive: false,
    matched: true,
  },
  {
    rawVendorSku: "624917740080",
    cleanedSku: "62491774008",
    cleanedOverridden: true,
    productNumber: "AOR74008",
    productName: "Vitamin K2 Softgels 60ct",
    brand: "AOR",
    vendor: "A.O.R. INC.",
    discount: "5.00",
    currentListPrice: "19.66",
    vendorListPriceNew: "21.00",
    ourNewListPrice: "19.95",
    marginDivisor: "0.605",
    ourNewRetailPrice: "32.98",
    oldRetailPrice: "31.99",
    nearest9: "31.99",
    nearest9Custom: "31.99",
    notes: "Hold at old retail",
    isInactive: true,
    matched: true,
  },
  {
    rawVendorSku: "999999999999",
    cleanedSku: "99999999999",
    cleanedOverridden: false,
    productNumber: "",
    productName: "",
    brand: "",
    vendor: "",
    discount: "0.00",
    currentListPrice: null,
    vendorListPriceNew: "14.00",
    ourNewListPrice: "14.00",
    marginDivisor: "0.605",
    ourNewRetailPrice: "23.14",
    oldRetailPrice: null,
    nearest9: "23.19",
    nearest9Custom: null,
    notes: "",
    isInactive: false,
    matched: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  const now = new Date().toISOString();
  fakeStore = {
    ...storeModule.emptyStore(),
    sessions: [
      {
        id: "sess-raw-1",
        vendor: "A.O.R. INC.",
        name: "AOR Nov 2026 Update",
        status: "Being Reviewed",
        notes: "Internal review note",
        createdBy: "staff@example.com",
        createdAt: now,
        updatedAt: now,
      },
    ],
    items: SAMPLE_ROWS.map((r, i) => ({
      id: `item-${i + 1}`,
      sessionId: "sess-raw-1",
      productId: null,
      ...r,
      discount: r.discount ?? "0.00",
      marginDivisor: r.marginDivisor ?? "0.605",
      updatedAt: now,
    })),
  };
});

describe("buildRawWorksheetWorkbook", () => {
  it("exports all 16 canonical displayed columns in exact order, preserves leading zeros, and stays unlocked/editable", () => {
    const buf = buildRawWorksheetWorkbook(SAMPLE_ROWS, { sheetName: "AOR Nov 2026" });
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toEqual(["AOR Nov 2026"]);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });

    expect(matrix[0]).toEqual(CANONICAL_RAW_WORKSHEET_COLUMNS.map((c) => c.label));
    expect(matrix.length).toBe(4); // 1 header + 3 rows
    // Leading zeros preserved on Raw Vendor SKU & Cleaned SKU
    expect(matrix[1][0]).toBe("0058854045227");
    expect(matrix[1][1]).toBe("005885404522");
    // Numeric values preserved as real numbers in Excel
    expect(matrix[1][6]).toBe(10);
    expect(matrix[1][8]).toBe(22.5);
    expect(matrix[1][13]).toBe(33.49);
    // Computed Flags column included
    expect(String(matrix[1][15])).toContain("Changed");
    expect(String(matrix[2][15])).toContain("Inactive");
    expect(String(matrix[2][15])).toContain("Manual SKU");
    expect(String(matrix[2][15])).toContain("Custom");
    expect(String(matrix[3][15])).toContain("Not Found");

    // Must NOT include sheetProtection (file must be fully editable in Excel)
    const rawXml = buf.toString("latin1");
    expect(rawXml).not.toContain("<sheetProtection");
  });

  it("preserves custom displayed column order & headings and strips any non-displayed internal DB fields", () => {
    const cols = resolveRawWorksheetColumns([
      { key: "id", label: "Internal ID" },
      { key: "sessionId", label: "Session ID" },
      { key: "productName", label: "Product Name" },
      { key: "cleanedSku", label: "Cleaned SKU" },
      { key: "nearest9", label: "Nearest 9" },
      { key: "createdAt", label: "Created At" },
    ]);
    expect(cols.map((c) => c.key)).toEqual(["productName", "cleanedSku", "nearest9"]);

    const buf = buildRawWorksheetWorkbook(SAMPLE_ROWS, { columns: cols });
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
    expect(matrix[0]).toEqual(["Product Name", "Cleaned SKU", "Nearest 9"]);
    expect(matrix[1]).toEqual(["Vitamin D3 Softgels 120ct", "005885404522", 33.49]);
  });
});

describe("POST /api/sessions/[id]/raw-export", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(authModule.getSession).mockResolvedValueOnce(null);
    const req = new Request("http://localhost/api/sessions/sess-raw-1/raw-export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await rawExportPost(req, { params: Promise.resolve({ id: "sess-raw-1" }) });
    expect(res.status).toBe(401);
  });

  it("includes ALL worksheet rows even when a partial sort order is sent, and is strictly read-only", async () => {
    vi.mocked(authModule.getSession).mockResolvedValueOnce({
      id: "u1",
      email: "staff@example.com",
      role: "staff",
    });

    const beforeStatus = fakeStore.sessions[0].status;
    const beforeExportsLen = fakeStore.exports.length;
    const beforeItemsJson = JSON.stringify(fakeStore.items);

    const req = new Request("http://localhost/api/sessions/sess-raw-1/raw-export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Simulate a filtered/sorted view passing only item-2 first; item-1 & item-3 MUST still be included!
        ids: ["item-2"],
        columns: [
          { key: "cleanedSku", label: "Cleaned SKU" },
          { key: "productName", label: "Product Name" },
          { key: "nearest9", label: "Nearest 9" },
          { key: "notes", label: "Notes" },
        ],
      }),
    });

    const res = await rawExportPost(req, { params: Promise.resolve({ id: "sess-raw-1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("content-disposition")).toContain("Raw Worksheet");
    expect(res.headers.get("content-disposition")).toContain(".xlsx");

    const buf = Buffer.from(await res.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });

    expect(matrix[0]).toEqual(["Cleaned SKU", "Product Name", "Nearest 9", "Notes"]);
    // All 3 rows present, with item-2 ordered first followed by item-1 and item-3
    expect(matrix.length).toBe(4);
    expect(matrix[1][0]).toBe("62491774008");
    expect(matrix[2][0]).toBe("005885404522");
    expect(matrix[3][0]).toBe("99999999999");

    // Strictly read-only: no writes, status untouched, items untouched, exports log untouched
    expect(storeModule.saveFileStore).not.toHaveBeenCalled();
    expect(fakeStore.sessions[0].status).toBe(beforeStatus);
    expect(fakeStore.exports.length).toBe(beforeExportsLen);
    expect(JSON.stringify(fakeStore.items)).toBe(beforeItemsJson);
  });
});
