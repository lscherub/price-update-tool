import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { getDiscountMaps, resolveDefaultDiscount } from "@/lib/lookup";
import { calculateRow } from "@/lib/nearest9";
import { normalizeBrand, normalizeVendor } from "@/lib/pricing";

export const runtime = "nodejs";

type CalcRow = {
  vendor: string;
  brand: string;
  listCost: string;
  divisor?: string;
  discountOverride?: string;
};

/**
 * Server-side bulk pricing: applies DB discount rules to many rows.
 * POST { rows: [{vendor, brand, listCost, divisor?, discountOverride?}, ...] }
 * Returns per-row discount, source, net cost, exact + nearest-9 retail.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const rows = Array.isArray((body as { rows?: unknown }).rows)
    ? ((body as { rows: unknown[] }).rows as CalcRow[]).slice(0, 5000)
    : [];
  if (!rows.length) return NextResponse.json({ error: "No rows provided." }, { status: 400 });
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  void prisma;
  try {
    const maps = await getDiscountMaps();
    const out = rows.map((r, i) => {
      const vendor = String(r?.vendor ?? "").trim();
      const brand = String(r?.brand ?? "").trim();
      const listRaw = String(r?.listCost ?? "").trim().replace(/[$,]/g, "");
      const divisorRaw = String(r?.divisor ?? "").trim();
      const overrideRaw = String(r?.discountOverride ?? "").trim().replace(/[%$,]/g, "");
      let list: Decimal | null = null;
      try {
        const d = new Decimal(listRaw || "NaN");
        if (d.isFinite() && d.gte(0)) list = d;
      } catch {
        list = null;
      }
      const resolved = resolveDefaultDiscount(maps, vendor, brand);
      let discount = resolved;
      let source: "brand" | "vendor" | "none" | "manual" = "none";
      if (overrideRaw !== "") {
        try {
          const d = new Decimal(overrideRaw);
          if (d.isFinite() && d.gte(0) && d.lte(100)) {
            discount = d.toFixed(2);
            source = "manual";
          }
        } catch {
          /* fall through to resolved */
        }
      }
      if (source !== "manual") {
        const key = `${normalizeVendor(vendor)}|${normalizeBrand(brand)}`;
        if (normalizeVendor(vendor) && normalizeBrand(brand) && maps.brands.has(key)) source = "brand";
        else if (normalizeVendor(vendor) && maps.vendors.has(normalizeVendor(vendor))) source = "vendor";
        else source = "none";
      }
      if (list === null) {
        return { index: i, vendor, brand, error: "Invalid cost — must be a number of 0 or more." };
      }
      const calc = calculateRow({
        rawVendorSku: "",
        discount,
        vendorListPriceNew: list.toFixed(2),
        marginDivisor: divisorRaw || undefined,
        product: null,
        defaultDiscount: discount,
      });
      return {
        index: i,
        vendor,
        brand,
        listCost: list.toFixed(2),
        discount,
        discountSource: source,
        netCost: calc.ourNewListPrice,
        divisor: calc.marginDivisor,
        retailExact: calc.ourNewRetailPrice,
        retailRounded: calc.nearest9,
      };
    });
    return NextResponse.json({ rows: out });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not calculate bulk pricing." }, { status: 500 });
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, usage: "POST { rows: [...] } to calculate." });
}
