import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyStore, type StoreShape } from "@/lib/store";
import {
  findBlockedOldSkuDeletions,
  validateOldSkuReplacement,
  type OldSkuLinkNode,
} from "@/lib/inventoryDb";
import {
  buildUnifiedUpsertSql,
  buildUpsertSql,
  prepareBatch,
  prepareUnifiedBatch,
} from "@/lib/inventoryImport";
import {
  buildInventoryWhere,
  parseInventoryQuery,
} from "@/lib/inventoryQuery";

let memStore: StoreShape = emptyStore();
let mockRole: "admin" | "staff" = "admin";

vi.mock("@/lib/db", () => ({
  getPrisma: () => null,
  productionDbGuard: () => null,
  isDbConnectionError: () => false,
  dbUnreachableResponse: () => new Response("DB error", { status: 503 }),
}));

vi.mock("@/lib/auth", () => ({
  getSession: async () => ({ id: "user-1", email: "admin@test.local", role: mockRole }),
}));

vi.mock("@/lib/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store")>("@/lib/store");
  return {
    ...actual,
    loadFileStore: () => memStore,
    saveFileStore: (s: StoreShape) => {
      memStore = s;
    },
  };
});

import { GET as getProduct, POST as postProduct, DELETE as deleteProducts } from "@/app/api/inventory/product/route";
import { PATCH as patchOldSku } from "@/app/api/inventory/old-sku/route";
import { GET as getInventory } from "@/app/api/inventory/route";

function seedStore() {
  memStore = emptyStore();
  mockRole = "admin";
  memStore.products.push(
    {
      id: "prod-vege-old",
      sku: "73373905102",
      normalizedSku: "7337390510",
      productNumber: "VC-102",
      description: "Vege Cap",
      vendor: "NOW FOODS",
      brand: "NOW",
      listCost: "12.50",
      price: "24.99",
      sizeDesc: "120 caps",
      isInactive: false,
      isOldSku: false,
      supersededByProductId: null,
      previousSkuProductId: null,
    },
    {
      id: "prod-leading-zero",
      sku: "00588504522",
      normalizedSku: "0058850452",
      productNumber: "LZ-1",
      description: "Leading Zero Product",
      vendor: "ECOTREND",
      brand: "AOR",
      listCost: "10.00",
      price: "19.99",
      sizeDesc: "60 caps",
      isInactive: false,
      isOldSku: false,
      supersededByProductId: null,
      previousSkuProductId: null,
    },
    {
      id: "prod-unlinked",
      sku: "999888777",
      normalizedSku: "99988877",
      productNumber: "UN-1",
      description: "Standalone Product",
      vendor: "ECOTREND",
      brand: "AOR",
      listCost: "8.00",
      price: "15.99",
      sizeDesc: "30 ml",
      isInactive: false,
      isOldSku: false,
      supersededByProductId: null,
      previousSkuProductId: null,
    },
  );
  memStore.items.push({
    id: "item-hist-1",
    sessionId: "sess-1",
    rawVendorSku: "999888777",
    cleanedSku: "99988877",
    cleanedOverridden: false,
    productId: "prod-unlinked",
    productNumber: "UN-1",
    productName: "Standalone Product",
    brand: "AOR",
    vendor: "ECOTREND",
    discount: "0.00",
    currentListPrice: "8.00",
    vendorListPriceNew: "9.00",
    ourNewListPrice: "9.00",
    marginDivisor: "0.605",
    ourNewRetailPrice: "14.8760",
    oldRetailPrice: "15.99",
    nearest9: "14.89",
    notes: "",
    isInactive: false,
    matched: true,
    updatedAt: new Date().toISOString(),
  });
}

