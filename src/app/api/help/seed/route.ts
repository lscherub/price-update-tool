import { NextResponse } from "next/server";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { requireHelpAdmin } from "@/lib/helpAuth";
import { seedInitialHelpDrafts } from "@/lib/helpServer";

export const runtime = "nodejs";

/**
 * POST /api/help/seed
 * Admin-only endpoint to idempotently add any missing initial AI-generated draft articles.
 * Never overwrites existing articles or auto-publishes drafts.
 */
export async function POST() {
  const auth = await requireHelpAdmin();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const result = await seedInitialHelpDrafts(prisma, auth.session.email);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not seed initial documentation drafts." }, { status: 500 });
  }
}
