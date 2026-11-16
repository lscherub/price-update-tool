import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { getAdHocSheet, updateAdHocSheet, deleteAdHocSheet } from "@/lib/adhocCountServer";
import type { AdHocSheetStatus } from "@/lib/adhocCount";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const sheet = await getAdHocSheet(id);
    if (!sheet) {
      return NextResponse.json({ error: "Count sheet not found" }, { status: 404 });
    }
    return NextResponse.json({ sheet });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    console.error("Failed to get count sheet:", e);
    return NextResponse.json({ error: "Could not load count sheet." }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const updates: { name?: string; status?: AdHocSheetStatus } = {};
    if (body.name !== undefined) updates.name = String(body.name);
    if (body.status !== undefined) updates.status = body.status as AdHocSheetStatus;

    const sheet = await updateAdHocSheet(id, updates);
    if (!sheet) {
      return NextResponse.json({ error: "Count sheet not found" }, { status: 404 });
    }
    return NextResponse.json({ sheet });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    console.error("Failed to update count sheet:", e);
    return NextResponse.json({ error: "Could not update count sheet." }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const deleted = await deleteAdHocSheet(id);
    if (!deleted) {
      return NextResponse.json({ error: "Count sheet not found or already deleted" }, { status: 404 });
    }
    return NextResponse.json({ success: true, id });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    console.error("Failed to delete count sheet:", e);
    return NextResponse.json({ error: "Could not delete count sheet." }, { status: 500 });
  }
}
