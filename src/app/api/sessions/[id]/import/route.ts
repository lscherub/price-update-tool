import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { getSession } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { computeRowsForImport } from "@/lib/lookup";
import { cuid, loadFileStore, saveFileStore } from "@/lib/store";
import { parsePastedVendorData, parseVendorFile } from "@/lib/importers";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const ct = req.headers.get("content-type") ?? "";
  let raws: { raw: string; price: string | null }[] = [];
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    raws = parseVendorFile(buf, file.name, String(form.get("skuCol") ?? ""), String(form.get("priceCol") ?? "")).rows;
  } else {
    const body = await req.json().catch(() => ({}));
    if (Array.isArray(body.rows)) {
      raws = body.rows
        .map((r: { raw?: string; price?: string | null }) => ({
          raw: String(r.raw ?? "").trim(),
          price: r.price === null || r.price === undefined || String(r.price).trim() === "" ? null : String(r.price).trim(),
        }))
        .filter((r: { raw: string }) => r.raw !== "");
    } else if (body.text) {
      raws = parsePastedVendorData(String(body.text));
    }
  }
  if (!raws.length) return NextResponse.json({ error: "No rows" }, { status: 400 });
  if (raws.length > 20000) return NextResponse.json({ error: "Too many rows (max 20000)" }, { status: 400 });

  const computed = await computeRowsForImport(raws);
  const matched = computed.filter((c) => c.calc.matched).length;
  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    const now = new Date().toISOString();
    for (const c of computed) {
      store.items.push({
        id: cuid(), sessionId: id, rawVendorSku: c.raw, cleanedSku: c.calc.cleanedSku,
        cleanedOverridden: false, productId: c.productId, productNumber: c.calc.productNumber,
        productName: c.calc.productName, brand: c.calc.brand, vendor: c.calc.vendor,
        discount: c.calc.discount, currentListPrice: c.calc.currentListPrice,
        vendorListPriceNew: c.price, ourNewListPrice: c.calc.ourNewListPrice,
        marginDivisor: c.calc.marginDivisor, ourNewRetailPrice: c.calc.ourNewRetailPrice,
        oldRetailPrice: c.calc.oldRetailPrice, nearest9: c.calc.nearest9, notes: "",
        isInactive: c.calc.isInactive, matched: c.calc.matched, updatedAt: now,
      });
    }
    const s = store.sessions.find((x) => x.id === id);
    if (s) { s.status = "Ready"; s.updatedAt = now; }
    saveFileStore(store);
    return NextResponse.json({ ok: true, imported: computed.length, matched, unmatched: computed.length - matched });
  }
  const data = computed.map((c) => ({
    sessionId: id, rawVendorSku: c.raw, cleanedSku: c.calc.cleanedSku,
    productId: c.productId, productNumber: c.calc.productNumber, productName: c.calc.productName,
    brand: c.calc.brand, vendor: c.calc.vendor, discount: new Decimal(c.calc.discount),
    currentListPrice: c.calc.currentListPrice ? new Decimal(c.calc.currentListPrice) : null,
    vendorListPriceNew: c.price ? new Decimal(c.price) : null,
    ourNewListPrice: c.calc.ourNewListPrice ? new Decimal(c.calc.ourNewListPrice) : null,
    marginDivisor: new Decimal(c.calc.marginDivisor),
    ourNewRetailPrice: c.calc.ourNewRetailPrice ? new Decimal(c.calc.ourNewRetailPrice) : null,
    oldRetailPrice: c.calc.oldRetailPrice ? new Decimal(c.calc.oldRetailPrice) : null,
    nearest9: c.calc.nearest9 ? new Decimal(c.calc.nearest9) : null,
    matched: c.calc.matched, isInactive: c.calc.isInactive,
  }));
  for (let i = 0; i < data.length; i += 1000) {
    await prisma.priceUpdateItem.createMany({ data: data.slice(i, i + 1000) });
  }
  await prisma.priceUpdateSession.update({ where: { id }, data: { status: "Ready" } });
  return NextResponse.json({ ok: true, imported: computed.length, matched, unmatched: computed.length - matched });
}
