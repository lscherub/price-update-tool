import { PrismaClient } from "@prisma/client";
import { calculateRow } from "./nearest9";
import { normalizeSku, normalizeVendor, skuCandidates } from "./pricing";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrisma(): PrismaClient | null {
  if (!process.env.DATABASE_URL) return null;
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient();
  }
  return globalForPrisma.prisma;
}

export function hasDb(): boolean {
  return !!process.env.DATABASE_URL;
}

export { normalizeSku, normalizeVendor, skuCandidates };
export { calculateRow };
