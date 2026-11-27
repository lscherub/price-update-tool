import { NextResponse } from "next/server";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { requireHelpReader } from "@/lib/helpAuth";
import { ensureHelpInitialized, getContextualHelpArticles } from "@/lib/helpServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const auth = await requireHelpReader();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const { key } = await ctx.params;
  try {
    await ensureHelpInitialized(prisma, auth.session.email);
    const articles = await getContextualHelpArticles(prisma, key, auth.isAdmin);
    return NextResponse.json({ articles, canManage: auth.isAdmin }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load contextual help." }, { status: 500 });
  }
}
