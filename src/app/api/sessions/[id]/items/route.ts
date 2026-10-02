import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { getSession } from "@/lib/auth";
import { getPrisma, dbUnreachableResponse, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { recalcRow } from "@/lib/recalc";
import { loadFileStore, saveFileStore } from "@/lib/store";

export const runtime = "nodejs";

const EDITABLE = new Set(["rawVendorSku", "cleanedSku", "discount", "vendorListPriceNew", "marginDivisor", "notes"]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const updates = (Array.isArray(body.items) ? body.items : [body]).slice(0, 1000);
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  for (const u of updates) {
    for (const k of Object.keys(u as Record<string, unknown>)) {
      if (k !== "id" && !EDITABLE.has(k)) return NextResponse.json({ error: `Field "${k}" is not editable` }, { status: 400 });
    }
    const d = (u as Record<string, unknown>).discount;
    if (d !== undefined && String(d ?? "").trim() !== "") {
      let dec: Decimal;
      try { dec = new Decimal(String(d).trim().replace(/[%$,]/g, "")); } catch { return NextResponse.json({ error: "Discount must be 0-100" }, { status: 400 }); }
      if (!dec.isFinite() || dec.lt(0) || dec.gt(100)) return NextResponse.json({ error: "Discount must be 0-100" }, { status: 400 });
    }
  }
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
  try {
    const ids = updates.map((u: Record<string, unknown>) => String(u.id ?? ""));
    const curs = await prisma.priceUpdateItem.findMany({ where: { id: { in: ids }, sessionId: id } });
    const byId = new Map(curs.map((c) => [c.id, c]));
    const writes: { id: string; data: object }[] = [];
    for (const u of updates) {
      const cur = byId.get(String((u as Record<string, unknown>).id ?? ""));
      if (!cur) continue;
      const r = await recalcRow({
        rawVendorSku: cur.rawVendorSku, cleanedSku: cur.cleanedSku,
        cleanedOverridden: cur.cleanedOverridden, discount: String(cur.discount ?? "0"),
        vendorListPriceNew: cur.vendorListPriceNew ? String(cur.vendorListPriceNew) : null,
        marginDivisor: String(cur.marginDivisor ?? "0.605"), notes: cur.notes,
      }, u as Record<string, unknown>);
      writes.push({ id: cur.id, data: {
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
      } });
      out.push({ id: cur.id });
    }
    for (let j = 0; j < writes.length; j += 50) {
      await prisma.$transaction(writes.slice(j, j + 50).map((w) => prisma.priceUpdateItem.update({ where: { id: w.id }, data: w.data as never })));
    }
    return NextResponse.json({ ok: true, items: out });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not save changes. Please try again." }, { status: 500 });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const itemId = searchParams.get("itemId") ?? "";
  const body = itemId ? null : await req.json().catch(() => null);
  const itemIds = Array.isArray((body as { itemIds?: unknown } | null)?.itemIds)
    ? [...new Set((body as { itemIds: unknown[] }).itemIds.map((v) => String(v ?? "")).filter(Boolean))].slice(0, 5000)
    : null;
  const clear = searchParams.get("clear") === "1";
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (!prisma) {
    const store = loadFileStore();
    if (clear) {
      store.items = store.items.filter((i) => i.sessionId !== id);
    } else if (itemIds) {
      if (!itemIds.length) return NextResponse.json({ error: "itemIds is required" }, { status: 400 });
      const del = new Set(itemIds);
      store.items = store.items.filter((i) => !(i.sessionId === id && del.has(i.id)));
    } else {
      store.items = store.items.filter((i) => !(i.sessionId === id && i.id === itemId));
    }
    saveFileStore(store);
    return NextResponse.json({ ok: true });
  }
  try {
    if (clear) await prisma.priceUpdateItem.deleteMany({ where: { sessionId: id } });
    else if (itemIds) {
      if (!itemIds.length) return NextResponse.json({ error: "itemIds is required" }, { status: 400 });
      await prisma.priceUpdateItem.deleteMany({ where: { id: { in: itemIds }, sessionId: id } });
    } else {
      if (!itemId) return NextResponse.json({ error: "itemId is required" }, { status: 400 });
      await prisma.priceUpdateItem.deleteMany({ where: { id: itemId, sessionId: id } });
    }
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not delete row." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
