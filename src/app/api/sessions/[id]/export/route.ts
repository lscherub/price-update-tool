import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPrisma, dbUnreachableResponse, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { loadFileStore, saveFileStore, cuid } from "@/lib/store";
import { resolveLiveProducts } from "@/lib/lookup";
import { buildContentDisposition, buildExportFilename } from "@/lib/exportFilename";
import { fullVendorSessionIds } from "@/lib/fullVendorServer";
import { filterAndMapPosRows, type PosExportMode } from "@/lib/fullVendorPosExport";

export const runtime = "nodejs";

type ExportRow = {
  id: string; rawVendorSku: string; cleanedSku: string;
  productNumber: string; productName: string; brand: string; vendor: string;
  discount: string; currentListPrice: string | null; vendorListPriceNew: string | null;
  ourNewListPrice: string | null; marginDivisor: string;
  ourNewRetailPrice: string | null; oldRetailPrice: string | null;
  nearest9: string | null; notes: string; isInactive: boolean; matched: boolean;
  sizeDesc: string;
};

/** Dev-only fallback: re-check liveness so inactive products are excluded even
 *  if the flag was set after the row was calculated. */
async function fileStoreItems(sessionId: string): Promise<ExportRow[]> {
  const store = loadFileStore();
  const sessionItems = store.items.filter((i) => i.sessionId === sessionId);
  const resolveProduct = await resolveLiveProducts(sessionItems, null);
  return sessionItems.map((i) => {
    const live = resolveProduct(i);
    return { ...i, isInactive: live ? live.isInactive : i.isInactive, sizeDesc: live?.sizeDesc ?? "" };
  });
}

/** Record an export in ExportLog (Postgres) or the dev file store. Never
 *  blocks the download: logging failures are swallowed except for DB outages. */
async function recordExport(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
  sessionId: string,
  kind: string,
  createdBy: string,
  count: number,
) {
  const detail = `${count} rows`;
  try {
    await prisma.exportLog.create({ data: { sessionId, kind, createdBy, detail } });
  } catch (e) {
    if (isDbConnectionError(e)) throw e;
    // Unknown session/broken FK must not break the download.
  }
}

function recordFileStoreExport(sessionId: string, kind: string, createdBy: string, count: number, markExported = false) {
  const store = loadFileStore();
  store.exports.push({ id: cuid(), sessionId, kind, createdBy, createdAt: new Date().toISOString(), detail: `${count} rows` });
  if (markExported) {
    const s = store.sessions.find((x) => x.id === sessionId);
    if (s) { s.status = "Exported"; s.updatedAt = new Date().toISOString(); }
  }
  saveFileStore(store);
}

async function getItems(sessionId: string, prisma: NonNullable<ReturnType<typeof getPrisma>>): Promise<ExportRow[]> {
  const items = await prisma.priceUpdateItem.findMany({ where: { sessionId }, take: 50000, orderBy: { createdAt: "asc" } });
  const resolveProduct = await resolveLiveProducts(items, prisma);
  return items.map((i) => {
    const live = resolveProduct(i);
    return {
      id: i.id, rawVendorSku: i.rawVendorSku, cleanedSku: i.cleanedSku,
      productNumber: i.productNumber, productName: i.productName, brand: i.brand, vendor: i.vendor,
      discount: String(i.discount ?? "0"), currentListPrice: i.currentListPrice ? String(i.currentListPrice) : null,
      vendorListPriceNew: i.vendorListPriceNew ? String(i.vendorListPriceNew) : null,
      ourNewListPrice: i.ourNewListPrice ? String(i.ourNewListPrice) : null,
      marginDivisor: String(i.marginDivisor ?? "0.605"),
      ourNewRetailPrice: i.ourNewRetailPrice ? String(i.ourNewRetailPrice) : null,
      oldRetailPrice: i.oldRetailPrice ? String(i.oldRetailPrice) : null,
      nearest9: i.nearest9 ? String(i.nearest9) : null, notes: i.notes,
      isInactive: live ? live.isInactive : i.isInactive, matched: i.matched,
      sizeDesc: live?.sizeDesc ?? "",
    };
  });
}

