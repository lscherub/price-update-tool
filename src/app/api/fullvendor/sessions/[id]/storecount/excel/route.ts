import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPrisma, dbUnreachableResponse, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { loadFileStore, saveFileStore, cuid } from "@/lib/store";
import { parseSortParam, sortItems } from "@/lib/itemSort";
import { fullVendorSessionIds } from "@/lib/fullVendorServer";
import { buildFullVendorCountWorkbook, fullVendorEffectivePrice, fullVendorNewPrice, type FullVendorCountRow } from "@/lib/fullVendorExcel";

export const runtime = "nodejs";
export const maxDuration = 60;

type Lite = {
  id: string; cleanedSku: string; rawVendorSku: string; productNumber: string; productName: string;
  brand: string; vendor: string; notes: string; matched: boolean; isInactive: boolean; cleanedOverridden: boolean;
  nearest9: string | null; oldRetailPrice: string | null;
  sku: string; description: string; sizeDesc: string;
};

/**
 * POST /api/fullvendor/sessions/[id]/storecount/excel
 *
 * Digital Store Count workbook for a Full Vendor Price Update sheet ONLY.
 * - Every row of the sheet is exported (Active and Inactive, priced or not).
 * - SKU / Description / Size Desc. come from the live inventory product.
 * - New Price = final worksheet Nearest 9 (custom included), blank when unchanged.
 * Optional body { ids, sortKey, sortDir } keeps the on-screen order.
 * The existing Store Count PDF/Excel and POS exports are not involved.
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
    priceMode?: "changed" | "all";
    productFilter?: "all" | "active" | "inactive";
  };
  const priceMode = body.priceMode === "all" ? "all" : "changed";
  const productFilter = body.productFilter === "active" || body.productFilter === "inactive" ? body.productFilter : "all";
  const reqSort = parseSortParam(body.sortKey, body.sortDir);
  const orderIds = Array.isArray(body.ids) && body.ids.length
    ? [...new Set((body.ids as unknown[]).map((v) => String(v ?? "")).filter(Boolean))].slice(0, 50000)
    : null;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  let vendor = "";
  let list: Lite[] = [];
  try {
    if (!(await fullVendorSessionIds(prisma, [id])).has(id)) {
      return NextResponse.json({ error: "This export is only available for Full Vendor Price Updates." }, { status: 400 });
    }
    if (!prisma) {
      const store = loadFileStore();
      vendor = store.sessions.find((s) => s.id === id)?.vendor ?? "";
      const pmap = new Map(store.products.map((p) => [p.id, p]));
      list = store.items.filter((i) => i.sessionId === id).map((i) => {
        const p = i.productId ? pmap.get(i.productId) : undefined;
        return {
          ...i, nearest9: i.nearest9 ?? null, oldRetailPrice: i.oldRetailPrice ?? null,
          isInactive: p ? p.isInactive : i.isInactive,
          sku: p?.sku ?? i.cleanedSku, description: p?.description ?? i.productName, sizeDesc: p?.sizeDesc ?? "",
        };
      });
    } else {
      const s = await prisma.priceUpdateSession.findUnique({ where: { id } });
      if (!s) return NextResponse.json({ error: "Price update not found" }, { status: 404 });
      vendor = s.vendor;
      const items = await prisma.priceUpdateItem.findMany({ where: { sessionId: id }, orderBy: { createdAt: "asc" }, take: 50000 });
      const pids = [...new Set(items.map((i) => i.productId).filter(Boolean))] as string[];
      const prods = pids.length ? await prisma.product.findMany({ where: { id: { in: pids } } }) : [];
      const pmap = new Map(prods.map((p) => [p.id, p]));
      list = items.map((i) => {
        const p = i.productId ? pmap.get(i.productId) : undefined;
        return {
          id: i.id, cleanedSku: i.cleanedSku, rawVendorSku: i.rawVendorSku, productNumber: i.productNumber,
          productName: i.productName, brand: i.brand, vendor: i.vendor, notes: i.notes, matched: i.matched,
          cleanedOverridden: i.cleanedOverridden, isInactive: p ? p.isInactive : i.isInactive,
          nearest9: i.nearest9 ? String(i.nearest9) : null,
          oldRetailPrice: i.oldRetailPrice ? String(i.oldRetailPrice) : null,
          sku: p?.sku ?? i.cleanedSku, description: p?.description ?? i.productName, sizeDesc: p?.sizeDesc ?? "",
        };
      });
    }
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load rows for the Digital Store Count export." }, { status: 500 });
  }

  if (orderIds) {
    const pos = new Map(orderIds.map((x, i) => [x, i]));
    list = list.map((r, i) => ({ r, i }))
      .sort((a, b) => (pos.get(a.r.id) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.r.id) ?? Number.MAX_SAFE_INTEGER) || a.i - b.i)
      .map((x) => x.r);
  } else if (reqSort) {
    list = sortItems(list, reqSort.key, reqSort.dir);
  } else {
    list = [...list].sort((a, b) => a.sku.localeCompare(b.sku));
  }

  if (productFilter === "active") {
    list = list.filter((r) => !r.isInactive);
  } else if (productFilter === "inactive") {
    list = list.filter((r) => r.isInactive);
  }

  // One line per product even if a sheet somehow holds a duplicate row.
  const seen = new Set<string>();
  const rows: FullVendorCountRow[] = [];
  for (const r of list) {
    const key = r.sku || r.id;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      sku: r.sku,
      description: r.description,
      sizeDesc: r.sizeDesc,
      newPrice: fullVendorEffectivePrice(r.nearest9, r.oldRetailPrice, priceMode),
      isInactive: Boolean(r.isInactive),
    });
  }
  if (!rows.length) return NextResponse.json({ error: "No products match the selected export options." }, { status: 400 });

  try {
    if (prisma) {
      await prisma.exportLog.create({ data: { sessionId: id, kind: "fullvendor-storecount-excel", createdBy: session.email, detail: `${rows.length} rows` } }).catch((e) => {
        if (isDbConnectionError(e)) throw e;
      });
    } else {
      const store = loadFileStore();
      store.exports.push({ id: cuid(), sessionId: id, kind: "fullvendor-storecount-excel", createdBy: session.email, createdAt: new Date().toISOString(), detail: `${rows.length} rows` });
      saveFileStore(store);
    }
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
  }

  const buf = buildFullVendorCountWorkbook(rows, {
    vendor,
    date: new Date(),
    priceMode,
    productFilter,
  });
  const safe = vendor.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "vendor";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="store-count-${safe}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
