import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { loadFileStore } from "@/lib/store";

export const runtime = "nodejs";
type FacetRow = { value: string; count: bigint | number };
/**
 * Distinct Vendor / Brand values (with counts) for the Inventory column
 * dropdowns — Excel-style "filter by specific vendor/brand".
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const col = searchParams.get("column") === "brand" ? "brand" : "vendor";
  const q = (searchParams.get("q") ?? "").trim();
  const limit = Math.min(100, Math.max(5, parseInt(searchParams.get("limit") ?? "30", 10) || 30));
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (!prisma) {
    const counts = new Map<string, number>();
    for (const p of loadFileStore().products) {
      const v = String(col === "brand" ? p.brand : p.vendor ?? "").trim();
      if (!v) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const needle = q.toLowerCase();
    const rows = [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .filter((r) => !needle || r.value.toLowerCase().includes(needle))
      .sort((a, b) => a.value.localeCompare(b.value))
      .slice(0, limit);
    return NextResponse.json({ column: col, rows });
  }
  try {
    const ident = col === "brand" ? '"brand"' : '"vendor"';
    const rows = await prisma.$queryRawUnsafe<FacetRow[]>(
      `SELECT ${ident} AS "value", COUNT(*)::bigint AS "count" FROM "Product" ` +
        `WHERE ${ident} <> '' AND ${ident} ILIKE $1 ` +
        `GROUP BY ${ident} ORDER BY ${ident} ASC LIMIT ${limit}`,
      `%${q}%`,
    );
    return NextResponse.json({
      column: col,
      rows: rows.map((r) => ({ value: String(r.value), count: Number(r.count) })),
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load filter values." }, { status: 500 });
  }
}
