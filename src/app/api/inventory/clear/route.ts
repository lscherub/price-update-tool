import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { clearProducts } from "@/lib/inventoryDb";
import { loadFileStore, saveFileStore } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Delete the inventory (products) and nothing else.
 *
 * This is destructive, so it is admin-only and the client must send an explicit
 * `{ confirm: true }` acknowledgement — a stray or replayed request cannot wipe
 * the table. Price update history, price update sessions, export logs, vendor
 * discounts and users are all left untouched: `PriceUpdateItem.productId` is
 * ON DELETE SET NULL, so history survives with its product link detached.
 */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (body.confirm !== true) {
    return NextResponse.json(
      { error: "Confirmation required.", message: "Send { \"confirm\": true } to clear the inventory." },
      { status: 400 },
    );
  }

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    if (!prisma) {
      const store = loadFileStore();
      const deletedProducts = store.products.length;
      let detachedItems = 0;
      for (const item of store.items) {
        if (item.productId) { item.productId = null; detachedItems++; }
      }
      store.products = [];
      saveFileStore(store);
      return NextResponse.json({ ok: true, deletedProducts, detachedItems, total: 0 });
    }
    const { deletedProducts, detachedItems } = await clearProducts(prisma);
    return NextResponse.json({ ok: true, deletedProducts, detachedItems, total: 0 });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not clear the inventory. Nothing was deleted." }, { status: 500 });
  }
}