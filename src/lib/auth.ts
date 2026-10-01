import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getPrisma, isProduction } from "./db";
import { loadFileStore } from "./store";

const COOKIE = "pu_session";

function authSecret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  // Fail closed in production: never sign/verify JWTs with a fallback dev secret.
  if (!s || s.length < 32) {
    if (isProduction()) throw new Error("AUTH_SECRET is missing or too short (min 32 chars).");
    return new TextEncoder().encode("dev-secret-change-me-please-32chars");
  }
  return new TextEncoder().encode(s);
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export async function createSessionToken(payload: { id: string; email: string; role: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(authSecret());
}

export async function getSession(): Promise<{ id: string; email: string; role: string } | null> {
  try {
    const jar = await cookies();
    const tok = jar.get(COOKIE)?.value;
    if (!tok) return null;
    const { payload } = await jwtVerify(tok, authSecret());
    return { id: String(payload.id), email: String(payload.email), role: String(payload.role ?? "staff") };
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function findUserByEmail(email: string) {
  const prisma = getPrisma();
  const em = email.trim().toLowerCase();
  if (!prisma) {
    // Development-only fallback. Production callers must not reach here:
    // every auth API route returns 503 via productionDbGuard() first.
    const store = loadFileStore();
    return store.users.find((u) => u.email.toLowerCase() === em) ?? null;
  }
  return prisma.appUser.findUnique({ where: { email: em } });
}

export const SESSION_COOKIE = COOKIE;
