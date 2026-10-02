import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getSession } from "@/lib/auth";
import { getPrisma, dbUnreachableResponse, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { parseSortParam, sortItems } from "@/lib/itemSort";
import { loadFileStore, saveFileStore, cuid } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Store Count PDF "New Price" display rule (mirrors the price update screen):
 * - If the calculated Nearest 9 equals the current/old retail price -> blank (no change).
 * - Otherwise -> show the exact Nearest 9 value already stored on the row.
 * - If there is no Nearest 9 stored, the cell stays blank.
 * This uses the existing row data only; it performs no new pricing calculation.
 */
export function storeCountNewPrice(
  nearest9: string | { toString(): string } | null | undefined,
  oldRetailPrice: string | { toString(): string } | null | undefined,
): string {
  const n9 = nearest9 === null || nearest9 === undefined ? "" : String(nearest9).trim();
  if (!n9) return "";
  const old = oldRetailPrice === null || oldRetailPrice === undefined ? "" : String(oldRetailPrice).trim();
  if (!old) return n9;
  const a = Number(n9);
  const b = Number(old);
  if (Number.isFinite(a) && Number.isFinite(b)) return a === b ? "" : n9;
  return n9 === old ? "" : n9;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const raw = await req.json().catch(() => ({}));
  const body = (raw && typeof raw === "object" ? raw : {}) as { ids?: unknown; sortKey?: unknown; sortDir?: unknown };
  // Optional table order: when the client sorted the table it sends the sorted
  // visible ids; the PDF then lists the SAME rows in that order. Inclusion
  // rules are unchanged — unknown ids are ignored, not added.
  const reqSort = parseSortParam(body.sortKey, body.sortDir);
  const orderIds = Array.isArray(body.ids) && body.ids.length
    ? [...new Set((body.ids as unknown[]).map((v) => String(v ?? "")).filter(Boolean))].slice(0, 20000)
    : null;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  let sessionName = id, sessionVendor = "";
  type PdfRow = { cleanedSku: string; productName: string; sizeDesc: string; newPrice: string };
  let rows: PdfRow[] = [];
  const orderRows = <T extends { id: string }>(list: T[]): T[] => {
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
  if (!prisma) {
    const store = loadFileStore();
    const s = store.sessions.find((x) => x.id === id);
    sessionName = s?.name ?? id; sessionVendor = s?.vendor ?? "";
    const pmap = new Map(store.products.map((p) => [p.id, p]));
    const liveInactive = (productId: string | null, rowFlag: boolean) => {
      if (!productId) return rowFlag;
      return pmap.get(productId)?.isInactive ?? rowFlag;
    };
    rows = orderRows(store.items
      .filter((i) => i.sessionId === id && !liveInactive(i.productId, i.isInactive) && (!orderIds || orderIds.includes(i.id)))
      .map((i) => ({
        id: i.id,
        cleanedSku: i.cleanedSku, productName: i.productName,
        sizeDesc: i.productId ? pmap.get(i.productId)?.sizeDesc ?? "" : "",
        newPrice: storeCountNewPrice(i.nearest9, i.oldRetailPrice),
        brand: i.brand, vendor: i.vendor, notes: i.notes,
        discount: i.discount, currentListPrice: i.currentListPrice, vendorListPriceNew: i.vendorListPriceNew,
        ourNewListPrice: null, marginDivisor: i.marginDivisor, ourNewRetailPrice: null,
        oldRetailPrice: i.oldRetailPrice, nearest9: i.nearest9,
        matched: i.matched, isInactive: i.isInactive, cleanedOverridden: i.cleanedOverridden,
      }))).map((x): PdfRow => ({ cleanedSku: x.cleanedSku, productName: x.productName, sizeDesc: x.sizeDesc, newPrice: x.newPrice }));
    store.exports.push({ id: cuid(), sessionId: id, kind: "storecount-pdf", createdBy: session.email, createdAt: new Date().toISOString(), detail: `${rows.length} rows` });
    saveFileStore(store);
  } else {
    try {
      const s = await prisma.priceUpdateSession.findUnique({ where: { id } });
      sessionName = s?.name ?? id; sessionVendor = s?.vendor ?? "";
      const items = await prisma.priceUpdateItem.findMany({
        where: { sessionId: id, ...(orderIds ? { id: { in: orderIds } } : {}) },
        orderBy: { createdAt: "asc" }, take: 50000,
      });
      const pids = [...new Set(items.map((i) => i.productId).filter(Boolean))] as string[];
      const prods = pids.length ? await prisma.product.findMany({ where: { id: { in: pids } } }) : [];
      const pmap = new Map(prods.map((p) => [p.id, p]));
      const mapped = items
        .filter((i) => !(i.productId ? pmap.get(i.productId)?.isInactive ?? i.isInactive : i.isInactive))
        .map((i) => ({
          id: i.id,
          cleanedSku: i.cleanedSku, productName: i.productName,
          sizeDesc: i.productId ? pmap.get(i.productId)?.sizeDesc ?? "" : "",
          newPrice: storeCountNewPrice(i.nearest9 ? String(i.nearest9) : null, i.oldRetailPrice ? String(i.oldRetailPrice) : null),
          brand: i.brand, vendor: i.vendor, notes: i.notes,
          discount: String(i.discount ?? "0"), currentListPrice: i.currentListPrice ? String(i.currentListPrice) : null,
          vendorListPriceNew: i.vendorListPriceNew ? String(i.vendorListPriceNew) : null,
          ourNewListPrice: i.ourNewListPrice ? String(i.ourNewListPrice) : null,
          marginDivisor: String(i.marginDivisor ?? "0.605"),
          ourNewRetailPrice: i.ourNewRetailPrice ? String(i.ourNewRetailPrice) : null,
          oldRetailPrice: i.oldRetailPrice ? String(i.oldRetailPrice) : null,
          nearest9: i.nearest9 ? String(i.nearest9) : null,
          matched: i.matched, isInactive: i.isInactive, cleanedOverridden: i.cleanedOverridden,
        }));
      rows = orderRows(mapped).map((x): PdfRow => ({ cleanedSku: x.cleanedSku, productName: x.productName, sizeDesc: x.sizeDesc, newPrice: x.newPrice }));
    } catch (e) {
      if (isDbConnectionError(e)) return dbUnreachableResponse();
      return NextResponse.json({ error: "Could not load rows for the Store Count PDF." }, { status: 500 });
    }
    try {
      await prisma.exportLog.create({ data: { sessionId: id, kind: "storecount-pdf", createdBy: session.email, detail: `${rows.length} rows` } });
    } catch (e) {
      if (isDbConnectionError(e)) return dbUnreachableResponse();
      // Export logging must not block the PDF download itself.
    }
  }

  if (!rows.length) {
    return NextResponse.json({ error: "No active rows to print. All rows are inactive or the session is empty." }, { status: 400 });
  }

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const cols = ["SKU", "Description", "Size Desc.", "New Price", "QOH", "Expiry", "Notes"];
  const widths = [90, 250, 70, 70, 60, 70, 130]; // landscape letter ~ 756pt usable
  let pageNum = 0;
  const totalPages = () => pageNum;

  const drawHeader = (page: ReturnType<typeof pdf.addPage>, y0: number) => {
    const heading = sessionVendor || sessionName || "Store Count";
    page.drawText(heading, { x: 36, y: y0, size: 14, font: fontBold });
    page.drawText(dateStr, { x: 36, y: y0 - 18, size: 10, font });
    page.drawText("Staff: ________________________", { x: 400, y: y0 - 18, size: 10, font });
    const line1 = "Please check all layaways, holds for transfers, overstock etc. Please note page # on each page.";
    const line2 = "Note: If the New Price is empty, there is no price change. However, all items must still be counted for QOH and Expiry.";
    page.drawText(line1, { x: 36, y: y0 - 40, size: 10, font: fontBold });
    page.drawText(line2.slice(0, 110), { x: 36, y: y0 - 56, size: 10, font: fontBold });
    page.drawText(line2.slice(110), { x: 36, y: y0 - 70, size: 10, font: fontBold });
    return y0 - 88;
  };

  const drawTableHeader = (page: ReturnType<typeof pdf.addPage>, y: number) => {
    let x = 36;
    cols.forEach((c, i) => {
      page.drawRectangle({ x, y: y - 4, width: widths[i], height: 16, borderColor: rgb(0, 0, 0), borderWidth: 0.75 });
      page.drawText(c, { x: x + 3, y, size: 8, font: fontBold });
      x += widths[i];
    });
    return y - 16;
  };

  let page = pdf.addPage([792, 612]); // landscape letter
  pageNum++;
  let y = drawHeader(page, 576);
  y = drawTableHeader(page, y);
  const rowH = 18;

  rows.forEach((r) => {
    if (y < 50) {
      page.drawText(`Page ${pageNum}`, { x: 720, y: 24, size: 8, font });
      page = pdf.addPage([792, 612]);
      pageNum++;
      y = drawHeader(page, 576);
      y = drawTableHeader(page, y);
    }
    const cells = [r.cleanedSku, r.productName.slice(0, 48), r.sizeDesc, r.newPrice, "", "", ""];
    let x = 36;
    cells.forEach((c, i) => {
      page.drawRectangle({ x, y: y - 4, width: widths[i], height: rowH, borderColor: rgb(0, 0, 0), borderWidth: 0.5 });
      if (c) page.drawText(String(c), { x: x + 3, y, size: 8, font });
      x += widths[i];
    });
    y -= rowH;
  });
  page.drawText(`Page ${pageNum} of ${totalPages()}`, { x: 700, y: 24, size: 8, font });

  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename=\"storecount-${id}.pdf\"` },
  });
}
