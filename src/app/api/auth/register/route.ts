import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { loadFileStore, saveFileStore, cuid } from "@/lib/store";
import { hashPassword } from "@/lib/auth";

export async function POST(req: Request) {
  // Bootstrap: create first admin if no users exist; otherwise require admin.
  const body = await req.json().catch(() => ({}));
  const { email, password, role } = body as { email?: string; password?: string; role?: string };
  if (!email || !password) return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  const prisma = getPrisma();
  const em = email.trim().toLowerCase();
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
  const count = await prisma.appUser.count();
  if (count > 0) {
    const s = await getSession();
    if (!s || s.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }
  const exists = await prisma.appUser.findUnique({ where: { email: em } });
  if (exists) return NextResponse.json({ error: "User exists" }, { status: 400 });
  const u = await prisma.appUser.create({
    data: { email: em, passwordHash: await hashPassword(password), role: count === 0 ? "admin" : (role ?? "staff") },
  });
  return NextResponse.json({ ok: true, email: u.email, role: u.role });
}
