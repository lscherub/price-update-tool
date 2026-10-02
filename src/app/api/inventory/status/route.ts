import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { setProductInactive } from "@/lib/inventoryDb";
import { loadFileStore, saveFileStore } from "@/lib/store";

export const runtime = "nodejs";

/**
 * Flip one product between Active and Inactive.
 *
 * Deliberately a single-row update addressed by id, so changing a status in the
 * inventory table never re-uploads, re-queries or recalculates the rest of the
 * inventory. This is the manual escape hatch for correcting status without
 * re-importing the full inventory or the inactive list.
 */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "A product id is required." }, { status: 400 });
  if (typeof body.isInactive !== "boolean") {
    return NextResponse.json({ error: "isInactive must be true (Inactive) or false (Active)." }, { status: 400 });
  }
  const isInactive = body.isInactive;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  if (!prisma) {
    const store = loadFileStore();
    const p = store.products.find((x) => x.id === id);
    if (!p) return NextResponse.json({ error: "Product not found." }, { status: 404 });
    p.isInactive = isInactive;
    saveFileStore(store);
    return NextResponse.json({ ok: true, product: { id: p.id, sku: p.sku, isInactive: p.isInactive } });
  }

  try {
    const product = await setProductInactive(prisma, id, isInactive);
    if (!product) return NextResponse.json({ error: "Product not found." }, { status: 404 });
    return NextResponse.json({ ok: true, product });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    if ((e as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "Product not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not update the product status." }, { status: 500 });
  }
}