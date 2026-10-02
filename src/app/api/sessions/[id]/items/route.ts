import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { getSession } from "@/lib/auth";
import { getPrisma, dbUnreachableResponse, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { recalcRow, type CurRow } from "@/lib/recalc";
import { computeRowsForImport } from "@/lib/lookup";
import { DEFAULT_DIVISOR } from "@/lib/pricing";
import { cuid, loadFileStore, saveFileStore, type ItemRow } from "@/lib/store";

export const runtime = "nodejs";

const EDITABLE = new Set(["rawVendorSku", "cleanedSku", "discount", "vendorListPriceNew", "marginDivisor", "notes", "nearest9"]);

/** Reject a non-empty, non-numeric Nearest 9 override before touching any data. */
function badNearest9(v: unknown): boolean {
  if (v === undefined || v === null || String(v).trim() === "") return false;
  try {
    const d = new Decimal(String(v).trim().replace(/[%$,]/g, ""));
    return !d.isFinite();
  } catch {
    return true;
  }
}

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
    if (badNearest9((u as Record<string, unknown>).nearest9)) {
      return NextResponse.json({ error: "Nearest 9 must be a number" }, { status: 400 });
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
        nearest9Custom: cur.nearest9Custom ?? null,
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
        nearest9Custom: cur.nearest9Custom ? String(cur.nearest9Custom) : null,
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
        nearest9Custom: r.nearest9Custom ? new Decimal(r.nearest9Custom) : null,
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

/**
 * Add a row to an existing price update.
 *
 * The user identifies the product with EITHER a Raw Vendor SKU/Code OR a Cleaned
 * SKU — never forced to type both:
 *   * Raw Vendor SKU -> the exact import pipeline (SKU cleaning + inventory
 *     matching + default vendor discount), so the row behaves like an imported one.
 *   * Cleaned SKU -> the existing manual Cleaned SKU path (same lookup, same
 *     "Manual SKU" flag) as when a user edits that cell on an imported row.
 * Inventory is only ever READ here: no Product row is created or modified, and an
 * unknown SKU keeps the existing "Not Found" (matched = false) behaviour.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const rawVendorSku = String(body.rawVendorSku ?? "").trim();
  const cleanedSkuIn = String(body.cleanedSku ?? "").trim();
  if (!rawVendorSku && !cleanedSkuIn) {
    return NextResponse.json({ error: "Enter a Raw Vendor SKU/Code or a Cleaned SKU." }, { status: 400 });
  }
  const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
  const discountIn = str(body.discount);
  const priceIn = str(body.vendorListPriceNew);
  const marginIn = str(body.marginDivisor);
  const notes = String(body.notes ?? "");
  if (discountIn !== "") {
    let dec: Decimal;
    try { dec = new Decimal(discountIn.replace(/[%$,]/g, "")); } catch { return NextResponse.json({ error: "Discount must be 0-100" }, { status: 400 }); }
    if (!dec.isFinite() || dec.lt(0) || dec.gt(100)) return NextResponse.json({ error: "Discount must be 0-100" }, { status: 400 });
  }
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  type NewFields = Omit<ItemRow, "id" | "sessionId" | "updatedAt">;
  const seed: CurRow = {
    rawVendorSku: "", cleanedSku: "", cleanedOverridden: false, discount: "0.00",
    vendorListPriceNew: null, marginDivisor: DEFAULT_DIVISOR, notes: "", nearest9Custom: null,
  };
  let f: NewFields;
  try {
    if (cleanedSkuIn) {
      // Existing manual Cleaned SKU behaviour (a provided Cleaned SKU wins).
      f = await recalcRow(seed, {
        rawVendorSku, cleanedSku: cleanedSkuIn,
        discount: discountIn, vendorListPriceNew: priceIn || null,
        marginDivisor: marginIn, notes,
      });
    } else {
      // Raw-only: reuse the import pipeline so cleaning + matching are identical.
      const overrides = discountIn || marginIn
        ? new Map([[rawVendorSku, { discount: discountIn, margin: marginIn }]])
        : undefined;
      const [c] = await computeRowsForImport([{ raw: rawVendorSku, price: priceIn || null }], overrides);
      if (!c) return NextResponse.json({ error: "Enter a Raw Vendor SKU/Code or a Cleaned SKU." }, { status: 400 });
      f = {
        rawVendorSku: c.raw, cleanedSku: c.calc.cleanedSku, cleanedOverridden: false,
        productId: c.productId, productNumber: c.calc.productNumber, productName: c.calc.productName,
        brand: c.calc.brand, vendor: c.calc.vendor, discount: c.calc.discount,
        currentListPrice: c.calc.currentListPrice, vendorListPriceNew: c.price,
        ourNewListPrice: c.calc.ourNewListPrice, marginDivisor: c.calc.marginDivisor,
        ourNewRetailPrice: c.calc.ourNewRetailPrice, oldRetailPrice: c.calc.oldRetailPrice,
        nearest9: c.calc.nearest9, nearest9Custom: null, notes,
        isInactive: c.calc.isInactive, matched: c.calc.matched,
      };
    }
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not add the row. Please try again." }, { status: 500 });
  }

  if (!prisma) {
    const store = loadFileStore();
    if (!store.sessions.some((s) => s.id === id)) return NextResponse.json({ error: "Price update not found" }, { status: 404 });
    const row: ItemRow = { id: cuid(), sessionId: id, ...f, updatedAt: new Date().toISOString() };
    store.items.push(row);
    saveFileStore(store);
    return NextResponse.json({ ok: true, item: row });
  }
  try {
    const created = await prisma.priceUpdateItem.create({ data: {
      sessionId: id, rawVendorSku: f.rawVendorSku, cleanedSku: f.cleanedSku,
      cleanedOverridden: f.cleanedOverridden, productId: f.productId,
      productNumber: f.productNumber, productName: f.productName, brand: f.brand, vendor: f.vendor,
      discount: new Decimal(f.discount),
      currentListPrice: f.currentListPrice ? new Decimal(f.currentListPrice) : null,
      vendorListPriceNew: f.vendorListPriceNew ? new Decimal(f.vendorListPriceNew) : null,
      ourNewListPrice: f.ourNewListPrice ? new Decimal(f.ourNewListPrice) : null,
      marginDivisor: new Decimal(f.marginDivisor),
      ourNewRetailPrice: f.ourNewRetailPrice ? new Decimal(f.ourNewRetailPrice) : null,
      oldRetailPrice: f.oldRetailPrice ? new Decimal(f.oldRetailPrice) : null,
      nearest9: f.nearest9 ? new Decimal(f.nearest9) : null,
      nearest9Custom: f.nearest9Custom ? new Decimal(f.nearest9Custom) : null,
      notes: f.notes, isInactive: f.isInactive, matched: f.matched,
    } });
    return NextResponse.json({ ok: true, item: { id: created.id, sessionId: id } });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    if ((e as { code?: string })?.code === "P2003" || (e as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "Price update not found" }, { status: 404 });
    }
    if ((e as { code?: string })?.code === "P2021" || /does not exist in the current database/i.test(String((e as { message?: string })?.message ?? ""))) {
      return NextResponse.json(
        { error: "Database tables are missing. Run database migrations (prisma migrate deploy) and try again." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Could not add the row." }, { status: 500 });
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
