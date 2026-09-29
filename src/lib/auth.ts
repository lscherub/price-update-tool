import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getPrisma } from "./db";
import { loadFileStore } from "./store";

const COOKIE = "pu_session";
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me-please-32chars");

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
    .sign(secret());
}

export async function getSession(): Promise<{ id: string; email: string; role: string } | null> {
  try {
    const jar = await cookies();
    const tok = jar.get(COOKIE)?.value;
    if (!tok) return null;
    const { payload } = await jwtVerify(tok, secret());
    return { id: String(payload.id), email: String(payload.email), role: String(payload.role ?? "staff") };
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function findUserByEmail(email: string) {
  const prisma = getPrisma();
  const em = email.trim().toLowerCase();
  if (!prisma) {
    const store = loadFileStore();
    return store.users.find((u) => u.email.toLowerCase() === em) ?? null;
  }
  return prisma.appUser.findUnique({ where: { email: em } });
}

export const SESSION_COOKIE = COOKIE;
