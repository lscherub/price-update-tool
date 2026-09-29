-- Price Update Tool initial schema (apply in Supabase SQL editor or via prisma migrate)
CREATE TABLE IF NOT EXISTS "Product" (
  "id" TEXT PRIMARY KEY,
  "sku" TEXT NOT NULL,
  "normalizedSku" TEXT NOT NULL,
  "productNumber" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "vendor" TEXT NOT NULL DEFAULT '',
  "brand" TEXT NOT NULL DEFAULT '',
  "listCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "sizeDesc" TEXT NOT NULL DEFAULT '',
  "isInactive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "Product_normalizedSku_idx" ON "Product"("normalizedSku");
CREATE INDEX IF NOT EXISTS "Product_sku_idx" ON "Product"("sku");
CREATE INDEX IF NOT EXISTS "Product_vendor_idx" ON "Product"("vendor");
CREATE INDEX IF NOT EXISTS "Product_brand_idx" ON "Product"("brand");
CREATE INDEX IF NOT EXISTS "Product_isInactive_idx" ON "Product"("isInactive");

CREATE TABLE IF NOT EXISTS "VendorDiscount" (
  "id" TEXT PRIMARY KEY,
  "vendor" TEXT NOT NULL,
  "normalizedVendor" TEXT NOT NULL UNIQUE,
  "defaultDiscount" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "PriceUpdateSession" (
  "id" TEXT PRIMARY KEY,
  "vendor" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "notes" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "PriceUpdateSession_vendor_idx" ON "PriceUpdateSession"("vendor");
CREATE INDEX IF NOT EXISTS "PriceUpdateSession_status_idx" ON "PriceUpdateSession"("status");

CREATE TABLE IF NOT EXISTS "PriceUpdateItem" (
  "id" TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL REFERENCES "PriceUpdateSession"("id") ON DELETE CASCADE,
  "rawVendorSku" TEXT NOT NULL DEFAULT '',
  "cleanedSku" TEXT NOT NULL DEFAULT '',
  "cleanedOverridden" BOOLEAN NOT NULL DEFAULT false,
  "productId" TEXT REFERENCES "Product"("id") ON DELETE SET NULL,
  "productNumber" TEXT NOT NULL DEFAULT '',
  "productName" TEXT NOT NULL DEFAULT '',
  "brand" TEXT NOT NULL DEFAULT '',
  "vendor" TEXT NOT NULL DEFAULT '',
  "discount" DECIMAL(6,2),
  "currentListPrice" DECIMAL(12,2),
  "vendorListPriceNew" DECIMAL(12,2),
  "ourNewListPrice" DECIMAL(12,2),
  "marginDivisor" DECIMAL(10,4),
  "ourNewRetailPrice" DECIMAL(12,4),
  "oldRetailPrice" DECIMAL(12,2),
  "nearest9" DECIMAL(12,2),
  "notes" TEXT NOT NULL DEFAULT '',
  "isInactive" BOOLEAN NOT NULL DEFAULT false,
  "matched" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "PriceUpdateItem_sessionId_idx" ON "PriceUpdateItem"("sessionId");
CREATE INDEX IF NOT EXISTS "PriceUpdateItem_cleanedSku_idx" ON "PriceUpdateItem"("cleanedSku");
CREATE INDEX IF NOT EXISTS "PriceUpdateItem_matched_idx" ON "PriceUpdateItem"("matched");

CREATE TABLE IF NOT EXISTS "AppUser" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'admin',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ExportLog" (
  "id" TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL REFERENCES "PriceUpdateSession"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "detail" TEXT NOT NULL DEFAULT ''
);
