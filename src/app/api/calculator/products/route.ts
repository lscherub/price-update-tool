import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { loadFileStore } from "@/lib/store";
import { skuCandidates } from "@/lib/pricing";

export const runtime = "nodejs";

/**
 * Product search for the calculator / Add Row box flow.
 * q matches SKU / normalized SKU / product number / description.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!q) return NextResponse.json({ rows: [] });
  const limit = Math.min(30, Math.max(5, parseInt(searchParams.get("limit") ?? "15", 10) || 15));
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (!prisma) {
    const store = loadFileStore();
    const needle = q.toLowerCase();
    const rows = store.products
      .filter((p) =>
        [p.sku, p.normalizedSku, p.productNumber, p.description, p.vendor, p.brand]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, limit)
      .map((p) => ({
        sku: p.sku,
        productNumber: p.productNumber,
        description: p.description,
        vendor: p.vendor,
        brand: p.brand,
        listCost: p.listCost,
        price: p.price,
      }));
    return NextResponse.json({ rows });
  }
  try {
    const cands = skuCandidates(q);
    const rows = await prisma.product.findMany({
      where: {
        OR: [
          { sku: { contains: q, mode: "insensitive" } },
          { normalizedSku: { in: cands } },
          { productNumber: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { sku: "asc" },
      take: limit,
    });
    return NextResponse.json({
      rows: rows.map((p) => ({
        sku: p.sku,
        productNumber: p.productNumber,
        description: p.description,
        vendor: p.vendor,
        brand: p.brand,
        listCost: String(p.listCost),
        price: String(p.price),
      })),
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not search products." }, { status: 500 });
  }
}
