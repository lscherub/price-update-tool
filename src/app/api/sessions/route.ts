import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { cuid, loadFileStore, saveFileStore } from "@/lib/store";
import { formatUpdateName } from "@/lib/pricing";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (!prisma) {
    const store = loadFileStore();
    const rows = store.sessions.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return NextResponse.json({ rows });
  }
  try {
    const rows = await prisma.priceUpdateSession.findMany({ orderBy: { updatedAt: "desc" }, take: 200 });
    return NextResponse.json({
      rows: rows.map((s) => ({
        id: s.id, vendor: s.vendor, name: s.name, status: s.status, notes: s.notes,
        createdBy: s.createdBy, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString(),
      })),
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load price updates." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const vendor = String(body.vendor ?? "").trim().slice(0, 200);
  const notes = String(body.notes ?? "").slice(0, 5000);
  // The update name is generated, never typed: "<Vendor> - October 1, 2026".
  // An explicit name is still accepted for API compatibility/back-dated entries,
  // but the UI no longer collects it.
  const name = (String(body.name ?? "").trim() || formatUpdateName(vendor)).slice(0, 200);
  if (name.length > 200) return NextResponse.json({ error: "Update name is too long (max 200 characters)" }, { status: 400 });
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (!prisma) {
    const store = loadFileStore();
    const now = new Date().toISOString();
    const s = { id: cuid(), vendor, name, status: "Draft", notes, createdBy: session.email, createdAt: now, updatedAt: now };
    store.sessions.push(s);
    saveFileStore(store);
    return NextResponse.json({ ok: true, session: s });
  }
  try {
    const s = await prisma.priceUpdateSession.create({
      data: { vendor, name, notes, status: "Draft", createdBy: session.email },
    });
    return NextResponse.json({
      ok: true,
      session: { id: s.id, vendor: s.vendor, name: s.name, status: s.status, notes: s.notes, createdBy: s.createdBy, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString() },
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not create price update." }, { status: 500 });
  }
}
