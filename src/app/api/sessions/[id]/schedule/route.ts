import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import {
  cancelSessionSchedule,
  getSessionScheduleSummary,
  scheduleOrRescheduleSession,
} from "@/lib/calendarServer";
import type { ReminderType } from "@/lib/calendar";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const schedule = await getSessionScheduleSummary(prisma, id);
    if (!schedule) return NextResponse.json({ error: "Price update not found" }, { status: 404 });
    return NextResponse.json({ schedule });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load schedule details." }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const body = await req.json().catch(() => ({}));
  const reminderTypeRaw = String(body.reminderType ?? "ONE_DAY_BEFORE");
  const reminderType: ReminderType =
    reminderTypeRaw === "TWO_DAYS_BEFORE" || reminderTypeRaw === "CUSTOM"
      ? reminderTypeRaw
      : "ONE_DAY_BEFORE";

  try {
    const result = await scheduleOrRescheduleSession(prisma, id, session.email, {
      effectiveDate: String(body.effectiveDate ?? ""),
      reminderEnabled: Boolean(body.reminderEnabled),
      reminderType,
      customDateKey: body.customDateKey ? String(body.customDateKey) : null,
      customTimeHHMM: body.customTimeHHMM ? String(body.customTimeHHMM) : null,
      customReminderAtIso: body.customReminderAtIso ? String(body.customReminderAtIso) : null,
      useCustomRecipients: Boolean(body.useCustomRecipients),
      customRecipients: Array.isArray(body.customRecipients)
        ? body.customRecipients.map((v: unknown) => String(v ?? ""))
        : undefined,
      confirmAfterEffectiveDate: Boolean(body.confirmAfterEffectiveDate),
      preserveExistingReminder: Boolean(body.preserveExistingReminder),
      createNewReminder: Boolean(body.createNewReminder),
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          code: result.code,
          requiresConfirmation: Boolean(result.requiresConfirmation),
        },
        { status: result.status },
      );
    }

    return NextResponse.json(result);
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not save schedule." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const result = await cancelSessionSchedule(prisma, id, session.email);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not cancel schedule." }, { status: 500 });
  }
}
