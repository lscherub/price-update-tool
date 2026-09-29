import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { cuid, loadFileStore, saveFileStore } from "@/lib/store";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    const rows = store.sessions.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return NextResponse.json({ rows });
  }
  const rows = await prisma.priceUpdateSession.findMany({ orderBy: { updatedAt: "desc" }, take: 200 });
  return NextResponse.json({
    rows: rows.map((s) => ({
      id: s.id, vendor: s.vendor, name: s.name, status: s.status, notes: s.notes,
      createdBy: s.createdBy, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString(),
    })),
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const vendor = String(body.vendor ?? "").trim();
  const notes = String(body.notes ?? "");
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const prisma = getPrisma();
  if (!prisma) {
    const store = loadFileStore();
    const now = new Date().toISOString();
    const s = { id: cuid(), vendor, name, status: "Draft", notes, createdBy: session.email, createdAt: now, updatedAt: now };
    store.sessions.push(s);
    saveFileStore(store);
    return NextResponse.json({ ok: true, session: s });
  }
  const s = await prisma.priceUpdateSession.create({
    data: { vendor, name, notes, status: "Draft", createdBy: session.email },
  });
  return NextResponse.json({
    ok: true,
    session: { id: s.id, vendor: s.vendor, name: s.name, status: s.status, notes: s.notes, createdBy: s.createdBy, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString() },
  });
}
