import { NextResponse } from "next/server";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { loadFileStore, saveFileStore, cuid } from "@/lib/store";
import { hashPassword } from "@/lib/auth";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  // Bootstrap: create first admin if no users exist; otherwise require admin.
  const body = await req.json().catch(() => ({}));
  const { email, password, role } = body as { email?: string; password?: string; role?: string };
  if (!email || !password) return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  const em = email.trim().toLowerCase();
  if (!EMAIL_RE.test(em)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  if (!prisma) {
    const store = loadFileStore();
    if (store.users.length > 0) {
      const s = await getSession();
      if (!s || s.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });
    }
    if (store.users.some((u) => u.email.toLowerCase() === em)) {
      return NextResponse.json({ error: "User exists" }, { status: 400 });
    }
    const u = { id: cuid(), email: em, passwordHash: await hashPassword(password), role: store.users.length === 0 ? "admin" : (role ?? "staff") };
    store.users.push(u);
    saveFileStore(store);
    return NextResponse.json({ ok: true, email: u.email, role: u.role });
  }
  try {
    const count = await prisma.appUser.count();
    if (count > 0) {
      const s = await getSession();
      if (!s || s.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });
    }
    const exists = await prisma.appUser.findUnique({ where: { email: em } });
    if (exists) return NextResponse.json({ error: "An account with this email already exists" }, { status: 400 });
    const u = await prisma.appUser.create({
      data: { email: em, passwordHash: await hashPassword(password), role: count === 0 ? "admin" : (role ?? "staff") },
    });
    return NextResponse.json({ ok: true, email: u.email, role: u.role });
  } catch (e) {
    // Missing tables (e.g. migrations never ran) surface as P2021; connection
    // failures as P1000/P1001/P1002 — both get actionable messages, never a stack trace.
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    if ((e as { code?: string })?.code === "P2021" || /does not exist in the current database/i.test(String((e as { message?: string })?.message ?? ""))) {
      return NextResponse.json(
        { error: "Database tables are missing. Run database migrations (prisma migrate deploy) and try again." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Could not create account. Please try again." }, { status: 500 });
  }
}
