import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { getSession } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { cuid, loadFileStore, saveFileStore } from "@/lib/store";
import { normalizeVendor } from "@/lib/pricing";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").toLowerCase();
  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    const rows = store.vendorDiscounts
      .filter((d) => !q || d.vendor.toLowerCase().includes(q))
      .sort((a, b) => a.vendor.localeCompare(b.vendor));
    return NextResponse.json({ rows });
  }
  const rows = await prisma.vendorDiscount.findMany({
    where: q ? { vendor: { contains: q, mode: "insensitive" } } : undefined,
    orderBy: { vendor: "asc" }, take: 5000,
  });
  return NextResponse.json({
    rows: rows.map((r) => ({ id: r.id, vendor: r.vendor, defaultDiscount: String(r.defaultDiscount) })),
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const vendor = String(body.vendor ?? "").trim();
  const discount = String(body.defaultDiscount ?? "0");
  if (!vendor) return NextResponse.json({ error: "Vendor required" }, { status: 400 });
  const nv = normalizeVendor(vendor);
  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    const ex = store.vendorDiscounts.find((d) => d.normalizedVendor === nv);
    if (ex) { ex.vendor = vendor; ex.defaultDiscount = new Decimal(discount || "0").toFixed(2); }
    else store.vendorDiscounts.push({ id: cuid(), vendor, normalizedVendor: nv, defaultDiscount: new Decimal(discount || "0").toFixed(2) });
    saveFileStore(store);
    return NextResponse.json({ ok: true });
  }
  await prisma.vendorDiscount.upsert({
    where: { normalizedVendor: nv },
    update: { vendor, defaultDiscount: new Decimal(discount || "0") },
    create: { vendor, normalizedVendor: nv, defaultDiscount: new Decimal(discount || "0") },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? "";
  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    store.vendorDiscounts = store.vendorDiscounts.filter((d) => d.id !== id);
    saveFileStore(store);
    return NextResponse.json({ ok: true });
  }
  await prisma.vendorDiscount.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
