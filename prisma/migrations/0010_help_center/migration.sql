-- 0010: Application-Wide Help Centre / Knowledge Base & SOP Centre
--
-- Strictly additive, backward-compatible, and idempotent:
--   * Creates HelpCategory, HelpArticle, HelpArticleRevision, and HelpImage tables.
--   * Never alters, drops, or modifies any existing pricing, inventory, calendar, or auth tables.

CREATE TABLE IF NOT EXISTS "HelpCategory" (
  "id" TEXT PRIMARY KEY,
  "slug" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "icon" TEXT NOT NULL DEFAULT 'book',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "HelpCategory_sortOrder_idx" ON "HelpCategory"("sortOrder");

CREATE TABLE IF NOT EXISTS "HelpArticle" (
  "id" TEXT PRIMARY KEY,
  "categoryId" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "draftTitle" TEXT NOT NULL,
  "draftSummary" TEXT NOT NULL DEFAULT '',
  "draftContentJson" TEXT NOT NULL,
  "publishedTitle" TEXT,
  "publishedSummary" TEXT,
  "publishedContentJson" TEXT,
  "hasUnpublishedChanges" BOOLEAN NOT NULL DEFAULT false,
  "relatedSlugsJson" TEXT NOT NULL DEFAULT '[]',
  "contextKeysJson" TEXT NOT NULL DEFAULT '[]',
  "needsReview" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "authorEmail" TEXT NOT NULL DEFAULT '',
  "updatedByEmail" TEXT NOT NULL DEFAULT '',
  "publishedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "HelpArticle_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "HelpCategory"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "HelpArticle_categoryId_sortOrder_idx" ON "HelpArticle"("categoryId", "sortOrder");
CREATE INDEX IF NOT EXISTS "HelpArticle_status_idx" ON "HelpArticle"("status");

CREATE TABLE IF NOT EXISTS "HelpArticleRevision" (
  "id" TEXT PRIMARY KEY,
  "articleId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '',
  "contentJson" TEXT NOT NULL,
  "eventType" TEXT NOT NULL DEFAULT 'DRAFT_SAVED',
  "editorEmail" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "HelpArticleRevision_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "HelpArticle"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "HelpArticleRevision_articleId_version_idx" ON "HelpArticleRevision"("articleId", "version");

CREATE TABLE IF NOT EXISTS "HelpImage" (
  "id" TEXT PRIMARY KEY,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storageProvider" TEXT NOT NULL DEFAULT 'database',
  "storagePath" TEXT,
  "data" BYTEA,
  "altText" TEXT NOT NULL DEFAULT '',
  "caption" TEXT NOT NULL DEFAULT '',
  "uploadedBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "HelpImage_createdAt_idx" ON "HelpImage"("createdAt");
