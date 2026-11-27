import { NextResponse } from "next/server";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { requireHelpAdmin } from "@/lib/helpAuth";
import {
  createHelpCategory,
  deleteHelpCategory,
  reorderHelpCategories,
  updateHelpCategory,
} from "@/lib/helpServer";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireHelpAdmin();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const body = await req.json().catch(() => ({}));
  try {
    const res = await createHelpCategory(prisma, {
      name: body.name,
      description: body.description,
      icon: body.icon,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ ok: true, category: res.category }, { status: 201 });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not create category." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const auth = await requireHelpAdmin();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const body = await req.json().catch(() => ({}));
  try {
    if (Array.isArray(body.orderedIds)) {
      const ids = body.orderedIds.map((v: unknown) => String(v ?? "")).filter(Boolean);
      await reorderHelpCategories(prisma, ids);
      return NextResponse.json({ ok: true });
    }
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "Category id is required." }, { status: 400 });
    const res = await updateHelpCategory(prisma, id, {
      name: body.name,
      description: body.description,
      icon: body.icon,
      sortOrder: body.sortOrder,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ ok: true, category: res.category });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not update category." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireHelpAdmin();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id")?.trim() ?? "";
  if (!id) return NextResponse.json({ error: "Category id is required." }, { status: 400 });

  try {
    const res = await deleteHelpCategory(prisma, id);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not delete category." }, { status: 500 });
  }
}
