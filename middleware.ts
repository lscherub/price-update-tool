import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me-please-32chars");

export async function middleware(req: NextRequest) {
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
