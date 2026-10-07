import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { loadFileStore } from "@/lib/store";
import { getLastFullImportAt } from "@/lib/inventoryMeta";
import {
  buildInventoryOrderBy,
  buildInventoryWhere,
  matchesInventoryFilters,
  parseInventoryQuery,
  sortInventoryRows,
} from "@/lib/inventoryQuery";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const iq = parseInventoryQuery(searchParams);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(500, Math.max(10, parseInt(searchParams.get("pageSize") ?? "100", 10) || 100));
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (!prisma) {
    const store = loadFileStore();
    const rows = sortInventoryRows(store.products.filter((p) => matchesInventoryFilters(p, iq)), iq.sort, iq.sortDir);
    return NextResponse.json({
      total: rows.length, page, pageSize,
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      lastImportedAt: store.inventoryLastFullImportAt ?? null,
    });
  }
  const where = buildInventoryWhere(iq);
  const orderBy = buildInventoryOrderBy(iq.sort, iq.sortDir);
  try {
    const total = await prisma.product.count({ where: where as never });
    const rows = await prisma.product.findMany({
      where: where as never, orderBy, skip: (page - 1) * pageSize, take: pageSize,
    });
    const lastImportedAt = await getLastFullImportAt(prisma);
    return NextResponse.json({
      total, page, pageSize,
      rows: rows.map((p) => ({
        id: p.id, sku: p.sku, normalizedSku: p.normalizedSku, productNumber: p.productNumber,
        description: p.description, vendor: p.vendor, brand: p.brand,
        listCost: String(p.listCost), price: String(p.price), sizeDesc: p.sizeDesc, isInactive: p.isInactive,
      })),
      lastImportedAt,
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load inventory." }, { status: 500 });
  }
}
