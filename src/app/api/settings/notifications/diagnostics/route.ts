import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { getReminderDiagnostics } from "@/lib/reminderProcessor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const diagnostics = await getReminderDiagnostics(prisma);
    return NextResponse.json(
      { diagnostics, canRun: session.role === "admin" },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load reminder diagnostics." }, { status: 500 });
  }
}
