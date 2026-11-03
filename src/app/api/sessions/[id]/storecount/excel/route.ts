import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPrisma, dbUnreachableResponse, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { parseSortParam, sortItems } from "@/lib/itemSort";
import { loadFileStore, saveFileStore, cuid } from "@/lib/store";
import { storeCountExcelPrice, buildStoreCountWorkbook, type StoreCountExcelRow } from "@/lib/storeCountPricing";
import { resolveLiveProducts } from "@/lib/lookup";
import { buildContentDisposition, buildExportFilename } from "@/lib/exportFilename";

export const runtime = "nodejs";
export const maxDuration = 60;

type RowLite = {
  id: string; cleanedSku: string; productName: string; sizeDesc: string;
  nearest9: string | null; oldRetailPrice: string | null;
  brand: string; vendor: string; notes: string;
  matched: boolean; isInactive: boolean; cleanedOverridden: boolean;
};

/**
 * POST /api/sessions/[id]/storecount/excel
 *
 * Same Store Count product-selection/lookup rules as the PDF (live inactive
 * re-check against Product, sizeDesc from the linked product) and the same
 * optional table ordering (sorted visible ids, else sortKey/sortDir, else
 * natural order) — but with the Excel price rule (always a price, never the
 * PDF's blank-for-unchanged). Rows outside an `ids` allowlist are still
 * included (appended after), so no eligible product is ever omitted.
 * The PDF implementation is untouched.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const raw = await req.json().catch(() => ({}));
  const body = (raw && typeof raw === "object" ? raw : {}) as { ids?: unknown; sortKey?: unknown; sortDir?: unknown };
  const reqSort = parseSortParam(body.sortKey, body.sortDir);
  const orderIds = Array.isArray(body.ids) && body.ids.length
    ? [...new Set((body.ids as unknown[]).map((v) => String(v ?? "")).filter(Boolean))].slice(0, 20000)
    : null;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const orderRows = (list: RowLite[]): RowLite[] => {
    if (orderIds) {
      const pos = new Map(orderIds.map((x, i) => [x, i]));
      return list
        .map((r, i) => ({ r, i }))
        .sort((a, b) => {
          const pa = pos.has(a.r.id) ? (pos.get(a.r.id) as number) : Number.MAX_SAFE_INTEGER;
          const pb = pos.has(b.r.id) ? (pos.get(b.r.id) as number) : Number.MAX_SAFE_INTEGER;
          return pa - pb || a.i - b.i;
        })
        .map((x) => x.r);
    }
    if (reqSort) return sortItems(list, reqSort.key, reqSort.dir);
    return list;
  };

  const toExcel = (r: RowLite): StoreCountExcelRow => ({
    cleanedSku: r.cleanedSku, productName: r.productName, sizeDesc: r.sizeDesc,
    price: storeCountExcelPrice(r.nearest9, r.oldRetailPrice),
  });

  let rows: StoreCountExcelRow[];
  let sessionName = "";
  if (!prisma) {
    const store = loadFileStore();
    sessionName = store.sessions.find((s) => s.id === id)?.name ?? "";
    const sessionItems = store.items.filter((i) => i.sessionId === id);
    const resolveProduct = await resolveLiveProducts(sessionItems, null);
    const list: RowLite[] = sessionItems
      .filter((i) => {
        const live = resolveProduct(i)?.isInactive ?? i.isInactive;
        return !live;
      })
      .map((i) => ({
        id: i.id, cleanedSku: i.cleanedSku, productName: i.productName,
        sizeDesc: resolveProduct(i)?.sizeDesc ?? "",
        nearest9: i.nearest9, oldRetailPrice: i.oldRetailPrice,
        brand: i.brand, vendor: i.vendor, notes: i.notes,
        matched: i.matched, isInactive: i.isInactive, cleanedOverridden: i.cleanedOverridden,
      }));
    rows = orderRows(list).map(toExcel);
    store.exports.push({ id: cuid(), sessionId: id, kind: "storecount-excel", createdBy: session.email, createdAt: new Date().toISOString(), detail: `${rows.length} rows` });
    saveFileStore(store);
  } else {
    try {
      const [sessionRecord, items] = await Promise.all([
        prisma.priceUpdateSession.findUnique({ where: { id }, select: { name: true } }),
        prisma.priceUpdateItem.findMany({ where: { sessionId: id }, orderBy: { createdAt: "asc" }, take: 50000 }),
      ]);
      sessionName = sessionRecord?.name ?? "";
      const resolveProduct = await resolveLiveProducts(items, prisma);
      const list: RowLite[] = items
        .filter((i) => !(resolveProduct(i)?.isInactive ?? i.isInactive))
        .map((i) => ({
          id: i.id, cleanedSku: i.cleanedSku, productName: i.productName,
          sizeDesc: resolveProduct(i)?.sizeDesc ?? "",
          nearest9: i.nearest9 ? String(i.nearest9) : null,
          oldRetailPrice: i.oldRetailPrice ? String(i.oldRetailPrice) : null,
          brand: i.brand, vendor: i.vendor, notes: i.notes,
          matched: i.matched, isInactive: i.isInactive, cleanedOverridden: i.cleanedOverridden,
        }));
      rows = orderRows(list).map(toExcel);
    } catch (e) {
      if (isDbConnectionError(e)) return dbUnreachableResponse();
      return NextResponse.json({ error: "Could not load rows for the Store Count Excel export." }, { status: 500 });
    }
    try {
      await prisma.exportLog.create({ data: { sessionId: id, kind: "storecount-excel", createdBy: session.email, detail: `${rows.length} rows` } });
    } catch (e) {
      if (isDbConnectionError(e)) return dbUnreachableResponse();
    }
  }

  if (!rows.length) {
    return NextResponse.json({ error: "No active rows to export. All rows are inactive or the session is empty." }, { status: 400 });
  }

  const filename = buildExportFilename(sessionName, "Store Count", "xlsx");
  const buf = buildStoreCountWorkbook(rows);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": buildContentDisposition(filename),
    },
  });
}
