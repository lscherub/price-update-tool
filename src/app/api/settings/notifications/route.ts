import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import {
  getCalendarNotificationSettings,
  saveCalendarNotificationSettings,
} from "@/lib/notificationSettings";
import { getSmtp2goPublicStatus } from "@/lib/smtp2go";

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
    const settings = await getCalendarNotificationSettings(prisma);
    return NextResponse.json(
      {
        settings,
        canEdit: session.role === "admin",
        emailConfig: getSmtp2goPublicStatus(),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load notification settings." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Admin access is required to modify notification settings." }, { status: 403 });
  }

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const body = await req.json().catch(() => ({}));
  try {
    const saved = await saveCalendarNotificationSettings(prisma, {
      recipients: body.recipients,
      timezone: body.timezone,
      defaultReminderHour: body.defaultReminderHour,
      defaultReminderMinute: body.defaultReminderMinute,
      defaultSendReminder: body.defaultSendReminder,
    });
    if (!saved.ok) {
      return NextResponse.json({ error: saved.error }, { status: 400 });
    }
    return NextResponse.json(
      {
        ok: true,
        settings: saved.settings,
        emailConfig: getSmtp2goPublicStatus(),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not save notification settings." }, { status: 500 });
  }
}
