-- 0005: brand-specific vendor discounts (Ecotrend default 10%, Provita 5%, ...).
--
-- Why: a vendor can have a default discount plus per-brand overrides linked to
-- that vendor (same brand may link to multiple vendors as separate rows).
--
-- BrandDiscount stores one row per (vendor, brand) pair:
--   * (normalizedVendor, normalizedBrand) is UNIQUE to prevent duplicates.
--   * VendorDiscount rows are untouched (existing defaults migrate as-is).
--   * Lookup priority: exact Vendor+Brand match -> vendor default -> 0%.
--
-- Idempotent so it is safe on databases created by `prisma db push` as well as
-- by `prisma migrate deploy` (which also records this migration itself).

CREATE TABLE IF NOT EXISTS "BrandDiscount" (
  "id" TEXT PRIMARY KEY,
  "brand" TEXT NOT NULL,
  "normalizedBrand" TEXT NOT NULL DEFAULT '',
  "vendor" TEXT NOT NULL DEFAULT '',
  "normalizedVendor" TEXT NOT NULL DEFAULT '',
  "defaultDiscount" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BrandDiscount_normalizedVendor_normalizedBrand_key'
  ) THEN
    ALTER TABLE "BrandDiscount"
      ADD CONSTRAINT "BrandDiscount_normalizedVendor_normalizedBrand_key"
      UNIQUE ("normalizedVendor", "normalizedBrand");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "BrandDiscount_normalizedVendor_idx" ON "BrandDiscount"("normalizedVendor");
CREATE INDEX IF NOT EXISTS "BrandDiscount_normalizedBrand_idx" ON "BrandDiscount"("normalizedBrand");
