import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPrisma, dbUnreachableResponse, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { loadVendorProducts } from "@/lib/fullVendorServer";

export const runtime = "nodejs";

/**
 * GET /api/vendors/products?vendor=<name>
 *
 * Read-only list of every inventory product (Active and Inactive) for one
 * vendor. Used by the Full Vendor Price Update preview step.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const vendor = (new URL(req.url).searchParams.get("vendor") ?? "").trim().slice(0, 200);
  if (!vendor) return NextResponse.json({ error: "Select a vendor first." }, { status: 400 });

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  try {
    const rows = await loadVendorProducts(prisma, vendor);
    return NextResponse.json({
      vendor,
      total: rows.length,
      inactive: rows.filter((r) => r.isInactive).length,
      rows,
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load vendor products." }, { status: 500 });
  }
}
