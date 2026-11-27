import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export type SessionUser = { id: string; email: string; role: string };

/**
 * Returns the configured documentation administrator email allowlist, if set.
 * Configured via `HELP_ADMIN_EMAILS` (comma-separated emails) so no email address
 * is ever hardcoded in source code.
 */
export function getConfiguredHelpAdminEmails(): string[] {
  const raw = process.env.HELP_ADMIN_EMAILS ?? "";
  return raw
    .split(/[,;\n]/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Single authoritative server-side check for Help Centre administration rights.
 *
 * - If `HELP_ADMIN_EMAILS` is configured, ONLY accounts whose email is on that
 *   allowlist can create, edit, delete, upload screenshots, or publish documentation.
 * - Otherwise, reuses the application's existing administrator role (`role === "admin"`),
 *   consistent with `/api/settings/notifications` and `/api/auth/register`.
 */
export function isHelpAdmin(session: SessionUser | null | undefined): boolean {
  if (!session) return false;
  const allowlist = getConfiguredHelpAdminEmails();
  if (allowlist.length > 0) {
    return allowlist.includes(session.email.trim().toLowerCase());
  }
  return session.role.trim().toLowerCase() === "admin";
}

/**
 * Guard helper for API routes requiring an authenticated user.
 */
export async function requireHelpReader(): Promise<
  { ok: true; session: SessionUser; isAdmin: boolean } | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true, session, isAdmin: isHelpAdmin(session) };
}

/**
 * Guard helper for API routes requiring Help Centre administrator permissions.
 * Enforced server-side on every create, edit, delete, reorder, upload, and publish route.
 */
export async function requireHelpAdmin(): Promise<
  { ok: true; session: SessionUser } | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!isHelpAdmin(session)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Administrator permission is required to manage Help Centre documentation." },
        { status: 403 },
      ),
    };
  }
  return { ok: true, session };
}
