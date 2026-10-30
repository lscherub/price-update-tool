import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "./db";
import { cuid, loadFileStore, saveFileStore, type Price99BatchRow } from "./store";
import {
  generateBatchId,
  type Price99Action,
  type Price99BatchRecord,
  type Price99Item,
} from "./price99";

export type DbLike = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe"> & {
  price99Batch?: {
    create: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    findUnique: (args: any) => Promise<any | null>;
  };
};

const ENSURE_PRICE99_SQL = `
CREATE TABLE IF NOT EXISTS "Price99Batch" (
  "id" TEXT PRIMARY KEY,
  "batchId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "productCount" INTEGER NOT NULL,
  "itemsJson" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Price99Batch_batchId_key'
  ) THEN
    ALTER TABLE "Price99Batch"
      ADD CONSTRAINT "Price99Batch_batchId_key"
      UNIQUE ("batchId");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Price99Batch_createdAt_idx" ON "Price99Batch"("createdAt");
CREATE INDEX IF NOT EXISTS "Price99Batch_action_idx" ON "Price99Batch"("action");
`;

let ensured = false;
export async function ensurePrice99Table(db: DbLike): Promise<void> {
  if (ensured) return;
  try {
    await db.$executeRawUnsafe(ENSURE_PRICE99_SQL);
    ensured = true;
  } catch (e) {
    // If executing raw SQL fails (e.g. permission or already exists), do not crash
    console.warn("Could not ensure Price99Batch table:", e);
  }
}

/**
 * Creates and persists a new 99 Price batch.
 * Never modifies or deletes any existing batch.
 */
