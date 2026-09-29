import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { loadFileStore, type ItemRow } from "@/lib/store";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const prisma = getPrisma();

  const totalProducts = prisma ? await prisma.product.count() : loadFileStore().products.length;
  const inactiveProducts = prisma
    ? await prisma.product.count({ where: { isInactive: true } })
    : loadFileStore().products.filter((p) => p.isInactive).length;
  const vendorCount = prisma ? await prisma.vendorDiscount.count() : loadFileStore().vendorDiscounts.length;
  const sessionCount = prisma ? await prisma.priceUpdateSession.count() : loadFileStore().sessions.length;

  const sessions = prisma
    ? await prisma.priceUpdateSession.findMany({ orderBy: { updatedAt: "desc" }, take: 10 })
    : loadFileStore().sessions.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10);

  const q = searchParams.get("statsSession");
  let stats: Record<string, number> | null = null;
  if (q) {
    let items: ItemRow[];
    if (prisma) {
      const raw = await prisma.priceUpdateItem.findMany({ where: { sessionId: q }, take: 50000 });
      items = raw.map((i) => ({
        id: i.id, sessionId: i.sessionId, rawVendorSku: i.rawVendorSku, cleanedSku: i.cleanedSku,
        cleanedOverridden: i.cleanedOverridden, productId: i.productId, productNumber: i.productNumber,
        productName: i.productName, brand: i.brand, vendor: i.vendor,
        discount: String(i.discount ?? "0"), currentListPrice: i.currentListPrice ? String(i.currentListPrice) : null,
        vendorListPriceNew: i.vendorListPriceNew ? String(i.vendorListPriceNew) : null,
        ourNewListPrice: i.ourNewListPrice ? String(i.ourNewListPrice) : null,
        marginDivisor: i.marginDivisor ? String(i.marginDivisor) : "0.605",
        ourNewRetailPrice: i.ourNewRetailPrice ? String(i.ourNewRetailPrice) : null,
        oldRetailPrice: i.oldRetailPrice ? String(i.oldRetailPrice) : null,
        nearest9: i.nearest9 ? String(i.nearest9) : null, notes: i.notes,
        isInactive: i.isInactive, matched: i.matched, updatedAt: i.updatedAt.toISOString(),
      }));
    } else {
      items = loadFileStore().items.filter((i) => i.sessionId === q);
    }
    const matched = items.filter((i) => i.matched).length;
    const priceChanges = items.filter((i) => i.matched && i.nearest9 && i.oldRetailPrice && i.nearest9 !== i.oldRetailPrice).length;
    stats = {
      total: items.length, matched, unmatched: items.length - matched, priceChanges,
      noChange: items.filter((i) => i.matched && i.nearest9 && i.oldRetailPrice && i.nearest9 === i.oldRetailPrice).length,
      inactive: items.filter((i) => i.isInactive).length,
      missingPrice: items.filter((i) => !i.vendorListPriceNew).length,
    };
  }

  return NextResponse.json({
    totals: {
      products: totalProducts, inactive: inactiveProducts,
      active: totalProducts - inactiveProducts, vendors: vendorCount, sessions: sessionCount,
    },
    recentSessions: sessions.map((s) => ({
      id: s.id, vendor: (s as { vendor: string }).vendor, name: (s as { name: string }).name,
      status: (s as { status: string }).status,
      updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : (s as unknown as { updatedAt: string }).updatedAt,
    })),
    sessionStats: stats,
  });
}