function toPosCsv(rows: { cleanedSku: string; ourNewListPrice: string | null; nearest9: string | null }[]): string {
  const esc = (v: string | null) => {
    const s = v ?? "";
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ["Cleaned SKU,Our New List Price,Nearest 9"];
  for (const r of rows) {
    if (!r.cleanedSku) continue;
    lines.push([esc(r.cleanedSku), esc(r.ourNewListPrice), esc(r.nearest9)].join(","));
  }
  return lines.join("\n") + "\n";
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind") ?? "pos";
  if (kind !== "pos" && kind !== "storecount") {
    return NextResponse.json({ error: 'Invalid export kind. Use "pos" or "storecount".' }, { status: 400 });
  }
  // Fail closed before touching any data source: in production a missing
  // DATABASE_URL must be a 503, never an empty CSV built from local JSON.
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  let rows: ExportRow[];
  let sessionName = "";
  try {
    if (prisma) {
      const [s, loadedRows] = await Promise.all([
        prisma.priceUpdateSession.findUnique({ where: { id }, select: { name: true } }).catch(() => null),
        getItems(id, prisma),
      ]);
      sessionName = s?.name ?? "";
      rows = loadedRows;
    } else {
      const s = loadFileStore().sessions.find((x) => x.id === id);
      sessionName = s?.name ?? "";
      rows = await fileStoreItems(id);
    }
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load rows for export." }, { status: 500 });
  }
  if (kind === "storecount") {
    return NextResponse.json(
      { error: "Store Count CSV has been replaced by Store Count Excel. Use POST /api/sessions/[id]/storecount/excel." },
      { status: 410 },
    );
  }
  const csv = toPosCsv(rows.map((r) => ({ cleanedSku: r.cleanedSku, ourNewListPrice: r.ourNewListPrice, nearest9: r.nearest9 })));
  try {
    if (prisma) {
      await recordExport(prisma, id, kind, session.email, rows.length);
      await prisma.priceUpdateSession.update({ where: { id }, data: { status: "Exported" } }).catch(() => null);
    } else {
      recordFileStoreExport(id, kind, session.email, rows.length, true);
    }
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not record export." }, { status: 500 });
  }
  const filename = buildExportFilename(sessionName, "POS Export", "csv");
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": buildContentDisposition(filename) } });
}

/**
 * POST /api/sessions/[id]/export
 *
 * POS CSV export with selection and price options for Full Vendor Price Updates ONLY.
 * Options supported in request body:
 * - mode: "all" | "all-populate" | "changed" | "selected"
 * - selectedIds?: string[]
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const raw = await req.json().catch(() => ({}));
  const body = (raw && typeof raw === "object" ? raw : {}) as {
    kind?: string;
    mode?: unknown;
    selectedIds?: unknown;
  };

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const rawMode = String(body.mode ?? "all").trim();
  const mode: PosExportMode =
    rawMode === "all-populate" || rawMode === "changed" || rawMode === "selected"
      ? rawMode
      : "all";

  const selectedIds = Array.isArray(body.selectedIds)
    ? body.selectedIds.map((v) => String(v ?? "")).filter(Boolean)
    : [];

  if (mode === "selected" && selectedIds.length === 0) {
    return NextResponse.json({ error: "No products selected for export." }, { status: 400 });
  }

  let rows: ExportRow[];
  let sessionName = "";
  try {
    const isFv = (await fullVendorSessionIds(prisma, [id])).has(id);
    if (!isFv) {
      return NextResponse.json(
        { error: "POS export options are only available for Full Vendor Price Updates." },
        { status: 400 },
      );
    }

    if (prisma) {
      const [s, loadedRows] = await Promise.all([
        prisma.priceUpdateSession.findUnique({ where: { id }, select: { name: true } }).catch(() => null),
        getItems(id, prisma),
      ]);
      sessionName = s?.name ?? "";
      rows = loadedRows;
    } else {
      const s = loadFileStore().sessions.find((x) => x.id === id);
      sessionName = s?.name ?? "";
      rows = await fileStoreItems(id);
    }
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load rows for export." }, { status: 500 });
  }

  const exportRows = filterAndMapPosRows(rows, { mode, selectedIds });
  if (!exportRows.length) {
    return NextResponse.json({ error: "No products match the selected export options." }, { status: 400 });
  }

  const csv = toPosCsv(exportRows);
  const kind = "pos";
  try {
    if (prisma) {
      await recordExport(prisma, id, kind, session.email, exportRows.length);
      await prisma.priceUpdateSession.update({ where: { id }, data: { status: "Exported" } }).catch(() => null);
    } else {
      recordFileStoreExport(id, kind, session.email, exportRows.length, true);
    }
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not record export." }, { status: 500 });
  }

  const filename = buildExportFilename(sessionName, "POS Export", "csv");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": buildContentDisposition(filename),
    },
  });
}
