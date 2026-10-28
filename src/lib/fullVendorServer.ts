import { getPrisma } from "./db";
import { loadFileStore } from "./store";
import { normalizeVendor } from "./pricing";
import { FULL_VENDOR_KIND, type FvProduct } from "./fullVendor";

type Prisma = NonNullable<ReturnType<typeof getPrisma>>;

/**
 * Every inventory product (Active AND Inactive) whose vendor matches `vendor`
 * using the same case/space-insensitive key as `normalizeVendor`. Read-only.
 */
export async function loadVendorProducts(prisma: Prisma | null, vendor: string): Promise<FvProduct[]> {
  const key = normalizeVendor(vendor);
  if (!key) return [];
  if (!prisma) {
    return loadFileStore().products
      .filter((p) => normalizeVendor(p.vendor) === key)
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map((p) => ({
        id: p.id, sku: p.sku, normalizedSku: p.normalizedSku,
        productNumber: p.productNumber ?? "", description: p.description ?? "",
        vendor: p.vendor ?? "", brand: p.brand ?? "",
        listCost: String(p.listCost ?? "0"), price: String(p.price ?? "0"),
        sizeDesc: p.sizeDesc ?? "", isInactive: !!p.isInactive,
      }));
  }
  const rows = await prisma.$queryRawUnsafe<FvProduct[]>(
    `SELECT "id","sku","normalizedSku","productNumber","description","vendor","brand",
            "listCost"::text AS "listCost","price"::text AS "price","sizeDesc","isInactive"
       FROM "Product"
      WHERE regexp_replace(lower(btrim("vendor")), '\\s+', ' ', 'g') = $1
      ORDER BY "sku"`,
    key,
  );
  return rows.map((p) => ({ ...p, isInactive: !!p.isInactive }));
}

/** Session ids (from `ids`) that were created by the Full Vendor workflow. */
export async function fullVendorSessionIds(prisma: Prisma | null, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  if (!prisma) {
    const want = new Set(ids);
    return new Set(loadFileStore().exports.filter((e) => e.kind === FULL_VENDOR_KIND && want.has(e.sessionId)).map((e) => e.sessionId));
  }
  try {
    const rows = await prisma.exportLog.findMany({
      where: { kind: FULL_VENDOR_KIND, sessionId: { in: ids } },
      select: { sessionId: true },
    });
    return new Set(rows.map((r) => r.sessionId));
  } catch {
    // The marker is informational: never break history/detail loading over it.
    return new Set();
  }
}

