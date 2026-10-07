/**
 * Last successful Full/All Inventory import timestamp.
 *
 * Single key/value row in AppSetting (key = LAST_FULL_IMPORT_KEY, value = ISO
 * timestamp). The timestamp is written ONLY after a Full/All Inventory import
 * succeeds — never on page loads, manual edits, Inactive List imports, failed
 * imports, or Clear Inventory. Raw SQL + CREATE TABLE IF NOT EXISTS keeps this
 * working even before the 0004 migration has been applied.
 */

export const LAST_FULL_IMPORT_KEY = "inventory_last_full_import";

export type MetaDbLike = {
  $queryRawUnsafe: <T = unknown>(sql: string, ...params: unknown[]) => Promise<T>;
  $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown>;
};

const ENSURE_SQL =
  `CREATE TABLE IF NOT EXISTS "AppSetting" (` +
  `"key" TEXT PRIMARY KEY, ` +
  `"value" TEXT NOT NULL DEFAULT '', ` +
  `"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()` +
  `)`;

async function ensureTable(db: MetaDbLike): Promise<void> {
  await db.$executeRawUnsafe(ENSURE_SQL);
}

/** ISO timestamp of the last successful full import, or null when never. */
export async function getLastFullImportAt(db: MetaDbLike): Promise<string | null> {
  try {
    await ensureTable(db);
    const rows = await db.$queryRawUnsafe<{ value: string }[]>(
      `SELECT "value" AS "value" FROM "AppSetting" WHERE "key" = $1 LIMIT 1`,
      LAST_FULL_IMPORT_KEY,
    );
    const raw = Array.isArray(rows) && rows.length ? String(rows[0]?.value ?? "").trim() : "";
    if (!raw) return null;
    const t = new Date(raw);
    if (Number.isNaN(t.getTime())) return null;
    return t.toISOString();
  } catch {
    return null;
  }
}

/** Record "now" as the last successful full import. Returns the ISO timestamp. */
export async function setLastFullImportNow(db: MetaDbLike, now: Date = new Date()): Promise<string> {
  const iso = now.toISOString();
  await ensureTable(db);
  await db.$executeRawUnsafe(
    `INSERT INTO "AppSetting" ("key", "value", "updatedAt") VALUES ($1, $2, now()) ` +
      `ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()`,
    LAST_FULL_IMPORT_KEY,
    iso,
  );
  return iso;
}
