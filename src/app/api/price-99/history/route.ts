import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import {
  createPrice99BatchRecord,
  listPrice99Batches,
} from "@/lib/price99Server";
import type { Price99Action, Price99Item } from "@/lib/price99";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const action = searchParams.get("action") ?? "";
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "100", 10) || 100));

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const batches = await listPrice99Batches({ q, action, limit });
    return NextResponse.json({ batches });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    console.error("Failed to list 99 Price batches:", e);
    return NextResponse.json({ error: "Could not load history batches." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = (body?.action ?? "").toUpperCase() as Price99Action;
  if (action !== "CHECK" && action !== "UNCHECK") {
    return NextResponse.json(
      { error: "Invalid action. Action must be 'CHECK' or 'UNCHECK'." },
      { status: 400 }
    );
  }

  const items = Array.isArray(body?.items) ? (body.items as Price99Item[]) : [];
  if (!items.length) {
    return NextResponse.json(
      { error: "At least one product item is required to generate a batch." },
      { status: 400 }
    );
  }

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const created = await createPrice99BatchRecord({
      action,
      items,
      createdBy: session.email,
    });
    return NextResponse.json({ batch: created }, { status: 201 });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    console.error("Failed to save 99 Price batch:", e);
    return NextResponse.json({ error: "Could not save history batch." }, { status: 500 });
  }
}

