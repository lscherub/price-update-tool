import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { buildContentDisposition, buildExportFilename } from "@/lib/exportFilename";
import { parseSortParam, sortItems } from "@/lib/itemSort";
import {
  buildRawWorksheetWorkbook,
  type RawWorksheetRowInput,
  type RequestedRawColumn,
} from "@/lib/rawWorksheetExcel";
import { loadFileStore } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

type LoadedRow = RawWorksheetRowInput & { id: string };

/**
 * POST /api/sessions/[id]/raw-export
 *
 * Read-only export of the complete raw price update worksheet as an editable .xlsx workbook.
 * - Includes ALL rows belonging to the session (not just currently filtered/visible rows).
 * - Preserves active worksheet column selection, column order, headings, and row sort order.
 * - Does NOT modify worksheet data, session status, schedules, or inventory.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const raw = await req.json().catch(() => ({}));
  const body = (raw && typeof raw === "object" ? raw : {}) as {
    ids?: unknown;
    sortKey?: unknown;
    sortDir?: unknown;
    columns?: unknown;
  };

  const reqSort = parseSortParam(body.sortKey, body.sortDir);
  const orderIds =
    Array.isArray(body.ids) && body.ids.length
      ? [...new Set((body.ids as unknown[]).map((v) => String(v ?? "")).filter(Boolean))].slice(0, 50000)
      : null;

  const requestedColumns: RequestedRawColumn[] | null = Array.isArray(body.columns)
    ? body.columns
        .filter((c): c is { key: string; label?: string } => Boolean(c && typeof c === "object" && typeof (c as { key?: unknown }).key === "string"))
        .map((c) => ({
          key: c.key,
          label: typeof c.label === "string" ? c.label : undefined,
        }))
    : null;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  let sessionName = "";
  let rows: LoadedRow[] = [];

  if (!prisma) {
    const store = loadFileStore();
    const s = store.sessions.find((x) => x.id === id);
    if (!s) return NextResponse.json({ error: "Price update not found" }, { status: 404 });
    sessionName = s.name ?? "";
    rows = store.items
      .filter((i) => i.sessionId === id)
      .map((i) => ({
        id: i.id,
        rawVendorSku: i.rawVendorSku,
        cleanedSku: i.cleanedSku,
        cleanedOverridden: i.cleanedOverridden,
        productNumber: i.productNumber,
        productName: i.productName,
        brand: i.brand,
        vendor: i.vendor,
        discount: i.discount ?? "0.00",
        currentListPrice: i.currentListPrice ?? null,
        vendorListPriceNew: i.vendorListPriceNew ?? null,
        ourNewListPrice: i.ourNewListPrice ?? null,
        marginDivisor: i.marginDivisor ?? "0.605",
        ourNewRetailPrice: i.ourNewRetailPrice ?? null,
        oldRetailPrice: i.oldRetailPrice ?? null,
        nearest9: i.nearest9 ?? null,
        nearest9Custom: i.nearest9Custom ?? null,
        notes: i.notes ?? "",
        isInactive: i.isInactive,
        matched: i.matched,
      }));
  } else {
    try {
      const s = await prisma.priceUpdateSession.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      if (!s) return NextResponse.json({ error: "Price update not found" }, { status: 404 });
      sessionName = s.name ?? "";
      const items = await prisma.priceUpdateItem.findMany({
        where: { sessionId: id },
        orderBy: { createdAt: "asc" },
        take: 50000,
      });
      rows = items.map((i) => ({
        id: i.id,
        rawVendorSku: i.rawVendorSku,
        cleanedSku: i.cleanedSku,
        cleanedOverridden: i.cleanedOverridden,
        productNumber: i.productNumber,
        productName: i.productName,
        brand: i.brand,
        vendor: i.vendor,
        discount: i.discount !== null && i.discount !== undefined ? String(i.discount) : "0.00",
        currentListPrice: i.currentListPrice !== null && i.currentListPrice !== undefined ? String(i.currentListPrice) : null,
        vendorListPriceNew: i.vendorListPriceNew !== null && i.vendorListPriceNew !== undefined ? String(i.vendorListPriceNew) : null,
        ourNewListPrice: i.ourNewListPrice !== null && i.ourNewListPrice !== undefined ? String(i.ourNewListPrice) : null,
        marginDivisor: i.marginDivisor !== null && i.marginDivisor !== undefined ? String(i.marginDivisor) : "0.605",
        ourNewRetailPrice: i.ourNewRetailPrice !== null && i.ourNewRetailPrice !== undefined ? String(i.ourNewRetailPrice) : null,
        oldRetailPrice: i.oldRetailPrice !== null && i.oldRetailPrice !== undefined ? String(i.oldRetailPrice) : null,
        nearest9: i.nearest9 !== null && i.nearest9 !== undefined ? String(i.nearest9) : null,
        nearest9Custom: i.nearest9Custom !== null && i.nearest9Custom !== undefined ? String(i.nearest9Custom) : null,
        notes: i.notes ?? "",
        isInactive: i.isInactive,
        matched: i.matched,
      }));
    } catch (e) {
      if (isDbConnectionError(e)) return dbUnreachableResponse();
      return NextResponse.json({ error: "Could not load worksheet rows for raw export." }, { status: 500 });
    }
  }

  // Order rows according to active worksheet sort without ever omitting any session row.
  let orderedRows = rows;
  if (orderIds) {
    const pos = new Map(orderIds.map((rid, idx) => [rid, idx]));
    orderedRows = rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const pa = pos.has(a.r.id) ? (pos.get(a.r.id) as number) : Number.MAX_SAFE_INTEGER;
        const pb = pos.has(b.r.id) ? (pos.get(b.r.id) as number) : Number.MAX_SAFE_INTEGER;
        return pa - pb || a.i - b.i;
      })
      .map((x) => x.r);
  } else if (reqSort) {
    orderedRows = sortItems(rows, reqSort.key, reqSort.dir);
  }

  const buf = buildRawWorksheetWorkbook(orderedRows, {
    sheetName: sessionName || "Raw Worksheet",
    columns: requestedColumns,
  });
  const filename = buildExportFilename(sessionName, "Raw Worksheet", "xlsx");

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": buildContentDisposition(filename),
      "Cache-Control": "no-store",
    },
  });
}
