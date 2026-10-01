import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { getSession } from "@/lib/auth";
import { getPrisma, dbUnreachableResponse, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { computeRowsForImport } from "@/lib/lookup";
import { cuid, loadFileStore, saveFileStore } from "@/lib/store";
import { parsePastedVendorData, parseVendorFile } from "@/lib/importers";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_BYTES = 8 * 1024 * 1024;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const ct = req.headers.get("content-type") ?? "";
  let raws: { raw: string; price: string | null }[] = [];
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file selected. Choose an Excel or CSV file to upload." }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "File is too large (max 8 MB). Split the file and try again." }, { status: 413 });
    const buf = Buffer.from(await file.arrayBuffer());
    if (!buf.length) return NextResponse.json({ error: "The uploaded file is empty." }, { status: 400 });
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
  if (!raws.length) return NextResponse.json({ error: "No vendor rows found. Upload a file with SKU + price columns, or paste 'SKU price' lines." }, { status: 400 });
  if (raws.length > 20000) return NextResponse.json({ error: "Too many rows (max 20000). Split the file and try again." }, { status: 400 });

  // Fail closed before any data access: in production a missing DATABASE_URL
  // must be a 503, never a match against the local JSON fallback.
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  let computed;
  try {
    computed = await computeRowsForImport(raws);
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Price matching failed. Check the database connection and try again." }, { status: 500 });
  }
  const matched = computed.filter((c) => c.calc.matched).length;
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
  try {
    for (let i = 0; i < data.length; i += 1000) {
      await prisma.priceUpdateItem.createMany({ data: data.slice(i, i + 1000) });
    }
    await prisma.priceUpdateSession.update({ where: { id }, data: { status: "Ready" } });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    if ((e as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "Price update not found" }, { status: 404 });
    }
    if ((e as { code?: string })?.code === "P2021" || /does not exist in the current database/i.test(String((e as { message?: string })?.message ?? ""))) {
      return NextResponse.json(
        { error: "Database tables are missing. Run database migrations (prisma migrate deploy) and try again." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Could not save the imported rows." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, imported: computed.length, matched, unmatched: computed.length - matched });
}
