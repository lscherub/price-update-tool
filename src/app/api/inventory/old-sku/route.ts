import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { setProductOldSku } from "@/lib/inventoryDb";
import { loadFileStore, saveFileStore } from "@/lib/store";

export const runtime = "nodejs";

/**
 * PATCH /api/inventory/old-sku
 *
 * Toggle a single product's persistent `isOldSku` flag by id.
 * Mirrors PATCH /api/inventory/status without modifying any other product fields.
 */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "A product id is required." }, { status: 400 });
  if (typeof body.isOldSku !== "boolean") {
    return NextResponse.json({ error: "isOldSku must be true or false." }, { status: 400 });
  }
  const isOldSku = body.isOldSku;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  if (!prisma) {
    const store = loadFileStore();
    const p = store.products.find((x) => x.id === id);
    if (!p) return NextResponse.json({ error: "Product not found." }, { status: 404 });
    p.isOldSku = isOldSku;
    saveFileStore(store);
    return NextResponse.json({ ok: true, product: { id: p.id, sku: p.sku, isOldSku: Boolean(p.isOldSku) } });
  }

  try {
    const product = await setProductOldSku(prisma, id, isOldSku);
    if (!product) return NextResponse.json({ error: "Product not found." }, { status: 404 });
    return NextResponse.json({ ok: true, product });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    if ((e as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "Product not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not update the Old SKU flag." }, { status: 500 });
  }
}
