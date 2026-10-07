-- 0004: remember when the last successful Full/All Inventory import finished.
--
-- Why: the Inventory page shows "Last imported: ..." next to the product count.
-- The timestamp must ONLY change after a Full/All Inventory import succeeds —
-- never on page loads, manual edits, Inactive List imports, or failed imports.
--
-- AppSetting is a tiny key/value table (key = 'inventory_last_full_import').
-- Idempotent so it is safe on databases created by `prisma db push` as well as
-- by `prisma migrate deploy`.
CREATE TABLE IF NOT EXISTS "AppSetting" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);