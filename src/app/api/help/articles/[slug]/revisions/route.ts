import { NextResponse } from "next/server";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { requireHelpAdmin } from "@/lib/helpAuth";
import { getHelpArticleBySlug, restoreHelpArticleRevision } from "@/lib/helpServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const auth = await requireHelpAdmin();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const { slug } = await ctx.params;
  try {
    const data = await getHelpArticleBySlug(prisma, slug, true);
    if (!data) return NextResponse.json({ error: "Article not found." }, { status: 404 });
    return NextResponse.json({ revisions: data.revisions ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load revision history." }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const auth = await requireHelpAdmin();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const revisionId = String(body.revisionId ?? "").trim();
  if (!revisionId) return NextResponse.json({ error: "revisionId is required." }, { status: 400 });

  try {
    const res = await restoreHelpArticleRevision(prisma, slug, revisionId, auth.session.email);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ ok: true, article: res.article });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not restore revision." }, { status: 500 });
  }
}
