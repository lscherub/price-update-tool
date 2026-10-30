-- 0006: Dedicated 99 Price Manager history batches
--
-- Why: Staff select products from All Inventory and export Amber POS update
-- spreadsheets with the `99 Price` column set to 'Y' (Check) or blank (Uncheck).
-- Every export creates an immutable history record that can be reopened,
-- viewed, and re-exported.

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

