import { NextResponse } from "next/server";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { processDueReminders, verifyCronAuth } from "@/lib/reminderProcessor";

export const runtime = "nodejs";
export const maxDuration = 60;

async function handleCron(req: Request) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const summary = await processDueReminders({ prisma });
    return NextResponse.json(summary);
  } catch (e) {
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
