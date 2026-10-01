import { NextResponse } from "next/server";
import { createSessionToken, findUserByEmail, setSessionCookie, verifyPassword } from "@/lib/auth";
import { isDbConnectionError, dbUnreachableResponse, getPrisma, productionDbGuard } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { email, password } = body as { email?: string; password?: string };
  if (!email || !password) return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  try {
    const user = await findUserByEmail(email);
    if (!user) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    const token = await createSessionToken({ id: user.id, email: user.email, role: user.role });
    await setSessionCookie(token);
    return NextResponse.json({ ok: true, email: user.email, role: user.role });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Login failed. Please try again." }, { status: 500 });
  }
}
