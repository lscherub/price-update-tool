import { PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const isProduction = (): boolean => process.env.NODE_ENV === "production";

/**
 * Returns a Prisma client when DATABASE_URL is configured, otherwise null
 * (callers fall back to the local JSON file store in development only).
 *
 * PRODUCTION MUST USE POSTGRESQL: every API route must treat a null return
 * while `isProduction()` is true as a hard 503 (see `productionDbGuard()`)
 * instead of silently reading/writing ephemeral local JSON on Vercel.
 *
 * NOTE: a configured DATABASE_URL does NOT guarantee the server is reachable
 * (wrong host/port, paused Supabase project, bad password, direct :5432 URL
 * used from Vercel instead of the :6543 pooler, ...). Endpoints that touch the
 * DB should catch connection failures with `isDbConnectionError()` and return
 * a 503 with remediation steps (see /api/health) instead of leaking a raw
 * Prisma P1001 stack trace.
 */
export function getPrisma(): PrismaClient | null {
  if (!process.env.DATABASE_URL) return null;
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({ log: ["error"] });
  }
  return globalForPrisma.prisma;
}

export function hasDb(): boolean {
  return !!process.env.DATABASE_URL;
}

/**
 * Fail-closed guard for API routes. In production (Vercel) the app must NEVER
 * fall back to the local JSON file store — return a 503 response when the
 * database is not configured. In development, returns null so callers may use
 * the JSON file fallback.
 * Usage:
 *   const prisma = getPrisma();
 *   const prodErr = productionDbGuard(prisma);
 *   if (prodErr) return prodErr;
 */
export function productionDbGuard(prisma: unknown): NextResponse | null {
  if (prisma) return null;
  if (isProduction()) {
    return NextResponse.json(
      {
        error: "DatabaseUnavailable",
        message:
          "DATABASE_URL is not configured in production. Set it to the Supabase " +
          "Supavisor transaction pooler URI (port 6543, ?pgbouncer=true) in Vercel, then redeploy. " +
          "The app never uses local JSON storage in production.",
      },
      { status: 503 },
    );
  }
  return null;
}

/** True for Prisma connection errors (P1000 auth, P1001 unreachable, P1002 timeout, ...). */
export function isDbConnectionError(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  if (code === "P1000" || code === "P1001" || code === "P1002" || code === "P1017") return true;
  const msg = String((e as { message?: string })?.message ?? e ?? "");
  return /can't reach database server|connection refused|timed out|getaddrinfo|ENOTFOUND|ECONNREFUSED/i.test(msg);
}

/**
 * Shared 503 response for unreachable databases. Points the operator at the
 * /api/health diagnosis + the Supabase pooler fix instead of a raw P1001.
 */
export function dbUnreachableResponse() {
  return NextResponse.json(
    {
      error: "DatabaseUnavailable",
      message:
        "Can't reach the database server (Prisma P1001). " +
        "If DATABASE_URL points at db.<ref>.supabase.co:5432, switch it to the " +
        "Supavisor transaction pooler (aws-0-<region>.pooler.supabase.com:6543?pgbouncer=true).",
      diagnosis: "/api/health",
    },
    { status: 503 },
  );
}

