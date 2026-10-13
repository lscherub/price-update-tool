import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { loadFileStore } from "@/lib/store";

export const runtime = "nodejs";

/**
 * Brand name search for the brand-discount form.
 * Server-side ILIKE against distinct Product.brand (never loads all rows),
 * merged with BrandDiscount so configured brands also appear.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limit = Math.min(50, Math.max(5, parseInt(searchParams.get("limit") ?? "20", 10) || 20));

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  if (!prisma) {
    const store = loadFileStore();
    const counts = new Map<string, number>();
    for (const p of store.products) {
      const v = p.brand.trim();
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const needle = q.toLowerCase();
    const rows = [...counts.entries()]
      .map(([brand, count]) => ({ brand, count }))
      .filter((r) => !needle || r.brand.toLowerCase().includes(needle))
      .sort((a, b) => a.brand.localeCompare(b.brand))
      .slice(0, limit);
    return NextResponse.json({ rows });
  }

  try {
    const fromProducts = await prisma.$queryRaw<{ brand: string; count: bigint }[]>`
      SELECT "brand", COUNT(*)::bigint AS "count"
        FROM "Product"
       WHERE "brand" <> ''
         AND "brand" ILIKE ${"%" + q + "%"}
       GROUP BY "brand"
       ORDER BY "brand" ASC
       LIMIT ${limit}
    `;
    const merged = new Map<string, number>();
    for (const r of fromProducts) merged.set(r.brand, Number(r.count));
    try {
      const db = prisma as unknown as { brandDiscount: { findMany: (a: unknown) => Promise<{ brand: string }[]> } };
      const fromDiscounts = await db.brandDiscount.findMany({
        where: q ? { brand: { contains: q, mode: "insensitive" } } : undefined,
        orderBy: { brand: "asc" },
        take: limit,
        select: { brand: true },
      });
      for (const d of fromDiscounts) if (!merged.has(d.brand)) merged.set(d.brand, 0);
    } catch {
      // Older DB without BrandDiscount: inventory results are enough.
    }
    const rows = [...merged.entries()]
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => a.brand.localeCompare(b.brand))
      .slice(0, limit);
    return NextResponse.json({ rows });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not search brands." }, { status: 500 });
  }
}