describe("Old SKU Tracking & Vege Cap Replacement Flow", () => {
  beforeEach(seedStore);

  it("looks up exact SKUs preserving leading zeros as strings", async () => {
    const r1 = await getProduct(new Request("http://localhost/api/inventory/product?sku=00588504522"));
    const d1 = await r1.json();
    expect(r1.status).toBe(200);
    expect(d1.found).toBe(true);
    expect(d1.product.sku).toBe("00588504522");

    // Stripped leading zeros must NOT match the leading-zero SKU
    const r2 = await getProduct(new Request("http://localhost/api/inventory/product?sku=588504522"));
    const d2 = await r2.json();
    expect(d2.found).toBe(false);
  });

  it("executes the Vege Cap 73373905102 -> 73373985102 replacement flow and supports multi-step chains", async () => {
    // 1. Look up existing Vege Cap SKU
    const lookupRes = await getProduct(new Request("http://localhost/api/inventory/product?sku=73373905102"));
    const lookupData = await lookupRes.json();
    expect(lookupData.found).toBe(true);
    expect(lookupData.product.description).toBe("Vege Cap");

    // 2. Create replacement SKU 73373985102 with modified description
    const createRes = await postProduct(
      new Request("http://localhost/api/inventory/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: "73373985102",
          previousSku: "73373905102",
          productNumber: lookupData.product.productNumber,
          description: "Vege Cap (New Formula)",
          vendor: lookupData.product.vendor,
          brand: lookupData.product.brand,
          listCost: "13.00",
          price: "25.99",
          sizeDesc: lookupData.product.sizeDesc,
          status: "active",
        }),
      }),
    );
    const created = await createRes.json();
    expect(createRes.status).toBe(200);
    expect(created.ok).toBe(true);

    // 3. Verify BOTH products exist and links are bidirectional
    const oldRow = memStore.products.find((p) => p.sku === "73373905102")!;
    const newRow = memStore.products.find((p) => p.sku === "73373985102")!;
    expect(oldRow).toBeDefined();
    expect(newRow).toBeDefined();

    // Old product MUST remain unchanged except for isOldSku + supersededByProductId
    expect(oldRow.description).toBe("Vege Cap");
    expect(oldRow.listCost).toBe("12.50");
    expect(oldRow.price).toBe("24.99");
    expect(oldRow.isInactive).toBe(false);
    expect(oldRow.isOldSku).toBe(true);
    expect(oldRow.supersededByProductId).toBe(newRow.id);

    // New product references old product
    expect(newRow.description).toBe("Vege Cap (New Formula)");
    expect(newRow.isOldSku).toBe(false);
    expect(newRow.previousSkuProductId).toBe(oldRow.id);
    expect(newRow.supersededByProductId).toBeNull();

    // 4. Attempting to replace 73373905102 a SECOND time must be rejected with conflict
    const dupRep = await postProduct(
      new Request("http://localhost/api/inventory/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: "73373999999",
          previousSku: "73373905102",
          description: "Duplicate Replacement",
          listCost: "13.00",
          price: "25.99",
          status: "active",
        }),
      }),
    );
    const dupData = await dupRep.json();
    expect(dupRep.status).toBe(409);
    expect(dupData.existingReplacementSku).toBe("73373985102");

    // 5. Multi-step chain: replacing 73373985102 -> 73373999999 succeeds!
    const chainRes = await postProduct(
      new Request("http://localhost/api/inventory/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: "73373999999",
          previousSku: "73373985102",
          description: "Vege Cap v3",
          listCost: "14.00",
          price: "26.99",
          status: "active",
        }),
      }),
    );
    expect(chainRes.status).toBe(200);
    const mid = memStore.products.find((p) => p.sku === "73373985102")!;
    const v3 = memStore.products.find((p) => p.sku === "73373999999")!;
    expect(mid.isOldSku).toBe(true);
    expect(mid.previousSkuProductId).toBe(oldRow.id);
    expect(mid.supersededByProductId).toBe(v3.id);
    expect(v3.isOldSku).toBe(false);
    expect(v3.previousSkuProductId).toBe(mid.id);

    // 6. GET /api/inventory returns resolved SKU links & filters by oldSku
    const invOldRes = await getInventory(new Request("http://localhost/api/inventory?oldSku=true"));
    const invOld = await invOldRes.json();
    expect(invOld.rows.map((r: { sku: string }) => r.sku).sort()).toEqual(["73373905102", "73373985102"]);
    const vegeInList = invOld.rows.find((r: { sku: string }) => r.sku === "73373905102");
    expect(vegeInList.supersededBySku).toBe("73373985102");
  });

  it("rejects missing previous SKU, duplicate new SKU, self-reference, and cycles without corrupting state", async () => {
    const missing = await postProduct(
      new Request("http://localhost/api/inventory/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: "111222333", previousSku: "DOES-NOT-EXIST", listCost: "5", price: "10" }),
      }),
    );
    expect(missing.status).toBe(404);
    expect(memStore.products.find((p) => p.sku === "111222333")).toBeUndefined();

    const selfRef = await postProduct(
      new Request("http://localhost/api/inventory/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: "73373905102", previousSku: "73373905102", listCost: "5", price: "10" }),
      }),
    );
    expect(selfRef.status).toBe(400);

    const dupNew = await postProduct(
      new Request("http://localhost/api/inventory/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: "999888777", previousSku: "73373905102", listCost: "5", price: "10" }),
      }),
    );
    expect(dupNew.status).toBe(409);
    // Original product must NOT have been marked isOldSku when creation failed!
    expect(memStore.products.find((p) => p.sku === "73373905102")?.isOldSku).toBe(false);

    // Pure cycle detection check
    const nodes = new Map<string, OldSkuLinkNode>([
      ["a", { id: "a", sku: "A", previousSkuProductId: null, supersededByProductId: "b" }],
      ["b", { id: "b", sku: "B", previousSkuProductId: "a", supersededByProductId: null }],
    ]);
    const cycle = validateOldSkuReplacement(nodes.get("b")!, "A", nodes, "a");
    expect(cycle.ok).toBe(false);
  });

  it("persists manual Old SKU checkbox toggle via PATCH /api/inventory/old-sku", async () => {
    const r1 = await patchOldSku(
      new Request("http://localhost/api/inventory/old-sku", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "prod-vege-old", isOldSku: true }),
      }),
    );
    expect(r1.status).toBe(200);
    expect(memStore.products.find((p) => p.id === "prod-vege-old")?.isOldSku).toBe(true);

    const r2 = await patchOldSku(
      new Request("http://localhost/api/inventory/old-sku", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "prod-vege-old", isOldSku: false }),
      }),
    );
    expect(r2.status).toBe(200);
    expect(memStore.products.find((p) => p.id === "prod-vege-old")?.isOldSku).toBe(false);
  });

  it("preserves Old SKU columns across full and unified inventory import upserts", () => {
    const prepLegacy = prepareBatch(
      [{ sku: "73373905102", description: "Vege Cap", listCost: "12.50", price: "24.99" }],
      { makeId: () => "id-1" },
    );
    const { sql: legacySql } = buildUpsertSql(prepLegacy.rows);
    expect(legacySql).not.toContain("isOldSku");
    expect(legacySql).not.toContain("supersededByProductId");
    expect(legacySql).not.toContain("previousSkuProductId");

    const prepUnified = prepareUnifiedBatch(
      [{ sku: "73373905102", description: "Vege Cap", listCost: "12.50", price: "24.99", isInactive: false }],
      { makeId: () => "id-1" },
    );
    const { sql: unifiedSql } = buildUnifiedUpsertSql(prepUnified.rows);
    expect(unifiedSql).not.toContain("isOldSku");
    expect(unifiedSql).not.toContain("supersededByProductId");
    expect(unifiedSql).not.toContain("previousSkuProductId");

    // Verify query builder supports oldSku filter cleanly
    const iq = parseInventoryQuery(new URLSearchParams("oldSku=true"));
    expect(buildInventoryWhere(iq)).toMatchObject({ isOldSku: true });
  });
});

