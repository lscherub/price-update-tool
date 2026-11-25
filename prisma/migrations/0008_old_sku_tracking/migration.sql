-- 0008: Old SKU tracking and optional old-to-new SKU replacement relationships on Product.
--
-- Backward-compatible and idempotent:
--   * All existing Product rows default to isOldSku = false with NULL relationship IDs.
--   * Bulk POS inventory upserts do not touch these columns, so manual Old SKU
--     flags and replacement links survive future inventory imports.
--   * Supports multi-step replacement chains (A -> B -> C) while preventing self-references.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isOldSku" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "supersededByProductId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "previousSkuProductId" TEXT;

CREATE INDEX IF NOT EXISTS "Product_isOldSku_idx" ON "Product"("isOldSku");
CREATE INDEX IF NOT EXISTS "Product_supersededByProductId_idx" ON "Product"("supersededByProductId");
CREATE INDEX IF NOT EXISTS "Product_previousSkuProductId_idx" ON "Product"("previousSkuProductId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Product_supersededByProductId_fkey'
  ) THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_supersededByProductId_fkey"
      FOREIGN KEY ("supersededByProductId") REFERENCES "Product"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Product_previousSkuProductId_fkey'
  ) THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_previousSkuProductId_fkey"
      FOREIGN KEY ("previousSkuProductId") REFERENCES "Product"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Product_supersededByProductId_not_self_check'
  ) THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_supersededByProductId_not_self_check"
      CHECK ("supersededByProductId" IS DISTINCT FROM "id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Product_previousSkuProductId_not_self_check'
  ) THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_previousSkuProductId_not_self_check"
      CHECK ("previousSkuProductId" IS DISTINCT FROM "id");
  END IF;
END $$;
