import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

export const runtime = "nodejs";

/** Public endpoint. Reports app + DB reachability without leaking secrets. */
export async function GET() {
  const prisma = getPrisma();
  if (!prisma) {
    return NextResponse.json(
      {
        ok: false,
        db: { configured: false, reachable: false, mode: process.env.NODE_ENV === "production" ? "unconfigured" : "file-store" },
        hint: "DATABASE_URL is not set. Production requires the Supabase pooler URI; local dev uses the JSON file store.",
      },
      { status: 503 },
    );
  }
  let host = "(hidden)";
  let port = "";
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    host = u.hostname.replace(/^(db\.)?(.{3}).*(.{2})$/, "$1$2…$3");
    port = u.port;
  } catch {
    /* ignore parse errors */
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      db: { configured: true, reachable: true, host, port },
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        db: { configured: true, reachable: false, host, port },
        error:
          "Can't reach the database server (Prisma P1001). " +
          "On Vercel + Supabase this almost always means DATABASE_URL points at " +
          "the direct connection (db.<ref>.supabase.co:5432) instead of the " +
          "Supavisor pooler (aws-0-<region>.pooler.supabase.com:6543).",
        fix: [
          "In Supabase: Project Settings → Database → Connection string → use the 'Transaction pooler' URI (port 6543, ends with ?pgbouncer=true).",
          "In Vercel: set DATABASE_URL to that pooler URI for Production + Preview + Development, then redeploy.",
          "Run migrations + seed against the DIRECT (port 5432) URL from your own machine: npm run prisma:deploy, never from serverless.",
          "Also check: project is not paused, password has no unencoded special chars, and the pooler host matches your project's region.",
        ],
      },
      { status: 503 },
    );
  }
}