describe("Selective Product Deletion & Old SKU Relationship Safety", () => {
  beforeEach(seedStore);

  it("safely deletes unlinked products while detaching (preserving) historical PriceUpdateItems", async () => {
    const res = await deleteProducts(
      new Request("http://localhost/api/inventory/product", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["prod-unlinked"], confirm: true }),
      }),
    );
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.deletedCount).toBe(1);
    expect(d.detachedItems).toBe(1);
    expect(memStore.products.find((p) => p.id === "prod-unlinked")).toBeUndefined();
    // Historical price sheet item MUST survive with productId set to null
    expect(memStore.items).toHaveLength(1);
    expect(memStore.items[0].productId).toBeNull();
    expect(memStore.items[0].productName).toBe("Standalone Product");
  });

  it("blocks deleting either side of an Old SKU link alone, and allows deleting both linked records together", async () => {
    // Link Vege Cap old -> new
    const cr = await postProduct(
      new Request("http://localhost/api/inventory/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: "73373985102",
          previousSku: "73373905102",
          description: "Vege Cap New",
          listCost: "12.50",
          price: "24.99",
          status: "active",
        }),
      }),
    );
    const created = await cr.json();
    const newId = created.product.id as string;

    // Attempting to delete ONLY old SKU must be blocked (409)
    const delOldOnly = await deleteProducts(
      new Request("http://localhost/api/inventory/product", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["prod-vege-old"], confirm: true }),
      }),
    );
    expect(delOldOnly.status).toBe(409);
    expect(memStore.products.find((p) => p.id === "prod-vege-old")).toBeDefined();

    // Attempting to delete ONLY replacement SKU must also be blocked (409)
    const delNewOnly = await deleteProducts(
      new Request("http://localhost/api/inventory/product", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [newId], confirm: true }),
      }),
    );
    expect(delNewOnly.status).toBe(409);
    expect(memStore.products.find((p) => p.id === newId)).toBeDefined();

    // Selecting BOTH linked records together succeeds cleanly
    const delBoth = await deleteProducts(
      new Request("http://localhost/api/inventory/product", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["prod-vege-old", newId], confirm: true }),
      }),
    );
    expect(delBoth.status).toBe(200);
    expect(memStore.products.find((p) => p.id === "prod-vege-old")).toBeUndefined();
    expect(memStore.products.find((p) => p.id === newId)).toBeUndefined();
  });

  it("enforces admin role and explicit confirmation on selective deletion", async () => {
    mockRole = "staff";
    const forbidden = await deleteProducts(
      new Request("http://localhost/api/inventory/product", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["prod-unlinked"], confirm: true }),
      }),
    );
    expect(forbidden.status).toBe(403);

    mockRole = "admin";
    const noConfirm = await deleteProducts(
      new Request("http://localhost/api/inventory/product", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["prod-unlinked"] }),
      }),
    );
    expect(noConfirm.status).toBe(400);

    // Pure blocker helper sanity check
    const blocked = findBlockedOldSkuDeletions(["a"], [
      { id: "a", sku: "OLD-1", supersededByProductId: "b", previousSkuProductId: null },
      { id: "b", sku: "NEW-1", supersededByProductId: null, previousSkuProductId: "a" },
    ]);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].linkedSku).toBe("NEW-1");
  });
});
