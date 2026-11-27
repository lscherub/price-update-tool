import { NextResponse } from "next/server";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { requireHelpReader } from "@/lib/helpAuth";
import { ensureHelpInitialized, getHelpStatusSummary, listHelpLibrary } from "@/lib/helpServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireHelpReader();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    await ensureHelpInitialized(prisma, auth.session.email);
    const { categories, articles } = await listHelpLibrary(prisma, auth.isAdmin);
    return NextResponse.json(
      {
        categories,
        articles,
        canManage: auth.isAdmin,
        summary: auth.isAdmin ? getHelpStatusSummary(articles) : undefined,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load Help Centre documentation." }, { status: 500 });
  }
}
