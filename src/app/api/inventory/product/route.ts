import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { getSession } from "@/lib/auth";
import { getPrisma, dbUnreachableResponse, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { cuid, loadFileStore, saveFileStore, type ProductRow } from "@/lib/store";
import { normalizeSku } from "@/lib/pricing";
import { parseAmount } from "@/lib/inventoryImport";
import {
  findBlockedOldSkuDeletions,
  validateOldSkuReplacement,
  type OldSkuLinkNode,
} from "@/lib/inventoryDb";

export const runtime = "nodejs";

/**
 * GET /api/inventory/product?sku=<exact>
 *
 * Exact string SKU lookup (preserving leading zeros — never coerced to a number).
 * Used by the enhanced Add Product workflow when linking a new SKU to a previous SKU.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const sku = String(searchParams.get("sku") ?? "").trim();
  if (!sku) return NextResponse.json({ error: "SKU is required." }, { status: 400 });

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  if (!prisma) {
    const store = loadFileStore();
    const hit = store.products.find((p) => p.sku === sku);
    if (!hit) return NextResponse.json({ ok: true, found: false });
    const sup = hit.supersededByProductId
      ? store.products.find((p) => p.id === hit.supersededByProductId)
      : undefined;
    const prev = hit.previousSkuProductId
      ? store.products.find((p) => p.id === hit.previousSkuProductId)
      : undefined;
    return NextResponse.json({
      ok: true,
      found: true,
      product: {
        id: hit.id,
        sku: hit.sku,
        normalizedSku: hit.normalizedSku,
        productNumber: hit.productNumber,
        description: hit.description,
        vendor: hit.vendor,
        brand: hit.brand,
        listCost: hit.listCost,
        price: hit.price,
        sizeDesc: hit.sizeDesc,
        isInactive: hit.isInactive,
        isOldSku: Boolean(hit.isOldSku),
        supersededByProductId: hit.supersededByProductId ?? null,
        supersededBySku: sup?.sku ?? null,
        supersededByDescription: sup?.description ?? null,
        previousSkuProductId: hit.previousSkuProductId ?? null,
        previousSku: prev?.sku ?? null,
      },
    });
  }

  try {
    const hit = await prisma.product.findUnique({
      where: { sku },
      include: {
        supersededByProduct: { select: { id: true, sku: true, description: true } },
        previousSkuProduct: { select: { id: true, sku: true } },
      },
    });
    if (!hit) return NextResponse.json({ ok: true, found: false });
    return NextResponse.json({
      ok: true,
      found: true,
      product: {
        id: hit.id,
        sku: hit.sku,
        normalizedSku: hit.normalizedSku,
        productNumber: hit.productNumber,
        description: hit.description,
        vendor: hit.vendor,
        brand: hit.brand,
        listCost: String(hit.listCost),
        price: String(hit.price),
        sizeDesc: hit.sizeDesc,
        isInactive: hit.isInactive,
        isOldSku: hit.isOldSku,
        supersededByProductId: hit.supersededByProductId ?? null,
        supersededBySku: hit.supersededByProduct?.sku ?? null,
        supersededByDescription: hit.supersededByProduct?.description ?? null,
        previousSkuProductId: hit.previousSkuProductId ?? null,
        previousSku: hit.previousSkuProduct?.sku ?? null,
      },
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not look up that SKU." }, { status: 500 });
  }
}

/**
 * POST /api/inventory/product
 *
 * Manually add a single product to inventory without importing a full POS file.
 * Optionally links the new product to an existing Previous SKU transactionally:
 *   - Old product: isOldSku = true, supersededByProductId = newProduct.id (other fields untouched)
 *   - New product: isOldSku = false, previousSkuProductId = oldProduct.id
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const sku = String(body.sku ?? "").trim();
  const previousSku = String(body.previousSku ?? "").trim();
  const productNumber = String(body.productNumber ?? "").trim();
  const description = String(body.description ?? "").trim();
  const vendor = String(body.vendor ?? "").trim();
  const brand = String(body.brand ?? "").trim();
  const sizeDesc = String(body.sizeDesc ?? "").trim();
  const isInactive = body.status === "inactive";

  // --- Validation ---
  if (!sku) return NextResponse.json({ error: "SKU is required." }, { status: 400 });
  if (sku.length > 200) return NextResponse.json({ error: "SKU is too long (max 200 characters)." }, { status: 400 });
  if (previousSku && previousSku === sku) {
    return NextResponse.json({ error: "Previous SKU cannot be the same as the new SKU." }, { status: 400 });
  }

  const cost = parseAmount(body.listCost, "List Cost");
  if (!cost.ok) return NextResponse.json({ error: cost.reason }, { status: 400 });
  if (new Decimal(cost.value).isNegative()) {
    return NextResponse.json({ error: "List Cost cannot be negative." }, { status: 400 });
  }

  const price = parseAmount(body.price, "Price");
  if (!price.ok) return NextResponse.json({ error: price.reason }, { status: 400 });
  if (new Decimal(price.value).isNegative()) {
    return NextResponse.json({ error: "Price cannot be negative." }, { status: 400 });
  }

  const normalizedSku = normalizeSku(sku) || sku.replace(/[\s-]+/g, "");

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  if (!prisma) {
    const store = loadFileStore();
    const existing = store.products.find((p) => p.sku === sku);
    if (existing) {
      return NextResponse.json({ error: `SKU "${sku}" already exists in inventory.` }, { status: 409 });
    }

    let oldProduct: ProductRow | undefined;
    if (previousSku) {
      oldProduct = store.products.find((p) => p.sku === previousSku);
      if (!oldProduct) {
        return NextResponse.json(
          { error: `Previous SKU "${previousSku}" was not found in inventory.` },
          { status: 404 },
        );
      }
      const byId = new Map<string, OldSkuLinkNode>(store.products.map((p) => [p.id, p]));
      const check = validateOldSkuReplacement(oldProduct, sku, byId);
      if (!check.ok) {
        return NextResponse.json({ error: check.error, existingReplacementSku: check.existingReplacementSku }, { status: check.status });
      }
    }

    const product: ProductRow = {
      id: cuid(),
      sku,
      normalizedSku,
      productNumber,
      description,
      vendor,
      brand,
      listCost: cost.value,
      price: price.value,
      sizeDesc,
      isInactive,
      isOldSku: false,
      supersededByProductId: null,
      previousSkuProductId: oldProduct ? oldProduct.id : null,
    };
    store.products.push(product);
    if (oldProduct) {
      oldProduct.isOldSku = true;
      oldProduct.supersededByProductId = product.id;
    }
    saveFileStore(store);
    return NextResponse.json({
      ok: true,
      product: {
        ...product,
        supersededBySku: null,
        previousSku: oldProduct?.sku ?? null,
      },
      previousProduct: oldProduct
        ? { id: oldProduct.id, sku: oldProduct.sku, isOldSku: true, supersededByProductId: product.id }
        : null,
    });
  }

  // PostgreSQL transactional path: ensures creation and old-SKU linking are atomic.
  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { sku }, select: { id: true } });
      if (existing) {
        return { kind: "error" as const, status: 409, error: `SKU "${sku}" already exists in inventory.` };
      }

      let oldProd: {
        id: string;
        sku: string;
        description: string;
        supersededByProductId: string | null;
        previousSkuProductId: string | null;
        supersededByProduct: { id: string; sku: string; description: string } | null;
      } | null = null;

      if (previousSku) {
        oldProd = await tx.product.findUnique({
          where: { sku: previousSku },
          select: {
            id: true,
            sku: true,
            description: true,
            supersededByProductId: true,
            previousSkuProductId: true,
            supersededByProduct: { select: { id: true, sku: true, description: true } },
          },
        });
        if (!oldProd) {
          return {
            kind: "error" as const,
            status: 404,
            error: `Previous SKU "${previousSku}" was not found in inventory.`,
          };
        }
        const byId = new Map<string, OldSkuLinkNode>([[oldProd.id, oldProd]]);
        if (oldProd.supersededByProduct) {
          byId.set(oldProd.supersededByProduct.id, oldProd.supersededByProduct);
        }
        const check = validateOldSkuReplacement(oldProd, sku, byId);
        if (!check.ok) {
          return {
            kind: "error" as const,
            status: check.status,
            error: check.error,
            existingReplacementSku: check.existingReplacementSku,
          };
        }
      }

      const created = await tx.product.create({
        data: {
          sku,
          normalizedSku,
          productNumber,
          description,
          vendor,
          brand,
          listCost: new Decimal(cost.value),
          price: new Decimal(price.value),
          sizeDesc,
          isInactive,
          isOldSku: false,
          supersededByProductId: null,
          previousSkuProductId: oldProd ? oldProd.id : null,
        },
      });

      if (oldProd) {
        await tx.product.update({
          where: { id: oldProd.id },
          data: {
            isOldSku: true,
            supersededByProductId: created.id,
          },
        });
      }

      return { kind: "ok" as const, created, oldProd };
    });

    if (result.kind === "error") {
      return NextResponse.json(
        { error: result.error, ...(result.existingReplacementSku ? { existingReplacementSku: result.existingReplacementSku } : {}) },
        { status: result.status },
      );
    }

    const { created, oldProd } = result;
    return NextResponse.json({
      ok: true,
      product: {
        id: created.id,
        sku: created.sku,
        normalizedSku: created.normalizedSku,
        productNumber: created.productNumber,
        description: created.description,
        vendor: created.vendor,
        brand: created.brand,
        listCost: String(created.listCost),
        price: String(created.price),
        sizeDesc: created.sizeDesc,
        isInactive: created.isInactive,
        isOldSku: created.isOldSku,
        supersededByProductId: created.supersededByProductId,
        previousSkuProductId: created.previousSkuProductId,
        supersededBySku: null,
        previousSku: oldProd?.sku ?? null,
      },
      previousProduct: oldProd
        ? { id: oldProd.id, sku: oldProd.sku, isOldSku: true, supersededByProductId: created.id }
        : null,
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    const code = (e as { code?: string })?.code;
    if (code === "P2002") {
      return NextResponse.json({ error: `SKU "${sku}" already exists in inventory.` }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not create the product. Please try again." }, { status: 500 });
  }
}

/**
 * DELETE /api/inventory/product
 *
 * Selective permanent deletion of chosen inventory products (admin-only, explicit confirm).
 * Safety guarantees:
 *   1. Blocks deletion if any selected product has an active Old SKU / Replacement SKU
 *      relationship with a remaining (non-selected) product — never leaves broken references.
 *   2. Explicitly detaches `PriceUpdateItem.productId = NULL` inside the transaction before
 *      deleting so all historical price update sheets, notes, and exports remain intact.
 */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (body.confirm !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 400 });
  }
  const ids = Array.isArray(body.ids)
    ? [...new Set((body.ids as unknown[]).map((v) => String(v ?? "").trim()).filter(Boolean))].slice(0, 1000)
    : [];
  if (!ids.length) {
    return NextResponse.json({ error: "Select at least one product to delete." }, { status: 400 });
  }

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  if (!prisma) {
    const store = loadFileStore();
    const selectedSet = new Set(ids);
    const involved = store.products.filter(
      (p) =>
        selectedSet.has(p.id) ||
        (p.supersededByProductId && selectedSet.has(p.supersededByProductId)) ||
        (p.previousSkuProductId && selectedSet.has(p.previousSkuProductId)) ||
        store.products.some(
          (sel) =>
            selectedSet.has(sel.id) &&
            (sel.supersededByProductId === p.id || sel.previousSkuProductId === p.id),
        ),
    );
    const blocked = findBlockedOldSkuDeletions(ids, involved);
    if (blocked.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete ${blocked.length} product${blocked.length === 1 ? "" : "s"} with active Old SKU replacement links. ${blocked[0].reason}`,
          blocked,
        },
        { status: 409 },
      );
    }

    let detachedItems = 0;
    for (const item of store.items) {
      if (item.productId && selectedSet.has(item.productId)) {
        item.productId = null;
        detachedItems++;
      }
    }
    const before = store.products.length;
    store.products = store.products.filter((p) => !selectedSet.has(p.id));
    const deletedCount = before - store.products.length;
    saveFileStore(store);
    return NextResponse.json({ ok: true, deletedIds: ids, deletedCount, detachedItems });
  }

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const selectedRows = await tx.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, sku: true, supersededByProductId: true, previousSkuProductId: true },
      });
      const partnerIds = [
        ...new Set(
          selectedRows
            .flatMap((r) => [r.supersededByProductId, r.previousSkuProductId])
            .filter((x): x is string => typeof x === "string" && Boolean(x)),
        ),
      ];
      const referencingRows = await tx.product.findMany({
        where: {
          OR: [
            { id: { in: partnerIds } },
            { supersededByProductId: { in: ids } },
            { previousSkuProductId: { in: ids } },
          ],
        },
        select: { id: true, sku: true, supersededByProductId: true, previousSkuProductId: true },
      });

      const involvedMap = new Map<string, OldSkuLinkNode>();
      for (const r of [...selectedRows, ...referencingRows]) involvedMap.set(r.id, r);
      const blocked = findBlockedOldSkuDeletions(ids, [...involvedMap.values()]);
      if (blocked.length > 0) {
        return { kind: "blocked" as const, blocked };
      }

      // Detach historical PriceUpdateItem references explicitly so price history stays 100% intact.
      const detached = await tx.priceUpdateItem.updateMany({
        where: { productId: { in: ids } },
        data: { productId: null },
      });

      // Clear any mutual links among rows being deleted together.
      await tx.product.updateMany({
        where: { id: { in: ids } },
        data: { supersededByProductId: null, previousSkuProductId: null },
      });

      const deleted = await tx.product.deleteMany({
        where: { id: { in: ids } },
      });

      return {
        kind: "ok" as const,
        deletedCount: deleted.count,
        detachedItems: detached.count,
      };
    });

    if (outcome.kind === "blocked") {
      const b = outcome.blocked;
      return NextResponse.json(
        {
          error: `Cannot delete ${b.length} product${b.length === 1 ? "" : "s"} with active Old SKU replacement links. ${b[0].reason}`,
          blocked: b,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      deletedIds: ids,
      deletedCount: outcome.deletedCount,
      detachedItems: outcome.detachedItems,
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not delete selected products. Nothing was deleted." }, { status: 500 });
  }
}
