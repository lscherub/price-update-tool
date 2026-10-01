/**
 * Client-side helper: turn an API error body into the most useful message.
 *
 * API routes answer with `{ error }` (validation, auth) or
 * `{ error: "DatabaseUnavailable", message: "<how to fix it>" }` for 503s, so the
 * actionable `message` is preferred over the short `error` code.
 */
export function apiErrorText(body: unknown, fallback = "Something went wrong. Please try again."): string {
  if (body && typeof body === "object") {
    const b = body as { error?: unknown; message?: unknown };
    for (const v of [b.message, b.error]) {
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return fallback;
}
