import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { queryCalendarEvents } from "@/lib/calendarServer";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const { searchParams } = new URL(req.url);
  try {
    const result = await queryCalendarEvents(prisma, {
      from: searchParams.get("from"),
      to: searchParams.get("to"),
      vendor: searchParams.get("vendor"),
      statusFilter: searchParams.get("status"),
      reminderFilter: searchParams.get("reminder"),
      timeframe: searchParams.get("timeframe"),
      q: searchParams.get("q"),
    });
    return NextResponse.json(result);
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load calendar events." }, { status: 500 });
  }
}