export async function createPrice99BatchRecord({
  action,
  items,
  createdBy = "",
  dbOverride,
}: {
  action: Price99Action;
  items: Price99Item[];
  createdBy?: string;
  dbOverride?: DbLike | null;
}): Promise<Price99BatchRecord> {
  const db = dbOverride !== undefined ? dbOverride : getPrisma();
  const batchId = generateBatchId();
  const itemsJson = JSON.stringify(items);
  const now = new Date();

  if (!db) {
    // Development local store fallback
    const store = loadFileStore();
    const row: Price99BatchRow = {
      id: cuid(),
      batchId,
      action,
      productCount: items.length,
      itemsJson,
      createdBy,
      createdAt: now.toISOString(),
    };
    store.price99Batches = [row, ...(store.price99Batches || [])];
    saveFileStore(store);

    return {
      id: row.id,
      batchId: row.batchId,
      action: row.action as Price99Action,
      productCount: row.productCount,
      items,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    };
  }

  await ensurePrice99Table(db);

  if (db.price99Batch) {
    const created = await db.price99Batch.create({
      data: {
        batchId,
        action,
        productCount: items.length,
        itemsJson,
        createdBy,
        createdAt: now,
      },
    });

    return {
      id: created.id,
      batchId: created.batchId,
      action: created.action as Price99Action,
      productCount: created.productCount,
      items,
      createdBy: created.createdBy,
      createdAt: created.createdAt instanceof Date ? created.createdAt.toISOString() : String(created.createdAt),
    };
  }

  // Fallback to raw query if model delegate is unavailable
  const id = cuid();
  await db.$executeRawUnsafe(
    `INSERT INTO "Price99Batch" ("id", "batchId", "action", "productCount", "itemsJson", "createdBy", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    id,
    batchId,
    action,
    items.length,
    itemsJson,
    createdBy,
    now
  );

  return {
    id,
    batchId,
    action,
    productCount: items.length,
    items,
    createdBy,
    createdAt: now.toISOString(),
  };
}

/**
 * Lists 99 Price history batches sorted by newest first.
 */
export async function listPrice99Batches({
  q = "",
  action = "",
  limit = 100,
  dbOverride,
}: {
  q?: string;
  action?: string;
  limit?: number;
  dbOverride?: DbLike | null;
} = {}): Promise<Price99BatchRecord[]> {
  const db = dbOverride !== undefined ? dbOverride : getPrisma();
  const searchNeedle = q.trim().toLowerCase();
  const actionFilter = action.trim().toUpperCase();

  if (!db) {
    const store = loadFileStore();
    const rows = store.price99Batches || [];
    const filtered = rows.filter((r) => {
      if (actionFilter && r.action !== actionFilter) return false;
      if (searchNeedle) {
        const text = `${r.batchId} ${r.itemsJson} ${r.createdBy}`.toLowerCase();
        if (!text.includes(searchNeedle)) return false;
      }
      return true;
    });

    return filtered.slice(0, limit).map((r) => {
      let items: Price99Item[] = [];
      try {
        items = JSON.parse(r.itemsJson);
      } catch {
        items = [];
      }
      return {
        id: r.id,
        batchId: r.batchId,
        action: r.action as Price99Action,
        productCount: r.productCount,
        items,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
      };
    });
  }

  await ensurePrice99Table(db);

  if (db.price99Batch) {
    const where: any = {};
    if (actionFilter) where.action = actionFilter;
    if (searchNeedle) {
      where.OR = [
        { batchId: { contains: searchNeedle, mode: "insensitive" } },
        { itemsJson: { contains: searchNeedle, mode: "insensitive" } },
        { createdBy: { contains: searchNeedle, mode: "insensitive" } },
      ];
    }

    const rows = await db.price99Batch.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return rows.map((r: any) => {
      let items: Price99Item[] = [];
      try {
        items = JSON.parse(r.itemsJson);
      } catch {
        items = [];
      }
      return {
        id: r.id,
        batchId: r.batchId,
        action: r.action as Price99Action,
        productCount: r.productCount,
        items,
        createdBy: r.createdBy,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      };
    });
  }

  // Fallback to raw query
  const rawRows = await db.$queryRawUnsafe<any[]>(
    `SELECT "id", "batchId", "action", "productCount", "itemsJson", "createdBy", "createdAt"
     FROM "Price99Batch"
     ORDER BY "createdAt" DESC
     LIMIT $1`,
    limit
  );

  return (rawRows || []).map((r) => {
    let items: Price99Item[] = [];
    try {
      items = JSON.parse(r.itemsJson);
    } catch {
      items = [];
    }
    return {
      id: r.id,
      batchId: r.batchId,
      action: r.action as Price99Action,
      productCount: r.productCount,
      items,
      createdBy: r.createdBy,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    };
  });
}

/**
 * Retrieves a single batch by batchId.
 */
export async function getPrice99Batch(
  batchId: string,
  dbOverride?: DbLike | null
): Promise<Price99BatchRecord | null> {
  const db = dbOverride !== undefined ? dbOverride : getPrisma();
  if (!db) {
    const store = loadFileStore();
    const row = (store.price99Batches || []).find((b) => b.batchId === batchId);
    if (!row) return null;
    let items: Price99Item[] = [];
    try {
      items = JSON.parse(row.itemsJson);
    } catch {
      items = [];
    }
    return {
      id: row.id,
      batchId: row.batchId,
      action: row.action as Price99Action,
      productCount: row.productCount,
      items,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    };
  }

  await ensurePrice99Table(db);

  if (db.price99Batch) {
    const row = await db.price99Batch.findUnique({
      where: { batchId },
    });
    if (!row) return null;
    let items: Price99Item[] = [];
    try {
      items = JSON.parse(row.itemsJson);
    } catch {
      items = [];
    }
    return {
      id: row.id,
      batchId: row.batchId,
      action: row.action as Price99Action,
      productCount: row.productCount,
      items,
      createdBy: row.createdBy,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    };
  }

  const rows = await db.$queryRawUnsafe<any[]>(
    `SELECT "id", "batchId", "action", "productCount", "itemsJson", "createdBy", "createdAt"
     FROM "Price99Batch"
     WHERE "batchId" = $1 LIMIT 1`,
    batchId
  );
  if (!rows || !rows.length) return null;
  const r = rows[0];
  let items: Price99Item[] = [];
  try {
    items = JSON.parse(r.itemsJson);
  } catch {
    items = [];
  }
  return {
    id: r.id,
    batchId: r.batchId,
    action: r.action as Price99Action,
    productCount: r.productCount,
    items,
    createdBy: r.createdBy,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

