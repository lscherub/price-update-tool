import { NextResponse } from "next/server";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { requireHelpReader } from "@/lib/helpAuth";
import { ensureHelpInitialized, searchHelpArticles } from "@/lib/helpServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireHelpReader();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";

  try {
    await ensureHelpInitialized(prisma, auth.session.email);
    const results = await searchHelpArticles(prisma, q, auth.isAdmin);
    return NextResponse.json({ results, canManage: auth.isAdmin }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  }
}
