import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { addAdHocItems, syncAdHocItems, deleteAdHocItems } from "@/lib/adhocCountServer";

export const runtime = "nodejs";

export async function POST(
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

  const items = Array.isArray(body?.items)
    ? body.items
    : body?.sku
    ? [body]
    : [];

  if (!items.length) {
    return NextResponse.json({ error: "No products provided to add." }, { status: 400 });
  }

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const updatedItems = await addAdHocItems(id, items);
    return NextResponse.json({ items: updatedItems }, { status: 201 });
  } catch (e: any) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    console.error("Failed to add items to count sheet:", e);
    return NextResponse.json({ error: e?.message || "Could not add products to count sheet." }, { status: 500 });
  }
}

export async function PUT(
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

  const items = Array.isArray(body?.items) ? body.items : [];
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const synced = await syncAdHocItems(id, items);
    return NextResponse.json({ items: synced });
  } catch (e: any) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    console.error("Failed to sync items:", e);
    return NextResponse.json({ error: e?.message || "Could not sync items." }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // Empty body allows query param fallback
  }

  const { searchParams } = new URL(req.url);
  const allParam = searchParams.get("all") === "true" || Boolean(body?.all);
  const itemIds = Array.isArray(body?.itemIds) ? body.itemIds : [];

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const deletedCount = await deleteAdHocItems(id, { itemIds, all: allParam });
    return NextResponse.json({ success: true, count: deletedCount });
  } catch (e: any) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    console.error("Failed to delete items:", e);
    return NextResponse.json({ error: e?.message || "Could not delete items." }, { status: 500 });
  }
}
