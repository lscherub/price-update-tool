import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  // Proxy runs on every request; fall back to the dev secret locally so
  // `next dev` works without env, but production gets a hard 500 (fail closed)
  // instead of accepting forged/foreign JWTs.
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is missing or too short (min 32 chars).");
    return new TextEncoder().encode("dev-secret-change-me-please-32chars");
  }
  return new TextEncoder().encode(s);
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/auth") || pathname.startsWith("/_next") || pathname === "/login" || pathname === "/api/health") return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    const tok = req.cookies.get("pu_session")?.value;
    if (!tok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
      await jwtVerify(tok, secret());
      return NextResponse.next();
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const tok = req.cookies.get("pu_session")?.value;
  if (!tok) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  try {
    await jwtVerify(tok, secret());
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", req.url));
  }
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)).*)"] };
