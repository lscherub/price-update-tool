import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { cuid, loadFileStore, saveFileStore } from "@/lib/store";
import { normalizeBrand, normalizeVendor } from "@/lib/pricing";

export const runtime = "nodejs";

function parseDiscount(raw: unknown): Decimal | null {
  try {
    const d = new Decimal(String(raw ?? "0").trim().replace(/[%$,]/g, "") || "0");
    if (!d.isFinite() || d.lt(0) || d.gt(100)) return null;
    return d;
  } catch {
    return null;
  }
}


type BrandRow = {
  id: string; brand: string; vendor: string; defaultDiscount: unknown;
};

/**
 * Brand-specific discounts: one row per (vendor, brand) pair.
 * GET returns the flat rows; the Vendor Discounts page groups them under
 * their vendor. POST upserts by (normalizedVendor, normalizedBrand) so the
 * same brand can link to multiple vendors as separate rows.
 * DELETE removes a single brand-override row by id (vendor defaults untouched).
 */
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
    const rows = (store.brandDiscounts ?? [])
      .filter((d) => !q || d.brand.toLowerCase().includes(q) || d.vendor.toLowerCase().includes(q))
      .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.brand.localeCompare(b.brand));
    return NextResponse.json({ rows });
  }
  try {
    const db = prisma as unknown as { brandDiscount: { findMany: (a: unknown) => Promise<BrandRow[]> } };
    const rows = await db.brandDiscount.findMany({
      where: searchParams.get("q")
        ? { OR: [{ brand: { contains: q, mode: "insensitive" } }, { vendor: { contains: q, mode: "insensitive" } }] }
        : undefined,
      orderBy: [{ vendor: "asc" }, { brand: "asc" }],
      take: 5000,
    });
    return NextResponse.json({
      rows: rows.map((r) => ({ id: r.id, brand: r.brand, vendor: r.vendor, defaultDiscount: String(r.defaultDiscount) })),
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    const msg = String((e as { message?: string })?.message ?? "");
    if ((e as { code?: string })?.code === "P2021" || /does not exist/i.test(msg)) {
      return NextResponse.json({ rows: [] });
    }
    return NextResponse.json({ error: "Could not load brand discounts." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const brand = String(body.brand ?? "").trim();
  const vendor = String(body.vendor ?? "").trim();
  const editId = String(body.id ?? "").trim();
  if (!brand) return NextResponse.json({ error: "Brand name is required" }, { status: 400 });
  if (!vendor) return NextResponse.json({ error: "Vendor is required (link the brand to a vendor)" }, { status: 400 });
  if (brand.length > 200) return NextResponse.json({ error: "Brand name is too long (max 200 characters)" }, { status: 400 });
  if (vendor.length > 200) return NextResponse.json({ error: "Vendor name is too long (max 200 characters)" }, { status: 400 });
  const discount = parseDiscount(body.defaultDiscount);
  if (!discount) return NextResponse.json({ error: "Discount must be between 0 and 100" }, { status: 400 });
  const nb = normalizeBrand(brand);
  const nv = normalizeVendor(vendor);
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (!prisma) {
    const store = loadFileStore();
    store.brandDiscounts = store.brandDiscounts ?? [];
    if (editId) {
      // Editing an existing row (possibly re-linking it to another vendor):
      // update that row by id instead of upserting, then drop any duplicate
      // the re-link created.
      const cur = store.brandDiscounts.find((d) => d.id === editId);
      if (!cur) return NextResponse.json({ error: "Brand discount not found" }, { status: 404 });
      cur.brand = brand; cur.normalizedBrand = nb; cur.vendor = vendor; cur.normalizedVendor = nv;
      cur.defaultDiscount = discount.toFixed(2);
      const seen = new Set<string>();
      store.brandDiscounts = store.brandDiscounts.filter((d) => {
        const k = `${d.normalizedVendor}|${d.normalizedBrand}`;
        if (d.id === cur.id) { seen.add(k); return true; }
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      saveFileStore(store);
      return NextResponse.json({ ok: true });
    }
    const ex = store.brandDiscounts.find((d) => d.normalizedVendor === nv && d.normalizedBrand === nb);
    if (ex) { ex.brand = brand; ex.vendor = vendor; ex.defaultDiscount = discount.toFixed(2); }
    else store.brandDiscounts.push({ id: cuid(), brand, normalizedBrand: nb, vendor, normalizedVendor: nv, defaultDiscount: discount.toFixed(2) });
    saveFileStore(store);
    return NextResponse.json({ ok: true });
  }
  try {
    const db = prisma as unknown as {
      brandDiscount: {
        upsert: (a: unknown) => Promise<unknown>;
        findFirst: (a: unknown) => Promise<{ id: string } | null>;
        update: (a: unknown) => Promise<unknown>;
        delete: (a: unknown) => Promise<unknown>;
      };
    };
    if (editId) {
      await db.brandDiscount.update({ where: { id: editId }, data: { brand, normalizedBrand: nb, vendor, normalizedVendor: nv, defaultDiscount: discount } });
      // A re-link may now duplicate another row on (vendor, brand): drop extras.
      const dupes = await db.brandDiscount.findFirst({
        where: { normalizedVendor: nv, normalizedBrand: nb, NOT: { id: editId } },
        select: { id: true },
      }) as unknown as { id: string } | null;
      if (dupes) await db.brandDiscount.delete({ where: { id: dupes.id } });
      return NextResponse.json({ ok: true });
    }
    await db.brandDiscount.upsert({
      where: { normalizedVendor_normalizedBrand: { normalizedVendor: nv, normalizedBrand: nb } },
      update: { brand, vendor, defaultDiscount: discount },
      create: { brand, normalizedBrand: nb, vendor, normalizedVendor: nv, defaultDiscount: discount },
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    const msg = String((e as { message?: string })?.message ?? "");
    if ((e as { code?: string })?.code === "P2021" || /does not exist in the current database/i.test(msg)) {
      return NextResponse.json(
        { error: "Database tables are missing. Run database migrations (prisma migrate deploy) and try again." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Could not save brand discount." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Brand discount id is required" }, { status: 400 });
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (!prisma) {
    const store = loadFileStore();
    store.brandDiscounts = (store.brandDiscounts ?? []).filter((d) => d.id !== id);
    saveFileStore(store);
    return NextResponse.json({ ok: true });
  }
  try {
    const db = prisma as unknown as { brandDiscount: { delete: (a: unknown) => Promise<unknown> } };
    await db.brandDiscount.delete({ where: { id } });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    if ((e as { code?: string })?.code !== "P2025") {
      return NextResponse.json({ error: "Could not delete brand discount." }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}
