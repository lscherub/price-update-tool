import { NextResponse } from "next/server";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { requireHelpAdmin } from "@/lib/helpAuth";
import { createHelpArticle, reorderHelpArticles } from "@/lib/helpServer";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireHelpAdmin();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const body = await req.json().catch(() => ({}));
  try {
    const res = await createHelpArticle(prisma, {
      categoryId: String(body.categoryId ?? ""),
      title: String(body.title ?? ""),
      summary: typeof body.summary === "string" ? body.summary : "",
      blocks: Array.isArray(body.blocks) ? body.blocks : undefined,
      relatedSlugs: Array.isArray(body.relatedSlugs) ? body.relatedSlugs : [],
      contextKeys: Array.isArray(body.contextKeys) ? body.contextKeys : [],
      publish: Boolean(body.publish),
      editorEmail: auth.session.email,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ ok: true, article: res.article }, { status: 201 });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not create article." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const auth = await requireHelpAdmin();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const body = await req.json().catch(() => ({}));
  const categoryId = String(body.categoryId ?? "").trim();
  const orderedIds = Array.isArray(body.orderedIds)
    ? body.orderedIds.map((v: unknown) => String(v ?? "")).filter(Boolean)
    : [];
  if (!categoryId || !orderedIds.length) {
    return NextResponse.json({ error: "categoryId and orderedIds are required." }, { status: 400 });
  }

  try {
    await reorderHelpArticles(prisma, categoryId, orderedIds);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not reorder articles." }, { status: 500 });
  }
}
