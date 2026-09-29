import { NextResponse } from "next/server";
import { clearSessionCookie, getSession } from "@/lib/auth";

export async function GET() {
  const s = await getSession();
  return NextResponse.json({ user: s });
}

export async function DELETE() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
