import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { loadFileStore, saveFileStore } from "@/lib/store";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    const s = store.sessions.find((x) => x.id === id);
    if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ session: s, items: store.items.filter((i) => i.sessionId === id) });
  }
  const s = await prisma.priceUpdateSession.findUnique({ where: { id } });
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const items = await prisma.priceUpdateItem.findMany({ where: { sessionId: id }, orderBy: { createdAt: "asc" }, take: 50000 });
  return NextResponse.json({
    session: { id: s.id, vendor: s.vendor, name: s.name, status: s.status, notes: s.notes, createdBy: s.createdBy },
    items: items.map((i) => ({
      id: i.id, sessionId: i.sessionId, rawVendorSku: i.rawVendorSku, cleanedSku: i.cleanedSku,
      cleanedOverridden: i.cleanedOverridden, productId: i.productId, productNumber: i.productNumber,
      productName: i.productName, brand: i.brand, vendor: i.vendor,
      discount: i.discount ? String(i.discount) : "0.00",
      currentListPrice: i.currentListPrice ? String(i.currentListPrice) : null,
      vendorListPriceNew: i.vendorListPriceNew ? String(i.vendorListPriceNew) : null,
      ourNewListPrice: i.ourNewListPrice ? String(i.ourNewListPrice) : null,
      marginDivisor: i.marginDivisor ? String(i.marginDivisor) : "0.605",
      ourNewRetailPrice: i.ourNewRetailPrice ? String(i.ourNewRetailPrice) : null,
      oldRetailPrice: i.oldRetailPrice ? String(i.oldRetailPrice) : null,
      nearest9: i.nearest9 ? String(i.nearest9) : null, notes: i.notes,
      isInactive: i.isInactive, matched: i.matched,
    })),
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    const s = store.sessions.find((x) => x.id === id);
    if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (body.status) s.status = String(body.status);
    if (body.notes !== undefined) s.notes = String(body.notes);
    if (body.name) s.name = String(body.name);
    if (body.vendor !== undefined) s.vendor = String(body.vendor);
    s.updatedAt = new Date().toISOString();
    saveFileStore(store);
    return NextResponse.json({ ok: true, session: s });
  }
  const s = await prisma.priceUpdateSession.update({
    where: { id },
    data: {
      status: body.status ? String(body.status) : undefined,
      notes: body.notes !== undefined ? String(body.notes) : undefined,
      name: body.name ? String(body.name) : undefined,
      vendor: body.vendor !== undefined ? String(body.vendor) : undefined,
    },
  });
  return NextResponse.json({ ok: true, session: { id: s.id, status: s.status } });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });
  const { id } = await ctx.params;
  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    store.sessions = store.sessions.filter((x) => x.id !== id);
    store.items = store.items.filter((x) => x.sessionId !== id);
    saveFileStore(store);
    return NextResponse.json({ ok: true });
  }
  await prisma.priceUpdateSession.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
