import { NextResponse } from "next/server";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { processDueReminders, verifyCronAuth } from "@/lib/reminderProcessor";
import { appendReminderRunHistory } from "@/lib/notificationSettings";
import { cuid } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handleCron(req: Request) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const summary = await processDueReminders({
      prisma,
      source: "cron",
      triggeredBy: "supabase-cron",
    });
    return NextResponse.json(summary, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Reminder processing failed.";
    await appendReminderRunHistory(prisma, {
      id: cuid(),
      ranAt: new Date().toISOString(),
      source: "cron",
      triggeredBy: "supabase-cron",
      ok: false,
      claimed: 0,
      attempted: 0,
      sent: 0,
      failed: 0,
      retriedScheduled: 0,
      expired: 0,
      cancelled: 0,
      error: msg.slice(0, 500),
    });
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Reminder processing failed." }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return handleCron(req);
}

export async function POST(req: Request) {
  return handleCron(req);
}
