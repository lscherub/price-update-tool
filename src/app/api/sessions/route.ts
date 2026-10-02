import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { buildHistorySearchParams, matchesHistoryRow } from "@/lib/sessionSearch";
import { cuid, loadFileStore, saveFileStore } from "@/lib/store";
import { formatUpdateName } from "@/lib/pricing";

export const runtime = "nodejs";

type SessionListRow = {
  id: string;
  vendor: string;
  name: string;
  status: string;
  notes: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Server-side history search against Postgres. All filtering (vendor ILIKE,
 * punctuation-insensitive regexp match, optional date range) happens in the
 * database with a 200-row cap, so a large history never loads into the browser.
 */
async function searchSessionsDb(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
  q: string,
): Promise<SessionListRow[]> {
  if (!q) {
    return prisma.priceUpdateSession.findMany({ orderBy: { updatedAt: "desc" }, take: 200 });
  }
  const p = buildHistorySearchParams(q);
  if (p.normLike && p.from && p.to && p.utcFrom && p.utcTo) {
    return prisma.$queryRaw<SessionListRow[]>(Prisma.sql`
      SELECT "id", "vendor", "name", "status", "notes", "createdBy", "createdAt", "updatedAt"
      FROM "PriceUpdateSession"
      WHERE ("vendor" ILIKE ${p.like} OR "name" ILIKE ${p.like}
        OR regexp_replace(lower("vendor"), '[^a-z0-9]', '', 'g') LIKE ${p.normLike}
        OR regexp_replace(lower("name"), '[^a-z0-9]', '', 'g') LIKE ${p.normLike}
        OR ("createdAt" >= ${p.from} AND "createdAt" <= ${p.to})
        OR ("updatedAt" >= ${p.from} AND "updatedAt" <= ${p.to})
        OR ("createdAt" >= ${p.utcFrom} AND "createdAt" <= ${p.utcTo})
        OR ("updatedAt" >= ${p.utcFrom} AND "updatedAt" <= ${p.utcTo}))
      ORDER BY "updatedAt" DESC LIMIT 200`);
  }
  if (p.normLike) {
    return prisma.$queryRaw<SessionListRow[]>(Prisma.sql`
      SELECT "id", "vendor", "name", "status", "notes", "createdBy", "createdAt", "updatedAt"
      FROM "PriceUpdateSession"
      WHERE ("vendor" ILIKE ${p.like} OR "name" ILIKE ${p.like}
        OR regexp_replace(lower("vendor"), '[^a-z0-9]', '', 'g') LIKE ${p.normLike}
        OR regexp_replace(lower("name"), '[^a-z0-9]', '', 'g') LIKE ${p.normLike})
      ORDER BY "updatedAt" DESC LIMIT 200`);
  }
  if (p.from && p.to && p.utcFrom && p.utcTo) {
    return prisma.$queryRaw<SessionListRow[]>(Prisma.sql`
      SELECT "id", "vendor", "name", "status", "notes", "createdBy", "createdAt", "updatedAt"
      FROM "PriceUpdateSession"
      WHERE ("vendor" ILIKE ${p.like} OR "name" ILIKE ${p.like}
        OR ("createdAt" >= ${p.from} AND "createdAt" <= ${p.to})
        OR ("updatedAt" >= ${p.from} AND "updatedAt" <= ${p.to})
        OR ("createdAt" >= ${p.utcFrom} AND "createdAt" <= ${p.utcTo})
        OR ("updatedAt" >= ${p.utcFrom} AND "updatedAt" <= ${p.utcTo}))
      ORDER BY "updatedAt" DESC LIMIT 200`);
  }
  return prisma.$queryRaw<SessionListRow[]>(Prisma.sql`
    SELECT "id", "vendor", "name", "status", "notes", "createdBy", "createdAt", "updatedAt"
    FROM "PriceUpdateSession"
    WHERE ("vendor" ILIKE ${p.like} OR "name" ILIKE ${p.like})
    ORDER BY "updatedAt" DESC LIMIT 200`);
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.slice(0, 200) ?? "";
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  if (!prisma) {
    const store = loadFileStore();
    const rows = store.sessions
      .filter((s) => matchesHistoryRow(s, q))
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 200);
    return NextResponse.json({ rows });
  }
  try {
    const rows = await searchSessionsDb(prisma, q.trim());
    return NextResponse.json({
      rows: rows.map((s) => ({
        id: s.id, vendor: s.vendor, name: s.name, status: s.status, notes: s.notes,
        createdBy: s.createdBy,
        createdAt: new Date(s.createdAt).toISOString(),
        updatedAt: new Date(s.updatedAt).toISOString(),
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
