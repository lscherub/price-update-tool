/**
 * Idempotent, atomic background reminder processor for Vercel Cron.
 *
 * Duplicate-send prevention guarantees:
 * 1. Persistent PriceUpdateReminder rows with explicit state machine:
 *    SCHEDULED -> PROCESSING -> SENT | FAILED | CANCELLED | EXPIRED
 * 2. PostgreSQL atomic claim using `FOR UPDATE SKIP LOCKED` inside a single UPDATE
 *    so concurrent Vercel invocations / retries can NEVER claim the same reminder.
 * 3. SENT reminders are terminal and never re-claimed.
 * 4. Missed reminders (downtime/redeploy) are processed on the next run unless
 *    older than the expiry window (7 days overdue OR > 3 days past effective date),
 *    in which case they are explicitly marked EXPIRED with an audit reason.
 * 5. Retryable failures receive exponential backoff (15 min, 60 min) up to maxAttempts.
 */
import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";
import { loadFileStore, saveFileStore } from "./store";

/**
 * Constant-time verification of `Authorization: Bearer <CRON_SECRET>`.
 * Always fails closed when CRON_SECRET is missing or shorter than 16 chars.
 */
export function verifyCronAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  const auth = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!auth.startsWith(prefix)) return false;
  const provided = auth.slice(prefix.length).trim();
  if (!provided) return false;

  const expectedBuf = Buffer.from(secret, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
import { diffDateKeysDays, normalizeRecipientList, toDateKey, todayDateKeyInTimezone } from "./calendar";
import { getCalendarNotificationSettings } from "./notificationSettings";
import {
  buildReminderEmailContent,
  sendViaSmtp2go,
  type Smtp2goSender,
} from "./smtp2go";

export const MAX_REMINDERS_PER_RUN = 25;
export const STALE_PROCESSING_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_REMINDER_OVERDUE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days overdue
export const MAX_DAYS_PAST_EFFECTIVE_DATE = 3; // expire if > 3 days past effective date

export type ClaimedReminderRecord = {
  id: string;
  sessionId: string;
  reminderType: string;
  scheduledReminderAt: Date;
  customRecipientsJson: string | null;
  attemptCount: number;
  maxAttempts: number;
  vendor: string;
  worksheetName: string;
  sessionStatus: string;
  scheduleStatus: string | null;
  scheduledEffectiveDate: string | null;
};

export type ReminderRunSummary = {
  ok: true;
  skippedBecauseDisabled?: boolean;
  checkedAt: string;
  claimed: number;
  sent: number;
  failed: number;
  retriedScheduled: number;
  expired: number;
  cancelled: number;
  details: { reminderId: string; sessionId: string; outcome: string; detail?: string }[];
};

function computeNextRetryAt(attemptCount: number, now: Date): Date {
  // attemptCount 1 -> retry in 15 min; attemptCount 2 -> retry in 60 min
  const delayMinutes = attemptCount <= 1 ? 15 : 60;
  return new Date(now.getTime() + delayMinutes * 60 * 1000);
}

function parseJsonRecipients(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const { valid } = normalizeRecipientList(parsed);
    return valid;
  } catch {
    return null;
  }
}

/**
 * Atomically claim due reminders in PostgreSQL using `FOR UPDATE SKIP LOCKED`
 * so concurrent cron runs cannot claim or double-send the same reminder.
 */
