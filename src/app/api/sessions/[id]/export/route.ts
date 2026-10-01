import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPrisma, dbUnreachableResponse, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { loadFileStore, saveFileStore, cuid } from "@/lib/store";

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
function fileStoreItems(sessionId: string): ExportRow[] {
  const store = loadFileStore();
  const products = new Map(store.products.map((p) => [p.id, p]));
  return store.items
    .filter((i) => i.sessionId === sessionId)
    .map((i) => {
      const live = i.productId ? products.get(i.productId) : undefined;
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
  const pids = [...new Set(items.map((i) => i.productId).filter(Boolean))] as string[];
  const prods = pids.length ? await prisma.product.findMany({ where: { id: { in: pids } } }) : [];
  const pmap = new Map(prods.map((p) => [p.id, p]));
  return items.map((i) => {
    const live = i.productId ? pmap.get(i.productId) : undefined;
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
  try {
    rows = prisma ? await getItems(id, prisma) : fileStoreItems(id);
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load rows for export." }, { status: 500 });
  }
  if (kind === "storecount") {
    // Exclude inactive; blank New Price when ourNewList == currentList
    const filtered = rows.filter((r) => !r.isInactive);
    const mapped = filtered.map((r) => ({
      SKU: r.cleanedSku, Description: r.productName,
      "Size Desc.": r.sizeDesc,
      "New Price": r.ourNewListPrice && r.currentListPrice && r.ourNewListPrice === r.currentListPrice ? "" : (r.nearest9 ?? ""),
      QOH: "", Expiry: "", Notes: "",
    }));
    try {
      if (prisma) await recordExport(prisma, id, "storecount", session.email, rows.length);
      else recordFileStoreExport(id, "storecount", session.email, rows.length);
    } catch (e) {
      if (isDbConnectionError(e)) return dbUnreachableResponse();
      // Export logging must never block the download.
    }
    const header = "SKU,Description,Size Desc.,New Price,QOH,Expiry,Notes";
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [header, ...mapped.map((m) => [m.SKU, m.Description, m["Size Desc."], m["New Price"], "", "", ""].map(esc).join(","))].join("\n") + "\n";
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename=\"storecount-${id}.csv\"` } });
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
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename=\"pos-export-${id}.csv\"` } });
}
