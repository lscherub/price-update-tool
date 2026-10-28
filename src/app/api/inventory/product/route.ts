import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { getSession } from "@/lib/auth";
import { getPrisma, dbUnreachableResponse, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { cuid, loadFileStore, saveFileStore } from "@/lib/store";
import { normalizeSku } from "@/lib/pricing";
import { parseAmount } from "@/lib/inventoryImport";

export const runtime = "nodejs";

/**
 * POST /api/inventory/product
 *
 * Manually add a single product to inventory without importing a full POS file.
 * Validates SKU uniqueness, numeric price/cost fields, and required fields.
 * Uses the same schema and rules as the bulk import.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const sku = String(body.sku ?? "").trim();
  const productNumber = String(body.productNumber ?? "").trim();
  const description = String(body.description ?? "").trim();
  const vendor = String(body.vendor ?? "").trim();
  const brand = String(body.brand ?? "").trim();
  const sizeDesc = String(body.sizeDesc ?? "").trim();
  const isInactive = body.status === "inactive";

  // --- Validation ---
  if (!sku) return NextResponse.json({ error: "SKU is required." }, { status: 400 });
  if (sku.length > 200) return NextResponse.json({ error: "SKU is too long (max 200 characters)." }, { status: 400 });

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
    // File-store path
    const store = loadFileStore();
    const existing = store.products.find((p) => p.sku === sku);
    if (existing) {
      return NextResponse.json({ error: `SKU "${sku}" already exists in inventory.` }, { status: 409 });
    }
    const product = {
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
    };
    store.products.push(product);
    saveFileStore(store);
    return NextResponse.json({ ok: true, product });
  }

  // Check SKU uniqueness
  try {
    const existing = await prisma.product.findUnique({ where: { sku } });
    if (existing) {
      return NextResponse.json({ error: `SKU "${sku}" already exists in inventory.` }, { status: 409 });
    }
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not check SKU uniqueness." }, { status: 500 });
  }

  try {
    const product = await prisma.product.create({
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
      },
    });
    return NextResponse.json({
      ok: true,
      product: {
        id: product.id,
        sku: product.sku,
        normalizedSku: product.normalizedSku,
        productNumber: product.productNumber,
        description: product.description,
        vendor: product.vendor,
        brand: product.brand,
        listCost: String(product.listCost),
        price: String(product.price),
        sizeDesc: product.sizeDesc,
        isInactive: product.isInactive,
      },
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
