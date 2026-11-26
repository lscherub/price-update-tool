import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { getUserPreferences, saveUserPreferences } from "@/lib/userPreferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const { preferences, hasStoredRecord } = await getUserPreferences(prisma, session.id);
    return NextResponse.json(
      { userId: session.id, preferences, hasStoredRecord },
      { headers: NO_STORE_HEADERS },
    );
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load user preferences." }, { status: 500 });
  }
}

async function handleSave(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const body = await req.json().catch(() => ({}));
  try {
    const preferences = await saveUserPreferences(prisma, session.id, body);
    return NextResponse.json(
      { ok: true, userId: session.id, preferences },
      { headers: NO_STORE_HEADERS },
    );
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not save user preferences." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  return handleSave(req);
}

export async function PATCH(req: Request) {
  return handleSave(req);
}