async function claimDueRemindersPostgres(
  prisma: PrismaClient,
  now: Date,
  limit: number,
): Promise<ClaimedReminderRecord[]> {
  const staleCutoff = new Date(now.getTime() - STALE_PROCESSING_MS);

  const rows = await prisma.$queryRawUnsafe<
    {
      id: string;
      sessionId: string;
      reminderType: string;
      scheduledReminderAt: Date;
      customRecipientsJson: string | null;
      attemptCount: number;
      maxAttempts: number;
      vendor: string;
      worksheetName: string;
      sessionStatus: string;
      scheduleStatus: string | null;
      scheduledEffectiveDate: Date | null;
    }[]
  >(
    `
    WITH due AS (
      SELECT r."id"
      FROM "PriceUpdateReminder" r
      INNER JOIN "PriceUpdateSession" s ON s."id" = r."sessionId"
      WHERE (
        (r."status" = 'SCHEDULED' AND r."scheduledReminderAt" <= $1)
        OR (
          r."status" = 'FAILED'
          AND r."attemptCount" < r."maxAttempts"
          AND (r."nextRetryAt" IS NULL OR r."nextRetryAt" <= $1)
        )
        OR (
          r."status" = 'PROCESSING'
          AND r."processingStartedAt" IS NOT NULL
          AND r."processingStartedAt" <= $2
          AND r."attemptCount" < r."maxAttempts"
        )
      )
      ORDER BY r."scheduledReminderAt" ASC
      LIMIT $3
      FOR UPDATE OF r SKIP LOCKED
    ),
    claimed AS (
      UPDATE "PriceUpdateReminder" r
      SET
        "status" = 'PROCESSING',
        "processingStartedAt" = $1,
        "attemptedAt" = $1,
        "attemptCount" = r."attemptCount" + 1,
        "updatedAt" = $1
      FROM due
      WHERE r."id" = due."id"
      RETURNING
        r."id",
        r."sessionId",
        r."reminderType",
        r."scheduledReminderAt",
        r."customRecipientsJson",
        r."attemptCount",
        r."maxAttempts"
    )
    SELECT
      c."id",
      c."sessionId",
      c."reminderType",
      c."scheduledReminderAt",
      c."customRecipientsJson",
      c."attemptCount",
      c."maxAttempts",
      s."vendor",
      s."name" AS "worksheetName",
      s."status" AS "sessionStatus",
      s."scheduleStatus",
      s."scheduledEffectiveDate"
    FROM claimed c
    INNER JOIN "PriceUpdateSession" s ON s."id" = c."sessionId"
    `,
    now,
    staleCutoff,
    limit,
  );

  return rows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    reminderType: r.reminderType,
    scheduledReminderAt: new Date(r.scheduledReminderAt),
    customRecipientsJson: r.customRecipientsJson,
    attemptCount: Number(r.attemptCount),
    maxAttempts: Number(r.maxAttempts),
    vendor: r.vendor,
    worksheetName: r.worksheetName,
    sessionStatus: r.sessionStatus,
    scheduleStatus: r.scheduleStatus,
    scheduledEffectiveDate: toDateKey(r.scheduledEffectiveDate),
  }));
}

/** Dev file-store equivalent of atomic claim for local testing and unit tests. */
function claimDueRemindersFileStore(now: Date, limit: number): ClaimedReminderRecord[] {
  const store = loadFileStore();
  const staleCutoffMs = now.getTime() - STALE_PROCESSING_MS;
  const nowIso = now.toISOString();
  const sessionById = new Map(store.sessions.map((s) => [s.id, s]));
  const claimed: ClaimedReminderRecord[] = [];

  const eligible = (store.reminders ?? [])
    .filter((r) => {
      if (r.status === "SCHEDULED") return new Date(r.scheduledReminderAt).getTime() <= now.getTime();
      if (r.status === "FAILED") {
        if (r.attemptCount >= r.maxAttempts) return false;
        return !r.nextRetryAt || new Date(r.nextRetryAt).getTime() <= now.getTime();
      }
      if (r.status === "PROCESSING") {
        if (r.attemptCount >= r.maxAttempts) return false;
        return Boolean(r.processingStartedAt && new Date(r.processingStartedAt).getTime() <= staleCutoffMs);
      }
      return false;
    })
    .sort((a, b) => a.scheduledReminderAt.localeCompare(b.scheduledReminderAt))
    .slice(0, limit);

  for (const r of eligible) {
    const s = sessionById.get(r.sessionId);
    if (!s) continue;
    r.status = "PROCESSING";
    r.processingStartedAt = nowIso;
    r.attemptedAt = nowIso;
    r.attemptCount += 1;
    r.updatedAt = nowIso;
    claimed.push({
      id: r.id,
      sessionId: r.sessionId,
      reminderType: r.reminderType,
      scheduledReminderAt: new Date(r.scheduledReminderAt),
      customRecipientsJson: r.customRecipientsJson,
      attemptCount: r.attemptCount,
      maxAttempts: r.maxAttempts,
      vendor: s.vendor,
      worksheetName: s.name,
      sessionStatus: s.status,
      scheduleStatus: s.scheduleStatus ?? null,
      scheduledEffectiveDate: toDateKey(s.scheduledEffectiveDate),
    });
  }

  if (claimed.length > 0) saveFileStore(store);
  return claimed;
}

