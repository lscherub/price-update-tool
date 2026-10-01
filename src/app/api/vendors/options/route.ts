import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { loadFileStore } from "@/lib/store";

export const runtime = "nodejs";

/**
 * Vendor name search for the New Price Update combobox.
 *
 * Searches the database directly — it never loads the ~21,000 product rows
 * into the browser:
 *
 *   SELECT "vendor", COUNT(*) FROM "Product"
 *    WHERE "vendor" <> '' AND "vendor" ILIKE '%aor%'
 *    GROUP BY "vendor" ORDER BY "vendor" ASC LIMIT 20
 *
 * Results are merged with VendorDiscount so vendors that already have a
 * discount configured also appear. Returning the canonical stored spelling
 * lets the combobox resolve a near-duplicate typed name to the existing vendor
 * instead of creating a second record.
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
      const v = p.vendor.trim();
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const needle = q.toLowerCase();
    const rows = [...counts.entries()]
      .map(([vendor, count]) => ({ vendor, count }))
      .filter((r) => !needle || r.vendor.toLowerCase().includes(needle))
      .sort((a, b) => a.vendor.localeCompare(b.vendor))
      .slice(0, limit);
    return NextResponse.json({ rows });
  }

  try {
    const fromProducts = await prisma.$queryRaw<{ vendor: string; count: bigint }[]>`
      SELECT "vendor", COUNT(*)::bigint AS "count"
        FROM "Product"
       WHERE "vendor" <> ''
         AND "vendor" ILIKE ${"%" + q + "%"}
       GROUP BY "vendor"
       ORDER BY "vendor" ASC
       LIMIT ${limit}
    `;
    const fromDiscounts = await prisma.vendorDiscount.findMany({
      where: q ? { vendor: { contains: q, mode: "insensitive" } } : undefined,
      orderBy: { vendor: "asc" },
      take: limit,
      select: { vendor: true },
    });
    const merged = new Map<string, number>();
    for (const r of fromProducts) merged.set(r.vendor, Number(r.count));
    for (const d of fromDiscounts) if (!merged.has(d.vendor)) merged.set(d.vendor, 0);
    const rows = [...merged.entries()]
      .map(([vendor, count]) => ({ vendor, count }))
      .sort((a, b) => a.vendor.localeCompare(b.vendor))
      .slice(0, limit);
    return NextResponse.json({ rows });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not search vendors." }, { status: 500 });
  }
}