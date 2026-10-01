import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { loadFileStore, saveFileStore } from "@/lib/store";

export const runtime = "nodejs";

const ALLOWED_STATUSES = new Set(["Draft", "Ready", "Exported"]);

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (!prisma) {
    const store = loadFileStore();
    const s = store.sessions.find((x) => x.id === id);
    if (!s) return NextResponse.json({ error: "Price update not found" }, { status: 404 });
    return NextResponse.json({ session: s, items: store.items.filter((i) => i.sessionId === id) });
  }
  try {
    const s = await prisma.priceUpdateSession.findUnique({ where: { id } });
    if (!s) return NextResponse.json({ error: "Price update not found" }, { status: 404 });
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
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load price update." }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (body.status !== undefined && !ALLOWED_STATUSES.has(String(body.status))) {
    return NextResponse.json({ error: "Invalid status. Use Draft, Ready, or Exported." }, { status: 400 });
  }
  if (body.name !== undefined && String(body.name).trim().length > 200) {
    return NextResponse.json({ error: "Update name is too long (max 200 characters)" }, { status: 400 });
  }
  if (!prisma) {
    const store = loadFileStore();
    const s = store.sessions.find((x) => x.id === id);
    if (!s) return NextResponse.json({ error: "Price update not found" }, { status: 404 });
    if (body.status) s.status = String(body.status);
    if (body.notes !== undefined) s.notes = String(body.notes).slice(0, 5000);
    if (body.name) s.name = String(body.name);
    if (body.vendor !== undefined) s.vendor = String(body.vendor).slice(0, 200);
    s.updatedAt = new Date().toISOString();
    saveFileStore(store);
    return NextResponse.json({ ok: true, session: s });
  }
  try {
    const s = await prisma.priceUpdateSession.update({
      where: { id },
      data: {
        status: body.status ? String(body.status) : undefined,
        notes: body.notes !== undefined ? String(body.notes).slice(0, 5000) : undefined,
        name: body.name ? String(body.name).slice(0, 200) : undefined,
        vendor: body.vendor !== undefined ? String(body.vendor).slice(0, 200) : undefined,
      },
    });
    return NextResponse.json({ ok: true, session: { id: s.id, status: s.status } });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    if ((e as { code?: string })?.code === "P2025") return NextResponse.json({ error: "Price update not found" }, { status: 404 });
    return NextResponse.json({ error: "Could not update price update." }, { status: 500 });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });
  const { id } = await ctx.params;
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (!prisma) {
    const store = loadFileStore();
    store.sessions = store.sessions.filter((x) => x.id !== id);
    store.items = store.items.filter((x) => x.sessionId !== id);
    saveFileStore(store);
    return NextResponse.json({ ok: true });
  }
  try {
    await prisma.priceUpdateSession.delete({ where: { id } });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    if ((e as { code?: string })?.code !== "P2025") {
      return NextResponse.json({ error: "Could not delete price update." }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}
