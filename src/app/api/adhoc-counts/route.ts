import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { listAdHocSheets, createAdHocSheet } from "@/lib/adhocCountServer";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? searchParams.get("q") ?? "";
  const status = searchParams.get("status") ?? "all";

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const sheets = await listAdHocSheets({ search, status });
    return NextResponse.json({ sheets });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    console.error("Failed to list count sheets:", e);
    return NextResponse.json({ error: "Could not load count sheets." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // Body optional, fallback to default name
  }

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const sheet = await createAdHocSheet({ name: body?.name });
    return NextResponse.json({ sheet }, { status: 201 });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    console.error("Failed to create count sheet:", e);
    return NextResponse.json({ error: "Could not create count sheet." }, { status: 500 });
  }
}
