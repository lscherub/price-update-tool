import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { cuid, loadFileStore, saveFileStore } from "@/lib/store";
import { normalizeVendor } from "@/lib/pricing";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").toLowerCase();
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (!prisma) {
    const store = loadFileStore();
    const rows = store.vendorDiscounts
      .filter((d) => !q || d.vendor.toLowerCase().includes(q))
      .sort((a, b) => a.vendor.localeCompare(b.vendor));
    return NextResponse.json({ rows });
  }
  try {
    const rows = await prisma.vendorDiscount.findMany({
      where: q ? { vendor: { contains: q, mode: "insensitive" } } : undefined,
      orderBy: { vendor: "asc" }, take: 5000,
    });
    return NextResponse.json({
      rows: rows.map((r) => ({ id: r.id, vendor: r.vendor, defaultDiscount: String(r.defaultDiscount) })),
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load vendor discounts." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const vendor = String(body.vendor ?? "").trim();
  const discountRaw = String(body.defaultDiscount ?? "0").trim().replace(/[%$,]/g, "");
  if (!vendor) return NextResponse.json({ error: "Vendor name is required" }, { status: 400 });
  if (vendor.length > 200) return NextResponse.json({ error: "Vendor name is too long (max 200 characters)" }, { status: 400 });
  let discount: Decimal;
  try {
    discount = new Decimal(discountRaw || "0");
  } catch {
    return NextResponse.json({ error: "Discount must be a number (e.g. 10 for 10%)" }, { status: 400 });
  }
  if (!discount.isFinite() || discount.lt(0) || discount.gt(100)) {
    return NextResponse.json({ error: "Discount must be between 0 and 100" }, { status: 400 });
  }
  const nv = normalizeVendor(vendor);
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (!prisma) {
    const store = loadFileStore();
    const ex = store.vendorDiscounts.find((d) => d.normalizedVendor === nv);
    if (ex) { ex.vendor = vendor; ex.defaultDiscount = discount.toFixed(2); }
    else store.vendorDiscounts.push({ id: cuid(), vendor, normalizedVendor: nv, defaultDiscount: discount.toFixed(2) });
    saveFileStore(store);
    return NextResponse.json({ ok: true });
  }
  try {
    await prisma.vendorDiscount.upsert({
      where: { normalizedVendor: nv },
      update: { vendor, defaultDiscount: discount },
      create: { vendor, normalizedVendor: nv, defaultDiscount: discount },
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not save vendor discount." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Vendor id is required" }, { status: 400 });
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (!prisma) {
    const store = loadFileStore();
    store.vendorDiscounts = store.vendorDiscounts.filter((d) => d.id !== id);
    saveFileStore(store);
    return NextResponse.json({ ok: true });
  }
  try {
    await prisma.vendorDiscount.delete({ where: { id } });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    // Deleting a missing id is idempotent — still report success.
    if ((e as { code?: string })?.code !== "P2025") {
      return NextResponse.json({ error: "Could not delete vendor discount." }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}
