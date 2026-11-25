import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { getReminderDiagnostics, processDueReminders } from "@/lib/reminderProcessor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Admin-only manual trigger ("Run Reminder Check Now") invoking the exact same
 * atomic, idempotent reminder processor as Supabase Cron. Never bypasses
 * duplicate prevention or re-sends already-sent reminders.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Admin access is required to run reminder checks." }, { status: 403 });
  }

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const result = await processDueReminders({
      prisma,
      source: "manual",
      triggeredBy: session.email,
    });
    const diagnostics = await getReminderDiagnostics(prisma);
    return NextResponse.json(
      { ok: true, result, diagnostics },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not run reminder check." }, { status: 500 });
  }
}
