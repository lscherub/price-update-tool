import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { loadFileStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").toLowerCase();
  const vendor = searchParams.get("vendor") ?? "";
  const inactive = searchParams.get("inactive") ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(500, Math.max(10, parseInt(searchParams.get("pageSize") ?? "100", 10) || 100));
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (!prisma) {
    const store = loadFileStore();
    let rows = store.products;
    if (q) rows = rows.filter((p) => [p.sku, p.normalizedSku, p.productNumber, p.description, p.brand, p.vendor].join(" ").toLowerCase().includes(q));
    if (vendor) rows = rows.filter((p) => p.vendor === vendor);
    if (inactive === "true") rows = rows.filter((p) => p.isInactive);
    if (inactive === "false") rows = rows.filter((p) => !p.isInactive);
    rows = rows.slice().sort((a, b) => a.sku.localeCompare(b.sku));
    return NextResponse.json({ total: rows.length, page, pageSize, rows: rows.slice((page - 1) * pageSize, page * pageSize) });
  }
  const where: Record<string, unknown> = {};
  if (vendor) where.vendor = vendor;
  if (inactive === "true") where.isInactive = true;
  if (inactive === "false") where.isInactive = false;
  if (q) {
    where.OR = [
      { sku: { contains: q, mode: "insensitive" } },
      { normalizedSku: { contains: q, mode: "insensitive" } },
      { productNumber: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { brand: { contains: q, mode: "insensitive" } },
      { vendor: { contains: q, mode: "insensitive" } },
    ];
  }
  try {
    const total = await prisma.product.count({ where: where as never });
    const rows = await prisma.product.findMany({
      where: where as never, orderBy: { sku: "asc" }, skip: (page - 1) * pageSize, take: pageSize,
    });
    return NextResponse.json({
      total, page, pageSize,
      rows: rows.map((p) => ({
        id: p.id, sku: p.sku, normalizedSku: p.normalizedSku, productNumber: p.productNumber,
        description: p.description, vendor: p.vendor, brand: p.brand,
        listCost: String(p.listCost), price: String(p.price), sizeDesc: p.sizeDesc, isInactive: p.isInactive,
      })),
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load inventory." }, { status: 500 });
  }
}
