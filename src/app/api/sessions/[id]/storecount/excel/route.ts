import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSession } from "@/lib/auth";
import { getPrisma, dbUnreachableResponse, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { parseSortParam, sortItems } from "@/lib/itemSort";
import { loadFileStore, saveFileStore, cuid } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Store Count Excel worksheet columns (same 7 columns as the PDF/CSV sheet). */
export const STORE_COUNT_EXCEL_HEADER = [
  "SKU", "Description", "Size Desc.", "New Price", "QOH", "Expiry", "Notes",
] as const;

/**
 * Store Count Excel "New Price" rule — deliberately different from the PDF.
 * The PDF blanks unchanged prices; the Excel sheet must always carry a price:
 * - Nearest 9 present and different from Old Retail -> the new retail price.
 * - Nearest 9 equals Old Retail (or is missing) -> the current retail price.
 * - Neither available -> blank (nothing to show for that row).
 * Pure: no pricing calculation, only selection between stored values.
 */
export function storeCountExcelPrice(
  nearest9: string | { toString(): string } | null | undefined,
  oldRetailPrice: string | { toString(): string } | null | undefined,
): string {
  const n9 = nearest9 === null || nearest9 === undefined ? "" : String(nearest9).trim();
  const old = oldRetailPrice === null || oldRetailPrice === undefined ? "" : String(oldRetailPrice).trim();
  if (n9) {
    if (!old) return n9;
    const a = Number(n9);
    const b = Number(old);
    const same = Number.isFinite(a) && Number.isFinite(b) ? a === b : n9 === old;
    return same ? old : n9;
  }
  return old;
}

export type StoreCountExcelRow = {
  cleanedSku: string; productName: string; sizeDesc: string; price: string;
};

/** Build the .xlsx workbook buffer (proper workbook, not renamed CSV). */
export function buildStoreCountWorkbook(rows: StoreCountExcelRow[]): Buffer {
  const aoa: string[][] = [
    [...STORE_COUNT_EXCEL_HEADER],
    ...rows.map((r) => [r.cleanedSku, r.productName, r.sizeDesc, r.price, "", "", ""]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 18 }, { wch: 48 }, { wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 24 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Store Count");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

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
  if (!prisma) {
    const store = loadFileStore();
    const pmap = new Map(store.products.map((p) => [p.id, p]));
    const list: RowLite[] = store.items
      .filter((i) => {
        const live = i.productId ? pmap.get(i.productId)?.isInactive ?? i.isInactive : i.isInactive;
        return i.sessionId === id && !live;
      })
      .map((i) => ({
        id: i.id, cleanedSku: i.cleanedSku, productName: i.productName,
        sizeDesc: i.productId ? pmap.get(i.productId)?.sizeDesc ?? "" : "",
        nearest9: i.nearest9, oldRetailPrice: i.oldRetailPrice,
        brand: i.brand, vendor: i.vendor, notes: i.notes,
        matched: i.matched, isInactive: i.isInactive, cleanedOverridden: i.cleanedOverridden,
      }));
    rows = orderRows(list).map(toExcel);
    store.exports.push({ id: cuid(), sessionId: id, kind: "storecount-excel", createdBy: session.email, createdAt: new Date().toISOString(), detail: `${rows.length} rows` });
    saveFileStore(store);
  } else {
    try {
      const items = await prisma.priceUpdateItem.findMany({
        where: { sessionId: id }, orderBy: { createdAt: "asc" }, take: 50000,
      });
      const pids = [...new Set(items.map((i) => i.productId).filter(Boolean))] as string[];
      const prods = pids.length ? await prisma.product.findMany({ where: { id: { in: pids } } }) : [];
      const pmap = new Map(prods.map((p) => [p.id, p]));
      const list: RowLite[] = items
        .filter((i) => !(i.productId ? pmap.get(i.productId)?.isInactive ?? i.isInactive : i.isInactive))
        .map((i) => ({
          id: i.id, cleanedSku: i.cleanedSku, productName: i.productName,
          sizeDesc: i.productId ? pmap.get(i.productId)?.sizeDesc ?? "" : "",
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

  const buf = buildStoreCountWorkbook(rows);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="storecount-${id}.xlsx"`,
    },
  });
}
