-- 0002: enforce exactly one row per Product."sku".
--
-- Why: the original schema (0001_init) had a NON-unique index on "sku" and the
-- importer upserted by SKU, so duplicated SKUs were possible. Duplicates make
-- price matching ambiguous, so the database must reject them.
--
-- This migration is safe and idempotent for every environment:
--   * fresh database created by 0001_init (no duplicates, no constraint yet),
--   * database created earlier via `prisma db push` (may already contain a
--     unique constraint/index named Product_sku_key, and may contain duplicates),
--   * re-running it is always a no-op.
-- Every statement is guarded, so `prisma migrate deploy` never fails halfway.

-- 1) Collapse duplicate SKUs before adding the constraint. The surviving row is
--    the most recently updated one (ties broken by id); price update rows are
--    re-pointed at it so no history is lost.
DO $$
DECLARE
  dup_sku TEXT;
  keep_id TEXT;
BEGIN
  FOR dup_sku IN
    SELECT "sku" FROM "Product" GROUP BY "sku" HAVING COUNT(*) > 1
  LOOP
    SELECT "id" INTO keep_id
      FROM "Product"
     WHERE "sku" = dup_sku
     ORDER BY "updatedAt" DESC, "id" ASC
     LIMIT 1;

    UPDATE "PriceUpdateItem"
       SET "productId" = keep_id
     WHERE "productId" IN (
       SELECT "id" FROM "Product" WHERE "sku" = dup_sku AND "id" <> keep_id
     );

    DELETE FROM "Product" WHERE "sku" = dup_sku AND "id" <> keep_id;
  END LOOP;
END
$$;

-- 2) Create the unique index on sku (same name Prisma generates for @unique).
--    IF NOT EXISTS makes this a no-op when a database was already created by
--    `prisma db push` / a previous constraint named Product_sku_key.
CREATE UNIQUE INDEX IF NOT EXISTS "Product_sku_key" ON "Product"("sku");

-- 3) The plain sku index is now redundant (the unique constraint indexes it).
DROP INDEX IF EXISTS "Product_sku_idx";

-- 4) Vendor uniqueness is enforced on "normalizedVendor" only, so renames and
--    trailing-space variants no longer collide. Drop the legacy constraint/index.
ALTER TABLE "VendorDiscount" DROP CONSTRAINT IF EXISTS "VendorDiscount_vendor_key";
DROP INDEX IF EXISTS "VendorDiscount_vendor_key";
