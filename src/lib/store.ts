import fs from "fs";
import path from "path";
import Decimal from "decimal.js";
import { getPrisma } from "./db";
import { calculateRow } from "./nearest9";
import { normalizeVendor, skuCandidates } from "./pricing";

export type ProductRow = {
  id: string;
  sku: string;
  normalizedSku: string;
  productNumber: string;
  description: string;
  vendor: string;
  brand: string;
  listCost: string;
  price: string;
  sizeDesc: string;
  isInactive: boolean;
};

export type StoreShape = {
  products: ProductRow[];
  vendorDiscounts: { id: string; vendor: string; normalizedVendor: string; defaultDiscount: string }[];
  sessions: SessionRow[];
  items: ItemRow[];
  users: { id: string; email: string; passwordHash: string; role: string }[];
  exports: { id: string; sessionId: string; kind: string; createdBy: string; createdAt: string; detail: string }[];
};

export type SessionRow = {
  id: string; vendor: string; name: string; status: string;
  notes: string; createdBy: string; createdAt: string; updatedAt: string;
};

export type ItemRow = {
  id: string; sessionId: string; rawVendorSku: string; cleanedSku: string;
  cleanedOverridden: boolean; productId: string | null; productNumber: string;
  productName: string; brand: string; vendor: string; discount: string;
  currentListPrice: string | null; vendorListPriceNew: string | null;
  ourNewListPrice: string | null; marginDivisor: string;
  ourNewRetailPrice: string | null; oldRetailPrice: string | null;
  nearest9: string | null; notes: string; isInactive: boolean;
  matched: boolean; updatedAt: string;
};

export const DATA_FILE = path.join(process.cwd(), "data", "store.json");

export function cuid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyStore(): StoreShape {
  return { products: [], vendorDiscounts: [], sessions: [], items: [], users: [], exports: [] };
}

export function loadFileStore(): StoreShape {
  try {
    if (!fs.existsSync(DATA_FILE)) return emptyStore();
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    if (!raw.trim()) return emptyStore();
    return { ...emptyStore(), ...JSON.parse(raw) };
  } catch {
    return emptyStore();
  }
}

export function saveFileStore(s: StoreShape) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2));
}

export const decOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  try { return new Decimal(String(v)).toFixed(2); } catch { return null; }
};
export const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
