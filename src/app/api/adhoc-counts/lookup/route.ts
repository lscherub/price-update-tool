import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { lookupSkusForAdHoc } from "@/lib/adhocCountServer";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const skus: string[] = Array.isArray(body?.skus)
    ? body.skus
    : typeof body?.sku === "string"
    ? [body.sku]
    : [];

  const sheetId = typeof body?.sheetId === "string" ? body.sheetId : undefined;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const results = await lookupSkusForAdHoc(skus, sheetId);
    return NextResponse.json({ items: results });
  } catch (e: any) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    console.error("Failed to lookup SKUs:", e);
    return NextResponse.json({ error: e?.message || "Failed to lookup products." }, { status: 500 });
  }
}
