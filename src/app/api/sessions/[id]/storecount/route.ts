import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getSession } from "@/lib/auth";
import { getPrisma, dbUnreachableResponse, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { loadFileStore, saveFileStore, cuid } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const onlyIds = Array.isArray(body.ids) ? (body.ids as string[]) : null;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  let sessionName = id, sessionVendor = "";
  let rows: { cleanedSku: string; productName: string; sizeDesc: string; newPrice: string }[] = [];
  if (!prisma) {
    const store = loadFileStore();
    const s = store.sessions.find((x) => x.id === id);
    sessionName = s?.name ?? id; sessionVendor = s?.vendor ?? "";
    const pmap = new Map(store.products.map((p) => [p.id, p]));
    const liveInactive = (productId: string | null, rowFlag: boolean) => {
      if (!productId) return rowFlag;
      return pmap.get(productId)?.isInactive ?? rowFlag;
    };
    rows = store.items
      .filter((i) => i.sessionId === id && !liveInactive(i.productId, i.isInactive) && (!onlyIds || onlyIds.includes(i.id)))
      .map((i) => ({
        cleanedSku: i.cleanedSku, productName: i.productName,
        sizeDesc: i.productId ? pmap.get(i.productId)?.sizeDesc ?? "" : "",
        newPrice: i.ourNewListPrice && i.currentListPrice && i.ourNewListPrice === i.currentListPrice ? "" : (i.nearest9 ?? ""),
      }));
    store.exports.push({ id: cuid(), sessionId: id, kind: "storecount-pdf", createdBy: session.email, createdAt: new Date().toISOString(), detail: `${rows.length} rows` });
    saveFileStore(store);
  } else {
    try {
      const s = await prisma.priceUpdateSession.findUnique({ where: { id } });
      sessionName = s?.name ?? id; sessionVendor = s?.vendor ?? "";
      const items = await prisma.priceUpdateItem.findMany({
        where: { sessionId: id, ...(onlyIds ? { id: { in: onlyIds.slice(0, 20000) } } : {}) },
        orderBy: { cleanedSku: "asc" }, take: 50000,
      });
      const pids = [...new Set(items.map((i) => i.productId).filter(Boolean))] as string[];
      const prods = pids.length ? await prisma.product.findMany({ where: { id: { in: pids } } }) : [];
      const pmap = new Map(prods.map((p) => [p.id, p]));
      rows = items
        .filter((i) => !(i.productId ? pmap.get(i.productId)?.isInactive ?? i.isInactive : i.isInactive))
        .map((i) => ({
          cleanedSku: i.cleanedSku, productName: i.productName,
          sizeDesc: i.productId ? pmap.get(i.productId)?.sizeDesc ?? "" : "",
          newPrice: i.ourNewListPrice && i.currentListPrice && String(i.ourNewListPrice) === String(i.currentListPrice) ? "" : (i.nearest9 ? String(i.nearest9) : ""),
        }));
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
    page.drawText(`${sessionVendor ? sessionVendor + " — " : ""}${sessionName}`, { x: 36, y: y0, size: 14, font: fontBold });
    page.drawText(dateStr, { x: 36, y: y0 - 18, size: 10, font });
    page.drawText("Staff: ________________________", { x: 400, y: y0 - 18, size: 10, font });
    const instructions = "Please check all layaways, holds for transfers, overstock etc. Please note page # on each page. Note: If the New Price is empty, there is no price change. However, all items must still be counted for QOH and Expiry.";
    page.drawText(instructions.slice(0, 130), { x: 36, y: y0 - 34, size: 7, font });
    page.drawText(instructions.slice(130), { x: 36, y: y0 - 44, size: 7, font });
    return y0 - 60;
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
