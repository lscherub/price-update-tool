import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { loadFileStore, saveFileStore, cuid } from "@/lib/store";

async function getItems(sessionId: string) {
  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    const products = new Map(store.products.map((p) => [p.id, p]));
    return store.items.filter((i) => i.sessionId === sessionId).map((i) => {
      const live = i.productId ? products.get(i.productId) : undefined;
      return {
        ...i,
        // re-check liveness at export time: inactive must be excluded from Store Count
        // even if the flag was set after the row was calculated
        isInactive: live ? live.isInactive : i.isInactive,
        sizeDesc: live?.sizeDesc ?? "",
      };
    });
  }
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
  return lines.join("\n");
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind") ?? "pos";
  const rows = await getItems(id);
  if (kind === "storecount") {
    // Exclude inactive; blank New Price when ourNewList == currentList
    const filtered = rows.filter((r) => !r.isInactive);
    const mapped = filtered.map((r) => ({
      SKU: r.cleanedSku, Description: r.productName,
      "Size Desc.": (r as { sizeDesc: string }).sizeDesc,
      "New Price": r.ourNewListPrice && r.currentListPrice && r.ourNewListPrice === r.currentListPrice ? "" : (r.nearest9 ?? ""),
      QOH: "", Expiry: "", Notes: "",
    }));
    const header = "SKU,Description,Size Desc.,New Price,QOH,Expiry,Notes";
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [header, ...mapped.map((m) => [m.SKU, m.Description, m["Size Desc."], m["New Price"], "", "", ""].map(esc).join(","))].join("\n");
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename=\"storecount-${id}.csv\"` } });
  }
  const csv = toPosCsv(rows.map((r) => ({ cleanedSku: r.cleanedSku, ourNewListPrice: r.ourNewListPrice, nearest9: r.nearest9 })));
  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    store.exports.push({ id: cuid(), sessionId: id, kind, createdBy: session.email, createdAt: new Date().toISOString(), detail: `${rows.length} rows` });
    saveFileStore(store);
  } else {
    await prisma.exportLog.create({ data: { sessionId: id, kind, createdBy: session.email, detail: `${rows.length} rows` } });
    await prisma.priceUpdateSession.update({ where: { id }, data: { status: "Exported" } }).catch(() => null);
  }
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename=\"pos-export-${id}.csv\"` } });
}