async function finalizeReminderRow(
  prisma: PrismaClient | null,
  reminderId: string,
  patch: {
    status: "SENT" | "FAILED" | "CANCELLED" | "EXPIRED";
    sentAt?: Date | null;
    nextRetryAt?: Date | null;
    lastError?: string | null;
    resolvedRecipientsJson?: string | null;
    providerRequestId?: string | null;
    providerEmailId?: string | null;
  },
  now: Date,
): Promise<void> {
  if (!prisma) {
    const store = loadFileStore();
    const row = (store.reminders ?? []).find((r) => r.id === reminderId);
    if (!row) return;
    row.status = patch.status;
    row.processingStartedAt = null;
    if (patch.sentAt !== undefined) row.sentAt = patch.sentAt ? patch.sentAt.toISOString() : null;
    if (patch.nextRetryAt !== undefined) row.nextRetryAt = patch.nextRetryAt ? patch.nextRetryAt.toISOString() : null;
    if (patch.lastError !== undefined) row.lastError = patch.lastError;
    if (patch.resolvedRecipientsJson !== undefined) row.resolvedRecipientsJson = patch.resolvedRecipientsJson;
    if (patch.providerRequestId !== undefined) row.providerRequestId = patch.providerRequestId;
    if (patch.providerEmailId !== undefined) row.providerEmailId = patch.providerEmailId;
    row.updatedAt = now.toISOString();
    saveFileStore(store);
    return;
  }

  await prisma.priceUpdateReminder.update({
    where: { id: reminderId },
    data: {
      status: patch.status,
      processingStartedAt: null,
      ...(patch.sentAt !== undefined ? { sentAt: patch.sentAt } : {}),
      ...(patch.nextRetryAt !== undefined ? { nextRetryAt: patch.nextRetryAt } : {}),
      ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
      ...(patch.resolvedRecipientsJson !== undefined ? { resolvedRecipientsJson: patch.resolvedRecipientsJson } : {}),
      ...(patch.providerRequestId !== undefined ? { providerRequestId: patch.providerRequestId } : {}),
      ...(patch.providerEmailId !== undefined ? { providerEmailId: patch.providerEmailId } : {}),
    },
  });
}

