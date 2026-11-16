import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "./db";
import { cuid, loadFileStore, saveFileStore, type AdHocCountSheetRow, type AdHocCountItemRow } from "./store";
import { findProductsByRawSkus } from "./lookup";
import {
  defaultAdHocSheetName,
  analyzeDuplicates,
  type AdHocCountItemData,
  type AdHocCountSheetData,
  type AdHocCountSheetSummary,
  type AdHocSheetStatus,
  type ParsedBulkItem,
} from "./adhocCount";

export type DbLike = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe"> & {
  adHocCountSheet?: {
    create: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    findUnique: (args: any) => Promise<any | null>;
    update: (args: any) => Promise<any>;
    delete: (args: any) => Promise<any>;
  };
  adHocCountItem?: {
    create: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    findUnique?: (args: any) => Promise<any | null>;
    update: (args: any) => Promise<any>;
    deleteMany: (args: any) => Promise<{ count: number }>;
  };
};

const ENSURE_ADHOC_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS "AdHocCountSheet" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'In Progress',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "AdHocCountSheet_status_idx" ON "AdHocCountSheet"("status");
CREATE INDEX IF NOT EXISTS "AdHocCountSheet_createdAt_idx" ON "AdHocCountSheet"("createdAt");

CREATE TABLE IF NOT EXISTS "AdHocCountItem" (
  "id" TEXT PRIMARY KEY,
  "sheetId" TEXT NOT NULL,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "sku" TEXT NOT NULL DEFAULT '',
  "brand" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "sizeDesc" TEXT NOT NULL DEFAULT '',
  "matched" BOOLEAN NOT NULL DEFAULT false,
  "qqh" TEXT NOT NULL DEFAULT '',
  "layway" TEXT NOT NULL DEFAULT '',
  "prepaid" TEXT NOT NULL DEFAULT '',
  "expiry" TEXT NOT NULL DEFAULT '',
  "onTransfer" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "AdHocCountItem_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "AdHocCountSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AdHocCountItem_sheetId_idx" ON "AdHocCountItem"("sheetId");
CREATE INDEX IF NOT EXISTS "AdHocCountItem_orderIndex_idx" ON "AdHocCountItem"("orderIndex");
`;

let ensured = false;
export async function ensureAdHocCountTables(db: DbLike): Promise<void> {
  if (ensured) return;
  try {
    await db.$executeRawUnsafe(ENSURE_ADHOC_TABLES_SQL);
    ensured = true;
  } catch (e) {
    // If table already exists or migrations already handled it, continue
    console.warn("Could not ensure AdHoc tables:", e);
  }
}

/**
 * List all count sheets with summary info (itemCount, dates, status).
 */
export async function listAdHocSheets({
  search = "",
  status = "all",
  dbOverride,
}: {
  search?: string;
  status?: string;
  dbOverride?: DbLike | null;
} = {}): Promise<AdHocCountSheetSummary[]> {
  const db = dbOverride !== undefined ? dbOverride : getPrisma();

  if (db && db.adHocCountSheet) {
    await ensureAdHocCountTables(db);
    try {
      const where: any = {};
      if (status && status !== "all") {
        where.status = status;
      }
      if (search.trim()) {
        where.name = { contains: search.trim(), mode: "insensitive" };
      }

      const sheets = await db.adHocCountSheet.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        include: {
          _count: {
            select: { items: true },
          },
        },
      });

      return sheets.map((s: any) => ({
        id: s.id,
        name: s.name,
        status: s.status as AdHocSheetStatus,
        itemCount: s._count?.items ?? 0,
        createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
        updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : String(s.updatedAt),
      }));
    } catch {
      // Fallback if Prisma query encounters an error
    }
  }

  // Local JSON store fallback
  const store = loadFileStore();
  const sheets = store.adHocSheets || [];
  const items = store.adHocItems || [];

  const itemCounts = new Map<string, number>();
  for (const it of items) {
    itemCounts.set(it.sheetId, (itemCounts.get(it.sheetId) || 0) + 1);
  }

  let filtered = sheets;
  if (status && status !== "all") {
    filtered = filtered.filter((s) => s.status.toLowerCase() === status.toLowerCase());
  }
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter((s) => s.name.toLowerCase().includes(q));
  }

  return filtered
    .map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status as AdHocSheetStatus,
      itemCount: itemCounts.get(s.id) || 0,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/**
 * Get a single sheet by ID including all items ordered by orderIndex.
 */
export async function getAdHocSheet(
  id: string,
  { dbOverride }: { dbOverride?: DbLike | null } = {},
): Promise<AdHocCountSheetData | null> {
  const db = dbOverride !== undefined ? dbOverride : getPrisma();

  if (db && db.adHocCountSheet) {
    await ensureAdHocCountTables(db);
    try {
      const sheet = await db.adHocCountSheet.findUnique({
        where: { id },
        include: {
          items: {
            orderBy: { orderIndex: "asc" },
          },
        },
      });

      if (!sheet) return null;

      return {
        id: sheet.id,
        name: sheet.name,
        status: sheet.status as AdHocSheetStatus,
        createdAt: sheet.createdAt instanceof Date ? sheet.createdAt.toISOString() : String(sheet.createdAt),
        updatedAt: sheet.updatedAt instanceof Date ? sheet.updatedAt.toISOString() : String(sheet.updatedAt),
        itemCount: sheet.items.length,
        items: sheet.items.map((it: any) => ({
          id: it.id,
          sheetId: it.sheetId,
          orderIndex: it.orderIndex,
          sku: it.sku,
          brand: it.brand,
          description: it.description,
          sizeDesc: it.sizeDesc,
          matched: Boolean(it.matched),
          qqh: it.qqh,
          layway: it.layway,
          prepaid: it.prepaid,
          expiry: it.expiry,
          onTransfer: it.onTransfer,
          createdAt: it.createdAt instanceof Date ? it.createdAt.toISOString() : String(it.createdAt),
          updatedAt: it.updatedAt instanceof Date ? it.updatedAt.toISOString() : String(it.updatedAt),
        })),
      };
    } catch {
      // Fallback
    }
  }

  const store = loadFileStore();
  const sheet = (store.adHocSheets || []).find((s) => s.id === id);
  if (!sheet) return null;

  const items = (store.adHocItems || [])
    .filter((it) => it.sheetId === id)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((it) => ({
      ...it,
    }));

  return {
    id: sheet.id,
    name: sheet.name,
    status: sheet.status as AdHocSheetStatus,
    createdAt: sheet.createdAt,
    updatedAt: sheet.updatedAt,
    itemCount: items.length,
    items,
  };
}

/**
 * Create a new empty count sheet.
 */
export async function createAdHocSheet({
  name,
  dbOverride,
}: {
  name?: string;
  dbOverride?: DbLike | null;
} = {}): Promise<AdHocCountSheetData> {
  const db = dbOverride !== undefined ? dbOverride : getPrisma();
  const sheetName = (name && name.trim()) || defaultAdHocSheetName();
  const now = new Date();

  if (db && db.adHocCountSheet) {
    await ensureAdHocCountTables(db);
    try {
      const created = await db.adHocCountSheet.create({
        data: {
          name: sheetName,
          status: "In Progress",
        },
      });

      return {
        id: created.id,
        name: created.name,
        status: created.status as AdHocSheetStatus,
        createdAt: created.createdAt instanceof Date ? created.createdAt.toISOString() : String(created.createdAt),
        updatedAt: created.updatedAt instanceof Date ? created.updatedAt.toISOString() : String(created.updatedAt),
        itemCount: 0,
        items: [],
      };
    } catch {
      // Fallback
    }
  }

  const store = loadFileStore();
  const newRow: AdHocCountSheetRow = {
    id: cuid(),
    name: sheetName,
    status: "In Progress",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  store.adHocSheets = [newRow, ...(store.adHocSheets || [])];
  saveFileStore(store);

  return {
    id: newRow.id,
    name: newRow.name,
    status: newRow.status as AdHocSheetStatus,
    createdAt: newRow.createdAt,
    updatedAt: newRow.updatedAt,
    itemCount: 0,
    items: [],
  };
}

/**
 * Update sheet metadata (name, status).
 */
export async function updateAdHocSheet(
  id: string,
  updates: { name?: string; status?: AdHocSheetStatus },
  { dbOverride }: { dbOverride?: DbLike | null } = {},
): Promise<AdHocCountSheetData | null> {
  const db = dbOverride !== undefined ? dbOverride : getPrisma();
  const now = new Date();

  if (db && db.adHocCountSheet) {
    await ensureAdHocCountTables(db);
    try {
      const data: any = { updatedAt: now };
      if (updates.name !== undefined) data.name = updates.name.trim();
      if (updates.status !== undefined) data.status = updates.status;

      const updated = await db.adHocCountSheet.update({
        where: { id },
        data,
        include: {
          items: { orderBy: { orderIndex: "asc" } },
        },
      });

      return {
        id: updated.id,
        name: updated.name,
        status: updated.status as AdHocSheetStatus,
        createdAt: updated.createdAt instanceof Date ? updated.createdAt.toISOString() : String(updated.createdAt),
        updatedAt: updated.updatedAt instanceof Date ? updated.updatedAt.toISOString() : String(updated.updatedAt),
        itemCount: updated.items.length,
        items: updated.items.map((it: any) => ({
          ...it,
          createdAt: it.createdAt instanceof Date ? it.createdAt.toISOString() : String(it.createdAt),
          updatedAt: it.updatedAt instanceof Date ? it.updatedAt.toISOString() : String(it.updatedAt),
        })),
      };
    } catch {
      // Fallback
    }
  }

  const store = loadFileStore();
  const sheet = (store.adHocSheets || []).find((s) => s.id === id);
  if (!sheet) return null;

  if (updates.name !== undefined) sheet.name = updates.name.trim();
  if (updates.status !== undefined) sheet.status = updates.status;
  sheet.updatedAt = now.toISOString();

  saveFileStore(store);

  const items = (store.adHocItems || [])
    .filter((it) => it.sheetId === id)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  return {
    id: sheet.id,
    name: sheet.name,
    status: sheet.status as AdHocSheetStatus,
    createdAt: sheet.createdAt,
    updatedAt: sheet.updatedAt,
    itemCount: items.length,
    items,
  };
}

/**
 * Delete a sheet and all its items.
 * Guaranteed to never modify or delete All Inventory products.
 */
export async function deleteAdHocSheet(
  id: string,
  { dbOverride }: { dbOverride?: DbLike | null } = {},
): Promise<boolean> {
  const db = dbOverride !== undefined ? dbOverride : getPrisma();

  if (db && db.adHocCountSheet) {
    await ensureAdHocCountTables(db);
    try {
      await db.adHocCountSheet.delete({
        where: { id },
      });
      return true;
    } catch {
      // Fallback
    }
  }

  const store = loadFileStore();
  const initialLength = (store.adHocSheets || []).length;
  store.adHocSheets = (store.adHocSheets || []).filter((s) => s.id !== id);
  store.adHocItems = (store.adHocItems || []).filter((it) => it.sheetId !== id);

  saveFileStore(store);
  return (store.adHocSheets || []).length < initialLength;
}

/**
 * Look up SKUs against All Inventory database, analyzing matches, duplicates in list,
 * and whether they are already in the target sheet.
 */
export async function lookupSkusForAdHoc(
  skus: string[],
  sheetId?: string,
  { dbOverride }: { dbOverride?: DbLike | null } = {},
): Promise<ParsedBulkItem[]> {
  if (!skus.length) return [];

  // 1. Get existing sheet SKUs if sheetId is provided
  let existingSkus = new Set<string>();
  if (sheetId) {
    const sheet = await getAdHocSheet(sheetId, { dbOverride });
    if (sheet) {
      existingSkus = new Set(sheet.items.map((it) => it.sku.trim().toLowerCase()));
    }
  }

  // 2. Analyze duplicates in pasted list & sheet
  const { normalizedEntries } = analyzeDuplicates(skus, existingSkus);

  // 3. Query All Inventory using existing lookup utility
  const productMatches = await findProductsByRawSkus(skus);

  // 4. Map into ParsedBulkItem array
  return normalizedEntries.map(({ raw, isDuplicateInList, isAlreadyInSheet }) => {
    const matchedProduct = productMatches.get(raw);
    const matched = Boolean(matchedProduct);

    return {
      raw,
      sku: raw,
      brand: matchedProduct?.brand || "",
      description: matchedProduct?.description || (matched ? "" : "Not Found"),
      sizeDesc: matchedProduct?.sizeDesc || "",
      matched,
      isDuplicateInList,
      isAlreadyInSheet,
      // Default selection: true unless it's a duplicate in the list or already in sheet
      selected: !isDuplicateInList && !isAlreadyInSheet,
    };
  });
}

/**
 * Add items to a count sheet.
 * Automatically looks up missing product details from All Inventory.
 */
export async function addAdHocItems(
  sheetId: string,
  itemsToAdd: Array<{
    sku: string;
    brand?: string;
    description?: string;
    sizeDesc?: string;
    matched?: boolean;
    qqh?: string;
    layway?: string;
    prepaid?: string;
    expiry?: string;
    onTransfer?: string;
  }>,
  { dbOverride }: { dbOverride?: DbLike | null } = {},
): Promise<AdHocCountItemData[]> {
  if (!itemsToAdd.length) return [];

  const db = dbOverride !== undefined ? dbOverride : getPrisma();
  const currentSheet = await getAdHocSheet(sheetId, { dbOverride });
  if (!currentSheet) throw new Error(`Sheet ${sheetId} not found`);

  // Resolve product details from All Inventory for SKUs missing brand/description
  const skusToLookup = itemsToAdd
    .filter((it) => it.matched === undefined || (!it.brand && !it.description))
    .map((it) => it.sku);

  const productMatches = skusToLookup.length ? await findProductsByRawSkus(skusToLookup) : new Map();

  let nextOrderIndex = currentSheet.items.length;
  const now = new Date();

  const preparedRows: Array<{
    id: string;
    sheetId: string;
    orderIndex: number;
    sku: string;
    brand: string;
    description: string;
    sizeDesc: string;
    matched: boolean;
    qqh: string;
    layway: string;
    prepaid: string;
    expiry: string;
    onTransfer: string;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  for (const it of itemsToAdd) {
    const rawSku = String(it.sku ?? "").trim();
    const match = productMatches.get(rawSku);

    const brand = it.brand !== undefined ? it.brand : (match?.brand || "");
    const description = it.description !== undefined
      ? it.description
      : (match?.description || (match ? "" : "Not Found"));
    const sizeDesc = it.sizeDesc !== undefined ? it.sizeDesc : (match?.sizeDesc || "");
    const matched = it.matched !== undefined ? it.matched : Boolean(match);

    preparedRows.push({
      id: cuid(),
      sheetId,
      orderIndex: nextOrderIndex++,
      sku: rawSku,
      brand,
      description,
      sizeDesc,
      matched,
      qqh: String(it.qqh ?? "").trim(),
      layway: String(it.layway ?? "").trim(),
      prepaid: String(it.prepaid ?? "").trim(),
      expiry: String(it.expiry ?? "").trim(),
      onTransfer: String(it.onTransfer ?? "").trim(),
      createdAt: now,
      updatedAt: now,
    });
  }

  if (db && db.adHocCountItem) {
    await ensureAdHocCountTables(db);
    try {
      for (const row of preparedRows) {
        await db.adHocCountItem.create({
          data: row,
        });
      }
      // Update sheet updatedAt
      if (db.adHocCountSheet) {
        await db.adHocCountSheet.update({
          where: { id: sheetId },
          data: { updatedAt: now },
        });
      }

      const refreshed = await getAdHocSheet(sheetId, { dbOverride: db });
      return refreshed?.items || [];
    } catch {
      // Fallback
    }
  }

  const store = loadFileStore();
  const currentItems = store.adHocItems || [];

  const newItems: AdHocCountItemRow[] = preparedRows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  store.adHocItems = [...currentItems, ...newItems];

  const sheet = (store.adHocSheets || []).find((s) => s.id === sheetId);
  if (sheet) sheet.updatedAt = now.toISOString();

  saveFileStore(store);

  return store.adHocItems
    .filter((it) => it.sheetId === sheetId)
    .sort((a, b) => a.orderIndex - b.orderIndex);
}

/**
 * Update an existing item row.
 * When SKU/UPC is edited:
 * - Searches All Inventory again
 * - Refreshes Brand, Description, Size Desc.
 * - Flags as Not Found if missing
 * - STRICT REQUIREMENT: Preserves existing staff-entered QQH, LAYWAY, PREPAID, Expiry, On Transfer!
 */
export async function updateAdHocItem(
  sheetId: string,
  itemId: string,
  updates: Partial<AdHocCountItemData>,
  { dbOverride }: { dbOverride?: DbLike | null } = {},
): Promise<AdHocCountItemData | null> {
  const currentSheet = await getAdHocSheet(sheetId, { dbOverride });
  if (!currentSheet) return null;

  const existingItem = currentSheet.items.find((it) => it.id === itemId);
  if (!existingItem) return null;

  const now = new Date();
  const isSkuChanged = updates.sku !== undefined && updates.sku.trim() !== existingItem.sku.trim();

  let newBrand = existingItem.brand;
  let newDesc = existingItem.description;
  let newSize = existingItem.sizeDesc;
  let newMatched = existingItem.matched;
  const newSku = updates.sku !== undefined ? updates.sku.trim() : existingItem.sku;

  if (isSkuChanged) {
    const matches = await findProductsByRawSkus([newSku]);
    const match = matches.get(newSku);
    if (match) {
      newBrand = match.brand || "";
      newDesc = match.description || "";
      newSize = match.sizeDesc || "";
      newMatched = true;
    } else {
      newBrand = "";
      newDesc = "Not Found";
      newSize = "";
      newMatched = false;
    }
  } else {
    if (updates.brand !== undefined) newBrand = updates.brand;
    if (updates.description !== undefined) newDesc = updates.description;
    if (updates.sizeDesc !== undefined) newSize = updates.sizeDesc;
    if (updates.matched !== undefined) newMatched = updates.matched;
  }

  // Preserve staff-entered fields unless explicitly provided in updates
  const newQqh = updates.qqh !== undefined ? updates.qqh : existingItem.qqh;
  const newLayway = updates.layway !== undefined ? updates.layway : existingItem.layway;
  const newPrepaid = updates.prepaid !== undefined ? updates.prepaid : existingItem.prepaid;
  const newExpiry = updates.expiry !== undefined ? updates.expiry : existingItem.expiry;
  const newOnTransfer = updates.onTransfer !== undefined ? updates.onTransfer : existingItem.onTransfer;
  const newOrderIndex = updates.orderIndex !== undefined ? updates.orderIndex : existingItem.orderIndex;

  const db = dbOverride !== undefined ? dbOverride : getPrisma();

  if (db && db.adHocCountItem) {
    await ensureAdHocCountTables(db);
    try {
      const updated = await db.adHocCountItem.update({
        where: { id: itemId },
        data: {
          sku: newSku,
          brand: newBrand,
          description: newDesc,
          sizeDesc: newSize,
          matched: newMatched,
          qqh: newQqh,
          layway: newLayway,
          prepaid: newPrepaid,
          expiry: newExpiry,
          onTransfer: newOnTransfer,
          orderIndex: newOrderIndex,
          updatedAt: now,
        },
      });

      if (db.adHocCountSheet) {
        await db.adHocCountSheet.update({
          where: { id: sheetId },
          data: { updatedAt: now },
        });
      }

      return {
        id: updated.id,
        sheetId: updated.sheetId,
        orderIndex: updated.orderIndex,
        sku: updated.sku,
        brand: updated.brand,
        description: updated.description,
        sizeDesc: updated.sizeDesc,
        matched: Boolean(updated.matched),
        qqh: updated.qqh,
        layway: updated.layway,
        prepaid: updated.prepaid,
        expiry: updated.expiry,
        onTransfer: updated.onTransfer,
        createdAt: updated.createdAt instanceof Date ? updated.createdAt.toISOString() : String(updated.createdAt),
        updatedAt: updated.updatedAt instanceof Date ? updated.updatedAt.toISOString() : String(updated.updatedAt),
      };
    } catch {
      // Fallback
    }
  }

  const store = loadFileStore();
  const item = (store.adHocItems || []).find((it) => it.id === itemId && it.sheetId === sheetId);
  if (!item) return null;

  item.sku = newSku;
  item.brand = newBrand;
  item.description = newDesc;
  item.sizeDesc = newSize;
  item.matched = newMatched;
  item.qqh = newQqh;
  item.layway = newLayway;
  item.prepaid = newPrepaid;
  item.expiry = newExpiry;
  item.onTransfer = newOnTransfer;
  item.orderIndex = newOrderIndex;
  item.updatedAt = now.toISOString();

  const sheet = (store.adHocSheets || []).find((s) => s.id === sheetId);
  if (sheet) sheet.updatedAt = now.toISOString();

  saveFileStore(store);

  return { ...item };
}

/**
 * Bulk sync or reorder items in a sheet.
 */
export async function syncAdHocItems(
  sheetId: string,
  items: Array<{
    id?: string;
    sku: string;
    brand?: string;
    description?: string;
    sizeDesc?: string;
    matched?: boolean;
    qqh?: string;
    layway?: string;
    prepaid?: string;
    expiry?: string;
    onTransfer?: string;
    orderIndex?: number;
  }>,
  { dbOverride }: { dbOverride?: DbLike | null } = {},
): Promise<AdHocCountItemData[]> {
  const db = dbOverride !== undefined ? dbOverride : getPrisma();
  const now = new Date();

  // If replacing entirely or syncing, we can update existing and create new
  if (db && db.adHocCountItem) {
    await ensureAdHocCountTables(db);
    try {
      // Remove old items not present in incoming list if id is specified
      const incomingIds = items.map((it) => it.id).filter(Boolean) as string[];
      if (incomingIds.length) {
        await db.adHocCountItem.deleteMany({
          where: { sheetId, id: { notIn: incomingIds } },
        });
      } else {
        await db.adHocCountItem.deleteMany({
          where: { sheetId },
        });
      }

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const rowData = {
          orderIndex: it.orderIndex !== undefined ? it.orderIndex : i,
          sku: String(it.sku ?? "").trim(),
          brand: String(it.brand ?? ""),
          description: String(it.description ?? ""),
          sizeDesc: String(it.sizeDesc ?? ""),
          matched: Boolean(it.matched),
          qqh: String(it.qqh ?? "").trim(),
          layway: String(it.layway ?? "").trim(),
          prepaid: String(it.prepaid ?? "").trim(),
          expiry: String(it.expiry ?? "").trim(),
          onTransfer: String(it.onTransfer ?? "").trim(),
          updatedAt: now,
        };

        if (it.id) {
          await db.adHocCountItem.update({
            where: { id: it.id },
            data: rowData,
          });
        } else {
          await db.adHocCountItem.create({
            data: {
              ...rowData,
              id: cuid(),
              sheetId,
              createdAt: now,
            },
          });
        }
      }

      if (db.adHocCountSheet) {
        await db.adHocCountSheet.update({
          where: { id: sheetId },
          data: { updatedAt: now },
        });
      }

      const refreshed = await getAdHocSheet(sheetId, { dbOverride: db });
      return refreshed?.items || [];
    } catch {
      // Fallback
    }
  }

  const store = loadFileStore();
  const incomingIds = new Set(items.map((it) => it.id).filter(Boolean));

  // Remove deleted items from this sheet
  store.adHocItems = (store.adHocItems || []).filter(
    (it) => it.sheetId !== sheetId || incomingIds.has(it.id),
  );

  const existingMap = new Map((store.adHocItems || []).map((it) => [it.id, it]));

  const updatedItems: AdHocCountItemRow[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const existing = it.id ? existingMap.get(it.id) : null;

    if (existing) {
      existing.orderIndex = it.orderIndex !== undefined ? it.orderIndex : i;
      existing.sku = String(it.sku ?? "").trim();
      existing.brand = String(it.brand ?? "");
      existing.description = String(it.description ?? "");
      existing.sizeDesc = String(it.sizeDesc ?? "");
      existing.matched = Boolean(it.matched);
      existing.qqh = String(it.qqh ?? "").trim();
      existing.layway = String(it.layway ?? "").trim();
      existing.prepaid = String(it.prepaid ?? "").trim();
      existing.expiry = String(it.expiry ?? "").trim();
      existing.onTransfer = String(it.onTransfer ?? "").trim();
      existing.updatedAt = now.toISOString();
      updatedItems.push(existing);
    } else {
      const created: AdHocCountItemRow = {
        id: cuid(),
        sheetId,
        orderIndex: it.orderIndex !== undefined ? it.orderIndex : i,
        sku: String(it.sku ?? "").trim(),
        brand: String(it.brand ?? ""),
        description: String(it.description ?? ""),
        sizeDesc: String(it.sizeDesc ?? ""),
        matched: Boolean(it.matched),
        qqh: String(it.qqh ?? "").trim(),
        layway: String(it.layway ?? "").trim(),
        prepaid: String(it.prepaid ?? "").trim(),
        expiry: String(it.expiry ?? "").trim(),
        onTransfer: String(it.onTransfer ?? "").trim(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      store.adHocItems.push(created);
      updatedItems.push(created);
    }
  }

  const sheet = (store.adHocSheets || []).find((s) => s.id === sheetId);
  if (sheet) sheet.updatedAt = now.toISOString();

  saveFileStore(store);

  return updatedItems.sort((a, b) => a.orderIndex - b.orderIndex);
}

/**
 * Delete items from a count sheet (selected IDs or all items).
 */
export async function deleteAdHocItems(
  sheetId: string,
  {
    itemIds,
    all = false,
    dbOverride,
  }: {
    itemIds?: string[];
    all?: boolean;
    dbOverride?: DbLike | null;
  },
): Promise<number> {
  const db = dbOverride !== undefined ? dbOverride : getPrisma();
  const now = new Date();

  if (db && db.adHocCountItem) {
    await ensureAdHocCountTables(db);
    try {
      let count = 0;
      if (all) {
        const res = await db.adHocCountItem.deleteMany({ where: { sheetId } });
        count = res.count;
      } else if (itemIds && itemIds.length) {
        const res = await db.adHocCountItem.deleteMany({
          where: { sheetId, id: { in: itemIds } },
        });
        count = res.count;
      }

      if (db.adHocCountSheet) {
        await db.adHocCountSheet.update({
          where: { id: sheetId },
          data: { updatedAt: now },
        });
      }

      return count;
    } catch {
      // Fallback
    }
  }

  const store = loadFileStore();
  const initialLength = (store.adHocItems || []).length;

  if (all) {
    store.adHocItems = (store.adHocItems || []).filter((it) => it.sheetId !== sheetId);
  } else if (itemIds && itemIds.length) {
    const idSet = new Set(itemIds);
    store.adHocItems = (store.adHocItems || []).filter(
      (it) => it.sheetId !== sheetId || !idSet.has(it.id),
    );
  }

  const removed = initialLength - (store.adHocItems || []).length;
  const sheet = (store.adHocSheets || []).find((s) => s.id === sheetId);
  if (sheet) sheet.updatedAt = now.toISOString();

  saveFileStore(store);
  return removed;
}
