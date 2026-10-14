import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { loadFileStore } from "@/lib/store";

export const runtime = "nodejs";

/**
 * Discount data for the Vendor Pricing Calculator.
 * Returns vendor defaults + brand-specific overrides so the calculator
 * resolves discounts with the same brand-first rule as the worksheet.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (!prisma) {
    const store = loadFileStore();
    return NextResponse.json({
      vendors: store.vendorDiscounts.map((d) => ({ vendor: d.vendor, discount: d.defaultDiscount })),
      brands: (store.brandDiscounts ?? []).map((d) => ({
        vendor: d.vendor,
        brand: d.brand,
        discount: d.defaultDiscount,
      })),
    });
  }
  try {
    const [vendorRows, brandRows] = await Promise.all([
      prisma.vendorDiscount.findMany({ orderBy: { vendor: "asc" }, take: 10000 }),
      (async () => {
        try {
          return await (prisma as unknown as {
            brandDiscount: { findMany: (a: unknown) => Promise<{ vendor: string; brand: string; defaultDiscount: unknown }[]> };
          }).brandDiscount.findMany({ orderBy: [{ vendor: "asc" }, { brand: "asc" }], take: 10000 });
        } catch {
          return [] as { vendor: string; brand: string; defaultDiscount: unknown }[];
        }
      })(),
    ]);
    return NextResponse.json({
      vendors: vendorRows.map((r) => ({ vendor: r.vendor, discount: String(r.defaultDiscount) })),
      brands: brandRows.map((r) => ({ vendor: r.vendor, brand: r.brand, discount: String(r.defaultDiscount) })),
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load discount data." }, { status: 500 });
  }
}