export async function processDueReminders(options: {
  prisma: PrismaClient | null;
  now?: Date;
  limit?: number;
  sender?: Smtp2goSender;
  /** Respect REMINDER_EMAILS_ENABLED unless explicitly bypassed (e.g. in unit tests). */
  bypassEnabledFlag?: boolean;
}): Promise<ReminderRunSummary> {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(1, options.limit ?? MAX_REMINDERS_PER_RUN), 100);
  const sender = options.sender ?? sendViaSmtp2go;

  if (!options.bypassEnabledFlag && process.env.REMINDER_EMAILS_ENABLED?.trim().toLowerCase() !== "true") {
    return {
      ok: true,
      skippedBecauseDisabled: true,
      checkedAt: now.toISOString(),
      claimed: 0,
      sent: 0,
      failed: 0,
      retriedScheduled: 0,
      expired: 0,
      cancelled: 0,
      details: [],
    };
  }

  const settings = await getCalendarNotificationSettings(options.prisma);
  const todayKey = todayDateKeyInTimezone(settings.timezone, now);

  const claimedRows = options.prisma
    ? await claimDueRemindersPostgres(options.prisma, now, limit)
    : claimDueRemindersFileStore(now, limit);

  const summary: ReminderRunSummary = {
    ok: true,
    checkedAt: now.toISOString(),
    claimed: claimedRows.length,
    sent: 0,
    failed: 0,
    retriedScheduled: 0,
    expired: 0,
    cancelled: 0,
    details: [],
  };

  for (const row of claimedRows) {
    // 1. Exclude cancelled/completed/unscheduled sessions
    if (
      row.sessionStatus !== "Scheduled" ||
      row.scheduleStatus !== "ACTIVE" ||
      !row.scheduledEffectiveDate
    ) {
      await finalizeReminderRow(
        options.prisma,
        row.id,
        {
          status: "CANCELLED",
          nextRetryAt: null,
          lastError: `Skipped because worksheet is no longer actively scheduled (status: ${row.sessionStatus}).`,
        },
        now,
      );
      summary.cancelled++;
      summary.details.push({
        reminderId: row.id,
        sessionId: row.sessionId,
        outcome: "CANCELLED",
        detail: `Session status is ${row.sessionStatus}`,
      });
      continue;
    }

    // 2. Expiry policy for very late/missed reminders (never silently discard — record EXPIRED)
    const overdueMs = now.getTime() - row.scheduledReminderAt.getTime();
    const daysPastEffective = diffDateKeysDays(row.scheduledEffectiveDate, todayKey);
    if (overdueMs > MAX_REMINDER_OVERDUE_MS || daysPastEffective > MAX_DAYS_PAST_EFFECTIVE_DATE) {
      const reason =
        daysPastEffective > MAX_DAYS_PAST_EFFECTIVE_DATE
          ? `Reminder expired because the effective date (${row.scheduledEffectiveDate}) passed more than ${MAX_DAYS_PAST_EFFECTIVE_DATE} days ago.`
          : `Reminder expired because it was overdue by more than 7 days.`;
      await finalizeReminderRow(
        options.prisma,
        row.id,
        { status: "EXPIRED", nextRetryAt: null, lastError: reason },
        now,
      );
      summary.expired++;
      summary.details.push({
        reminderId: row.id,
        sessionId: row.sessionId,
        outcome: "EXPIRED",
        detail: reason,
      });
      continue;
    }

    // 3. Resolve recipients (worksheet-specific override takes precedence over global defaults)
    const customRecips = parseJsonRecipients(row.customRecipientsJson);
    const recipients = customRecips !== null ? customRecips : settings.recipients;
    if (!recipients.length) {
      const reason = "No valid email recipients configured for this reminder.";
      await finalizeReminderRow(
        options.prisma,
        row.id,
        {
          status: "FAILED",
          nextRetryAt: null,
          lastError: reason,
          resolvedRecipientsJson: JSON.stringify([]),
        },
        now,
      );
      summary.failed++;
      summary.details.push({
        reminderId: row.id,
        sessionId: row.sessionId,
        outcome: "FAILED",
        detail: reason,
      });
      continue;
    }

    // 4. Build email and send via SMTP2GO
    const email = buildReminderEmailContent({
      sessionId: row.sessionId,
      vendor: row.vendor,
      worksheetName: row.worksheetName,
      effectiveDateKey: row.scheduledEffectiveDate,
      status: row.sessionStatus,
      reminderType: row.reminderType,
      timeZone: settings.timezone,
      now,
    });

    const result = await sender({
      to: recipients,
      subject: email.subject,
      textBody: email.textBody,
      htmlBody: email.htmlBody,
    });

    if (result.ok) {
      await finalizeReminderRow(
        options.prisma,
        row.id,
        {
          status: "SENT",
          sentAt: now,
          nextRetryAt: null,
          lastError: null,
          resolvedRecipientsJson: JSON.stringify(recipients),
          providerRequestId: result.requestId,
          providerEmailId: result.emailId,
        },
        now,
      );
      summary.sent++;
      summary.details.push({
        reminderId: row.id,
        sessionId: row.sessionId,
        outcome: "SENT",
        detail: result.emailId ?? undefined,
      });
    } else {
      const willRetry = result.retryable && row.attemptCount < row.maxAttempts;
      const nextRetryAt = willRetry ? computeNextRetryAt(row.attemptCount, now) : null;
      await finalizeReminderRow(
        options.prisma,
        row.id,
        {
          status: "FAILED",
          nextRetryAt,
          lastError: result.error.slice(0, 1000),
          resolvedRecipientsJson: JSON.stringify(recipients),
          providerRequestId: result.requestId ?? null,
        },
        now,
      );
      summary.failed++;
      if (willRetry) summary.retriedScheduled++;
      summary.details.push({
        reminderId: row.id,
        sessionId: row.sessionId,
        outcome: willRetry ? "FAILED_WILL_RETRY" : "FAILED",
        detail: result.error,
      });
    }
  }

  return summary;
}
