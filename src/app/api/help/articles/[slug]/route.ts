import { NextResponse } from "next/server";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { requireHelpAdmin, requireHelpReader } from "@/lib/helpAuth";
import {
  deleteHelpArticle,
  ensureHelpInitialized,
  getHelpArticleBySlug,
  updateHelpArticle,
  type UpdateArticleAction,
} from "@/lib/helpServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const auth = await requireHelpReader();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const { slug } = await ctx.params;
  try {
    await ensureHelpInitialized(prisma, auth.session.email);
    const data = await getHelpArticleBySlug(prisma, slug, auth.isAdmin);
    if (!data) {
      return NextResponse.json({ error: "Article not found." }, { status: 404 });
    }
    return NextResponse.json(
      { ...data, canManage: auth.isAdmin },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load article." }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const auth = await requireHelpAdmin();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const rawAction = String(body.action ?? "save-draft");
  const action: UpdateArticleAction =
    rawAction === "publish" || rawAction === "unpublish" || rawAction === "discard-draft"
      ? rawAction
      : "save-draft";

  try {
    const res = await updateHelpArticle(prisma, slug, {
      action,
      categoryId: typeof body.categoryId === "string" ? body.categoryId : undefined,
      title: typeof body.title === "string" ? body.title : undefined,
      summary: typeof body.summary === "string" ? body.summary : undefined,
      blocks: Array.isArray(body.blocks) ? body.blocks : undefined,
      relatedSlugs: Array.isArray(body.relatedSlugs) ? body.relatedSlugs : undefined,
      contextKeys: Array.isArray(body.contextKeys) ? body.contextKeys : undefined,
      needsReview: typeof body.needsReview === "boolean" ? body.needsReview : undefined,
      revisionNote: typeof body.revisionNote === "string" ? body.revisionNote : undefined,
      editorEmail: auth.session.email,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ ok: true, article: res.article });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not save article changes." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const auth = await requireHelpAdmin();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const { slug } = await ctx.params;
  try {
    const deleted = await deleteHelpArticle(prisma, slug);
    if (!deleted) return NextResponse.json({ error: "Article not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not delete article." }, { status: 500 });
  }
}
