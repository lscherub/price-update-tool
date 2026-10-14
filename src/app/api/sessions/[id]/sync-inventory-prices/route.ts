import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { loadFileStore, saveFileStore } from "@/lib/store";
import { getLastPriceSyncAt, setLastPriceSyncNow } from "@/lib/inventoryMeta";
import { applyPosPriceUpdates } from "@/lib/inventoryDb";
import {
  collectSyncKeys,
  dedupeSyncRows,
  matchSku,
  PRICE_SYNC_LOOKUP_CHUNK,
  selectPosSyncRows,
  validateSyncPrice,
  type SkuIndexEntry,
} from "@/lib/posPriceSync";

export const runtime = "nodejs";
export const maxDuration = 60;

type SheetItem = {
  id: string;
  cleanedSku: string;
  ourNewListPrice: string | null;
  nearest9: string | null;
};

const SAMPLE = 25;
const sample = <T,>(arr: T[]): T[] => arr.slice(0, SAMPLE);
const strip = (v: string): string => v.replace(/^0+/, "") || "0";

type SyncBuckets = {
  skippedUnmatched: string[];
  skippedAmbiguous: string[];
  skippedBlankPrice: string[];
  skippedInvalidPrice: { sku: string; price: string }[];
  failed: string[];
};

function emptyBuckets(): SyncBuckets {
  return {
    skippedUnmatched: [],
    skippedAmbiguous: [],
    skippedBlankPrice: [],
    skippedInvalidPrice: [],
    failed: [],
  };
}

function summarize(
  exportedRows: number,
  updated: number,
  b: SyncBuckets,
  skippedDuplicate: string[],
  lastUpdatedAt: string | null,
) {
  return NextResponse.json({
    ok: true,
    updated,
    exportedRows,
    skippedUnmatched: sample(b.skippedUnmatched),
    skippedUnmatchedCount: b.skippedUnmatched.length,
    skippedAmbiguous: sample(b.skippedAmbiguous),
    skippedAmbiguousCount: b.skippedAmbiguous.length,
    skippedBlankPrice: sample(b.skippedBlankPrice),
    skippedBlankPriceCount: b.skippedBlankPrice.length,
    skippedInvalidPrice: sample(b.skippedInvalidPrice),
    skippedInvalidPriceCount: b.skippedInvalidPrice.length,
    skippedDuplicate: sample(skippedDuplicate),
    skippedDuplicateCount: skippedDuplicate.length,
    failed: sample(b.failed),
    failedCount: b.failed.length,
    lastUpdatedAt,
  });
}

/**
 * POST: explicitly-confirmed follow-up to Export for POS. Uses the SAME row
 * selection as the CSV export (every item with a non-blank Cleaned SKU),
 * writes ONLY Product.price (= Nearest 9) + Product.listCost (= Our New
 * List Price). Never inserts. Last imported untouched; Last updated set
 * only when at least one price update succeeds.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;
  try {
    if (!prisma) return fileStoreSync(id);
    return prismaSync(prisma, id);
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not update inventory prices." }, { status: 500 });
  }
}

type StoreProduct = {
  id: string; sku: string; normalizedSku: string; price: string; listCost: string;
};

/** Dev file-store path: same selection + validation + matching, in memory. */
function fileStoreSync(id: string) {
  const store = loadFileStore();
  if (!store.sessions.some((s) => s.id === id)) {
    return NextResponse.json({ error: "Price update not found" }, { status: 404 });
  }
  const rawItems: SheetItem[] = store.items
    .filter((i) => i.sessionId === id)
    .map((i) => ({
      id: i.id, cleanedSku: i.cleanedSku,
      ourNewListPrice: i.ourNewListPrice, nearest9: i.nearest9,
    }));
  const exported = selectPosSyncRows(rawItems);
  const { unique, duplicateSkus } = dedupeSyncRows(exported);
  const b = emptyBuckets();
  const bySku = new Map(store.products.map((p) => [p.sku, p]));
  const byNorm = new Map(store.products.map((p) => [p.normalizedSku, p]));
  let updated = 0;
  for (const row of unique) {
    const key = String(row.cleanedSku ?? "").trim();
    const priceCheck = validateSyncPrice(row.nearest9);
    if (!priceCheck.ok) {
      if (priceCheck.reason === "blank") b.skippedBlankPrice.push(key);
      else b.skippedInvalidPrice.push({ sku: key, price: String(row.nearest9 ?? "") });
      continue;
    }
    const rawList = row.ourNewListPrice === null ? "" : String(row.ourNewListPrice).trim();
    let listValue: string | null = null;
    if (rawList !== "") {
      const listCheck = validateSyncPrice(row.ourNewListPrice);
      if (!listCheck.ok) {
        b.skippedInvalidPrice.push({ sku: key, price: String(row.ourNewListPrice ?? "") });
        continue;
      }
      listValue = listCheck.value;
    }
    const exact = bySku.get(key) ?? byNorm.get(key);
    const sKey = strip(key);
    const strippedHits = store.products.filter(
      (p) => strip(p.sku) === sKey || strip(p.normalizedSku) === sKey,
    );
    if (exact && strippedHits.length > 1 && !strippedHits.some((p) => p.id === exact.id)) {
      b.skippedAmbiguous.push(key);
      continue;
    }
    if (!exact) {
      if (strippedHits.length === 1) {
        const hit = strippedHits[0] as StoreProduct;
        hit.price = priceCheck.value;
        if (listValue !== null) hit.listCost = listValue;
        updated++;
      } else if (strippedHits.length > 1) {
        b.skippedAmbiguous.push(key);
      } else {
        b.skippedUnmatched.push(key);
      }
      continue;
    }
    exact.price = priceCheck.value;
    if (listValue !== null) exact.listCost = listValue;
    updated++;
  }
  let lastUpdatedAt: string | null = store.inventoryLastPriceSyncAt ?? null;
  if (updated > 0) {
    lastUpdatedAt = new Date().toISOString();
    store.inventoryLastPriceSyncAt = lastUpdatedAt;
  }
  saveFileStore(store);
  return summarize(exported.length, updated, b, duplicateSkus, lastUpdatedAt);
}

