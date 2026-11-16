-- 0007: Ad Hoc Inventory Count Sheets
--
-- Independent count sheets for ad hoc store counts across any vendor/brand.
-- Supports custom columns: SKU/UPC, Brand, Description, Size Desc.,
-- and staff-entry columns: QQH, LAYWAY, PREPAID, Expiry, On Transfer.

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
