import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { loadFileStore, saveFileStore } from "@/lib/store";
import { getLastFullImportAt, getLastPriceSyncAt } from "@/lib/inventoryMeta";

export const runtime = "nodejs";

/**
 * Read the "Last imported" + "Last updated" timestamps for the Inventory page.
 * GET returns { lastImportedAt: string|null, lastUpdatedAt: string|null }.
 * Last imported is written ONLY by a successful Full/All Inventory import;
 * Last updated is written ONLY by a confirmed Export-for-POS price sync.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (!prisma) {
    const store = loadFileStore();
    return NextResponse.json({
      lastImportedAt: store.inventoryLastFullImportAt ?? null,
      lastUpdatedAt: store.inventoryLastPriceSyncAt ?? null,
    });
  }
  try {
    const [lastImportedAt, lastUpdatedAt] = await Promise.all([
      getLastFullImportAt(prisma),
      getLastPriceSyncAt(prisma),
    ]);
    return NextResponse.json({ lastImportedAt, lastUpdatedAt });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load the last import time." }, { status: 500 });
  }
}

/**
 * DELETE clears the timestamp. Not called automatically by Clear Inventory
 * (which deliberately leaves the last-successful-import record alone) — it
 * exists so an operator can reset the label to "Never" if ever needed.
 * Admin-only.
 */
export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  try {
    if (!prisma) {
      const store = loadFileStore();
      store.inventoryLastFullImportAt = null;
      saveFileStore(store);
      return NextResponse.json({ ok: true, lastImportedAt: null });
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AppSetting" ("key", "value", "updatedAt") VALUES ('inventory_last_full_import', '', now()) ` +
        `ON CONFLICT ("key") DO UPDATE SET "value" = '', "updatedAt" = now()`,
    );
    return NextResponse.json({ ok: true, lastImportedAt: null });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not clear the last import time." }, { status: 500 });
  }
}