type PrismaLike = NonNullable<ReturnType<typeof getPrisma>>;

/** Postgres path: chunked lookup + one UPDATE per chunk, never inserts. */
async function prismaSync(prisma: PrismaLike, id: string) {
  const sess = await prisma.priceUpdateSession.findUnique({ where: { id } });
  if (!sess) return NextResponse.json({ error: "Price update not found" }, { status: 404 });
  const items = await prisma.priceUpdateItem.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: "asc" },
    take: 50000,
    select: { id: true, cleanedSku: true, ourNewListPrice: true, nearest9: true },
  });
  const sheetRows: SheetItem[] = items.map((i) => ({
    id: i.id,
    cleanedSku: i.cleanedSku,
    ourNewListPrice: i.ourNewListPrice ? String(i.ourNewListPrice) : null,
    nearest9: i.nearest9 ? String(i.nearest9) : null,
  }));
  const exported = selectPosSyncRows(sheetRows);
  const { unique, duplicateSkus } = dedupeSyncRows(exported);
  const b = emptyBuckets();
  const validated: { sku: string; price: string; listCost: string | null }[] = [];
  for (const row of unique) {
    const key = String(row.cleanedSku ?? "").trim();
    const priceCheck = validateSyncPrice(row.nearest9);
    if (!priceCheck.ok) {
      if (priceCheck.reason === "blank") b.skippedBlankPrice.push(key);
      else b.skippedInvalidPrice.push({ sku: key, price: String(row.nearest9 ?? "") });
      continue;
    }
    const rawList = row.ourNewListPrice === null ? "" : String(row.ourNewListPrice).trim();
    let listCost: string | null = null;
    if (rawList !== "") {
      const listCheck = validateSyncPrice(row.ourNewListPrice);
      if (!listCheck.ok) {
        b.skippedInvalidPrice.push({ sku: key, price: String(row.ourNewListPrice ?? "") });
        continue;
      }
      listCost = listCheck.value;
    }
    validated.push({ sku: key, price: priceCheck.value, listCost });
  }
  const keys = collectSyncKeys(validated.map((v) => v.sku));
  const found: SkuIndexEntry[] = [];
  for (let i = 0; i < keys.length; i += PRICE_SYNC_LOOKUP_CHUNK) {
    const chunk = keys.slice(i, i + PRICE_SYNC_LOOKUP_CHUNK);
    const rows = await prisma.product.findMany({
      where: { OR: [{ sku: { in: chunk } }, { normalizedSku: { in: chunk } }] },
      select: { id: true, sku: true, normalizedSku: true },
      take: 50000,
    });
    for (const r of rows) found.push({ id: r.id, sku: r.sku, normalizedSku: r.normalizedSku });
  }
  const updates: { productId: string; price: string; listCost: string | null }[] = [];
  const skuByProductId = new Map<string, string>();
  for (const v of validated) {
    const m = matchSku(v.sku, found);
    if (m.kind === "unmatched") b.skippedUnmatched.push(v.sku);
    else if (m.kind === "ambiguous") b.skippedAmbiguous.push(v.sku);
    else {
      updates.push({ productId: m.productId, price: v.price, listCost: v.listCost });
      if (!skuByProductId.has(m.productId)) skuByProductId.set(m.productId, v.sku);
    }
  }
  let updated = 0;
  if (updates.length) {
    const { failedIds } = await applyPosPriceUpdates(prisma, updates);
    for (const pid of failedIds) b.failed.push(skuByProductId.get(pid) ?? pid);
    updated = updates.length - failedIds.length;
  }
  let lastUpdatedAt = await getLastPriceSyncAt(prisma);
  if (updated > 0) lastUpdatedAt = await setLastPriceSyncNow(prisma);
  return summarize(exported.length, updated, b, duplicateSkus, lastUpdatedAt);
}
