-- 0003: let users hand-enter (override) the Nearest 9 price.
--
-- Why: "Nearest 9" is calculated automatically. Users sometimes need to put a
-- custom price there instead, and that custom price must survive later
-- recalculations of other fields.
--
-- "nearest9" keeps holding the FINAL value used by flags, filters, sorting, the
-- CSV export and the Store Count PDF (so none of those change). The new
-- "nearest9Custom" column remembers only the manual override:
--   * NULL  -> no override, the automatic calculation wins,
--   * value -> the user typed this exact price.
-- Clearing the cell sets it back to NULL, restoring the automatic value.
--
-- Idempotent so it is safe on databases created by `prisma db push` as well as
-- by `prisma migrate deploy` (which also records this migration itself).

ALTER TABLE "PriceUpdateItem" ADD COLUMN IF NOT EXISTS "nearest9Custom" DECIMAL(12,2);
