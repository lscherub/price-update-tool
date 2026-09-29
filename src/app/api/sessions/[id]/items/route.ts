import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { getSession } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { recalcRow } from "@/lib/recalc";
import { loadFileStore, saveFileStore } from "@/lib/store";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const updates = (Array.isArray(body.items) ? body.items : [body]).slice(0, 1000);
  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    const out: unknown[] = [];
    for (const u of updates) {
      const cur = store.items.find((i) => i.id === String(u.id) && i.sessionId === id);
      if (!cur) continue;
      const r = await recalcRow({
        rawVendorSku: cur.rawVendorSku, cleanedSku: cur.cleanedSku,
        cleanedOverridden: cur.cleanedOverridden, discount: cur.discount,
        vendorListPriceNew: cur.vendorListPriceNew, marginDivisor: cur.marginDivisor, notes: cur.notes,
      }, u);
      Object.assign(cur, { ...r, updatedAt: new Date().toISOString() });
      out.push(cur);
    }
    saveFileStore(store);
    return NextResponse.json({ ok: true, items: out });
  }
  const out: unknown[] = [];
  for (const u of updates) {
    const cur = await prisma.priceUpdateItem.findFirst({ where: { id: String(u.id), sessionId: id } });
    if (!cur) continue;
    const r = await recalcRow({
      rawVendorSku: cur.rawVendorSku, cleanedSku: cur.cleanedSku,
      cleanedOverridden: cur.cleanedOverridden, discount: String(cur.discount ?? "0"),
      vendorListPriceNew: cur.vendorListPriceNew ? String(cur.vendorListPriceNew) : null,
      marginDivisor: String(cur.marginDivisor ?? "0.605"), notes: cur.notes,
    }, u);
    await prisma.priceUpdateItem.update({
      where: { id: cur.id },
      data: {
        rawVendorSku: r.rawVendorSku, cleanedSku: r.cleanedSku, cleanedOverridden: r.cleanedOverridden,
        productId: r.productId, productNumber: r.productNumber, productName: r.productName,
        brand: r.brand, vendor: r.vendor, discount: new Decimal(r.discount),
        currentListPrice: r.currentListPrice ? new Decimal(r.currentListPrice) : null,
        vendorListPriceNew: r.vendorListPriceNew ? new Decimal(r.vendorListPriceNew) : null,
        ourNewListPrice: r.ourNewListPrice ? new Decimal(r.ourNewListPrice) : null,
        marginDivisor: new Decimal(r.marginDivisor),
        ourNewRetailPrice: r.ourNewRetailPrice ? new Decimal(r.ourNewRetailPrice) : null,
        oldRetailPrice: r.oldRetailPrice ? new Decimal(r.oldRetailPrice) : null,
        nearest9: r.nearest9 ? new Decimal(r.nearest9) : null,
        notes: r.notes, isInactive: r.isInactive, matched: r.matched,
      },
    });
    out.push({ id: cur.id });
  }
  return NextResponse.json({ ok: true, items: out });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const itemId = searchParams.get("itemId") ?? "";
  const clear = searchParams.get("clear") === "1";
  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    store.items = clear
      ? store.items.filter((i) => i.sessionId !== id)
      : store.items.filter((i) => !(i.sessionId === id && i.id === itemId));
    saveFileStore(store);
    return NextResponse.json({ ok: true });
  }
  if (clear) await prisma.priceUpdateItem.deleteMany({ where: { sessionId: id } });
  else await prisma.priceUpdateItem.deleteMany({ where: { id: itemId, sessionId: id } });
  return NextResponse.json({ ok: true });
}
