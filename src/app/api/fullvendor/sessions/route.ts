import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { getSession } from "@/lib/auth";
import { getPrisma, dbUnreachableResponse, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { cuid, loadFileStore, saveFileStore, type ItemRow } from "@/lib/store";
import { formatUpdateName } from "@/lib/pricing";
import { getDiscountMaps, resolveDefaultDiscount } from "@/lib/lookup";
import { calculateRow } from "@/lib/nearest9";
import { FULL_VENDOR_KIND, parseFullVendorPaste, planFullVendorRows, planSummaryMarkdown } from "@/lib/fullVendor";
import { loadVendorProducts } from "@/lib/fullVendorServer";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/fullvendor/sessions   body: { vendor, pastedData }
 *
 * Creates a Full Vendor Price Update: a regular PriceUpdateSession (so the
 * existing worksheet, editing, recalculation, filters and sorting all apply)
 * holding exactly one row per inventory product of the vendor. It is tagged by
 * an ExportLog entry (kind "fullvendor-created"), which needs no schema change
 * and is removed with the session (ON DELETE CASCADE).
 *
 * Inventory is only READ — no Product row is created or modified here.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const vendor = String(body.vendor ?? "").trim().slice(0, 200);
  const pastedData = String(body.pastedData ?? "");
  if (!vendor) return NextResponse.json({ error: "Select a vendor first." }, { status: 400 });
  if (!pastedData.trim()) return NextResponse.json({ error: "Paste the vendor SKU and price columns first." }, { status: 400 });

  const pasted = parseFullVendorPaste(pastedData);
  if (!pasted.length) return NextResponse.json({ error: "No vendor rows found in the pasted data. Paste two columns: Raw Vendor SKU/Code and Vendor List Price (New)." }, { status: 400 });
  if (pasted.length > 20000) return NextResponse.json({ error: "Too many pasted rows (max 20000)." }, { status: 400 });

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  let products;
  let discMaps;
  try {
    [products, discMaps] = await Promise.all([loadVendorProducts(prisma, vendor), getDiscountMaps()]);
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load the vendor's inventory." }, { status: 500 });
  }
  if (!products.length) {
    return NextResponse.json({ error: `No inventory products found for vendor "${vendor}".` }, { status: 404 });
  }

  const plan = planFullVendorRows(products, pasted);

  // Pricing: the unchanged calculateRow pipeline with the Vendor/Brand default
  // discount. A row without a vendor price yields null prices (no fabrication).
  type NewItem = Omit<ItemRow, "id" | "sessionId" | "updatedAt">;
  const items: NewItem[] = plan.rows.map((r) => {
    const p = r.product;
    const calc = calculateRow({
      rawVendorSku: r.rawVendorSku,
      cleanedSku: r.cleanedSku,
      cleanedOverridden: true, // keep the planned cleaned SKU verbatim
      vendorListPriceNew: r.vendorListPriceNew,
      product: {
        productNumber: p.productNumber, description: p.description, brand: p.brand,
        vendor: p.vendor, listCost: p.listCost, price: p.price, isInactive: p.isInactive,
      },
      defaultDiscount: resolveDefaultDiscount(discMaps, p.vendor, p.brand),
    });
    return {
      rawVendorSku: r.rawVendorSku, cleanedSku: r.cleanedSku, cleanedOverridden: r.cleanedOverridden,
      productId: p.id, productNumber: calc.productNumber, productName: calc.productName,
      brand: calc.brand, vendor: calc.vendor, discount: calc.discount,
      currentListPrice: calc.currentListPrice, vendorListPriceNew: r.vendorListPriceNew,
      ourNewListPrice: calc.ourNewListPrice, marginDivisor: calc.marginDivisor,
      ourNewRetailPrice: calc.ourNewRetailPrice, oldRetailPrice: calc.oldRetailPrice,
      nearest9: calc.nearest9, nearest9Custom: null, notes: r.note,
      isInactive: p.isInactive, matched: true,
    };
  });

  const name = formatUpdateName(vendor);
  const notes = planSummaryMarkdown(vendor, plan);
  const summary = {
    total: plan.counts.total, priced: plan.counts.priced, missing: plan.counts.missing,
    ambiguous: plan.counts.ambiguous, conflict: plan.counts.conflict, noPrice: plan.counts.noPrice,
    inactive: plan.counts.inactive, unmatchedPasted: plan.unmatchedPasted.length, pastedRows: pasted.length,
  };

  if (!prisma) {
    const store = loadFileStore();
    const now = new Date().toISOString();
    const sid = cuid();
    store.sessions.push({ id: sid, vendor, name, status: "Ready", notes, createdBy: session.email, createdAt: now, updatedAt: now });
    for (const it of items) store.items.push({ id: cuid(), sessionId: sid, ...it, updatedAt: now });
    store.exports.push({ id: cuid(), sessionId: sid, kind: FULL_VENDOR_KIND, createdBy: session.email, createdAt: now, detail: JSON.stringify(summary) });
    saveFileStore(store);
    return NextResponse.json({ ok: true, sessionId: sid, ...summary });
  }

  const dec = (v: string | null) => (v ? new Decimal(v) : null);
  let sid = "";
  try {
    const s = await prisma.priceUpdateSession.create({
      data: { vendor, name, notes, status: "Draft", createdBy: session.email },
    });
    sid = s.id;
    await prisma.exportLog.create({ data: { sessionId: sid, kind: FULL_VENDOR_KIND, createdBy: session.email, detail: JSON.stringify(summary) } });
    const data = items.map((it) => ({
      sessionId: sid, rawVendorSku: it.rawVendorSku, cleanedSku: it.cleanedSku, cleanedOverridden: it.cleanedOverridden,
      productId: it.productId, productNumber: it.productNumber, productName: it.productName,
      brand: it.brand, vendor: it.vendor, discount: new Decimal(it.discount),
      currentListPrice: dec(it.currentListPrice), vendorListPriceNew: dec(it.vendorListPriceNew),
      ourNewListPrice: dec(it.ourNewListPrice), marginDivisor: new Decimal(it.marginDivisor),
      ourNewRetailPrice: dec(it.ourNewRetailPrice), oldRetailPrice: dec(it.oldRetailPrice),
      nearest9: dec(it.nearest9), nearest9Custom: null, notes: it.notes,
      isInactive: it.isInactive, matched: it.matched,
    }));
    for (let i = 0; i < data.length; i += 1000) {
      await prisma.priceUpdateItem.createMany({ data: data.slice(i, i + 1000) });
    }
    await prisma.priceUpdateSession.update({ where: { id: sid }, data: { status: "Ready" } });
    return NextResponse.json({ ok: true, sessionId: sid, ...summary });
  } catch (e) {
    // Never leave a half-built sheet behind: remove the session (cascades items + marker).
    if (sid) await prisma.priceUpdateSession.delete({ where: { id: sid } }).catch(() => null);
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not create the Full Vendor Price Update. Nothing was saved." }, { status: 500 });
  }
}
