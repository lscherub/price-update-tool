-- 0009: Price Update Calendar, Scheduling & Automated Email Reminders
--
-- Strictly additive, backward-compatible, and idempotent:
--   * Adds nullable scheduling columns to PriceUpdateSession without modifying existing rows.
--   * Creates PriceUpdateReminder for persistent, idempotent email reminder tracking.
--   * Creates PriceUpdateScheduleHistory for scheduling/rescheduling/cancellation audit history.

ALTER TABLE "PriceUpdateSession" ADD COLUMN IF NOT EXISTS "scheduledEffectiveDate" DATE;
ALTER TABLE "PriceUpdateSession" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMPTZ;
ALTER TABLE "PriceUpdateSession" ADD COLUMN IF NOT EXISTS "scheduledBy" TEXT;
ALTER TABLE "PriceUpdateSession" ADD COLUMN IF NOT EXISTS "previousStatus" TEXT;
ALTER TABLE "PriceUpdateSession" ADD COLUMN IF NOT EXISTS "scheduleStatus" TEXT;
ALTER TABLE "PriceUpdateSession" ADD COLUMN IF NOT EXISTS "scheduleCancelledAt" TIMESTAMPTZ;
ALTER TABLE "PriceUpdateSession" ADD COLUMN IF NOT EXISTS "scheduleCancelledBy" TEXT;

CREATE INDEX IF NOT EXISTS "PriceUpdateSession_scheduledEffectiveDate_idx" ON "PriceUpdateSession"("scheduledEffectiveDate");
CREATE INDEX IF NOT EXISTS "PriceUpdateSession_scheduleStatus_idx" ON "PriceUpdateSession"("scheduleStatus");

CREATE TABLE IF NOT EXISTS "PriceUpdateReminder" (
  "id" TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "reminderType" TEXT NOT NULL,
  "scheduledReminderAt" TIMESTAMPTZ NOT NULL,
  "customRecipientsJson" TEXT,
  "resolvedRecipientsJson" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "processingStartedAt" TIMESTAMPTZ,
  "sentAt" TIMESTAMPTZ,
  "attemptedAt" TIMESTAMPTZ,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "nextRetryAt" TIMESTAMPTZ,
  "lastError" TEXT,
  "providerRequestId" TEXT,
  "providerEmailId" TEXT,
  "createdBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "PriceUpdateReminder_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "PriceUpdateSession"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PriceUpdateReminder_sessionId_idx" ON "PriceUpdateReminder"("sessionId");
CREATE INDEX IF NOT EXISTS "PriceUpdateReminder_status_scheduledReminderAt_idx" ON "PriceUpdateReminder"("status", "scheduledReminderAt");
CREATE INDEX IF NOT EXISTS "PriceUpdateReminder_status_nextRetryAt_idx" ON "PriceUpdateReminder"("status", "nextRetryAt");

CREATE TABLE IF NOT EXISTS "PriceUpdateScheduleHistory" (
  "id" TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "previousEffectiveDate" DATE,
  "newEffectiveDate" DATE,
  "performedBy" TEXT NOT NULL DEFAULT '',
  "detail" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "PriceUpdateScheduleHistory_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "PriceUpdateSession"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PriceUpdateScheduleHistory_sessionId_createdAt_idx" ON "PriceUpdateScheduleHistory"("sessionId", "createdAt");
