/**
 * Idempotent, atomic background reminder processor & diagnostics.
 *
 * Duplicate-send prevention guarantees:
 * 1. Persistent PriceUpdateReminder rows with explicit state machine:
 *    SCHEDULED -> PROCESSING -> SENT | FAILED | CANCELLED | EXPIRED
 * 2. PostgreSQL atomic claim using `FOR UPDATE SKIP LOCKED` inside a single fast UPDATE
 *    (commits immediately before the HTTP call — never holds a DB transaction open while
 *    waiting for SMTP2GO).
 * 3. SENT reminders are terminal and never re-claimed.
 * 4. Missed reminders (downtime/redeploy) are processed on the next run unless
 *    older than the expiry window (7 days overdue OR > 3 days past effective date),
 *    in which case they are explicitly marked EXPIRED with an audit reason.
 * 5. Retryable failures receive controlled exponential backoff (15 min, 60 min) up to maxAttempts;
 *    request timeouts do not auto-retry to avoid duplicate delivery.
 */
import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";
import { cuid, loadFileStore, saveFileStore } from "./store";
import { diffDateKeysDays, normalizeRecipientList, toDateKey, todayDateKeyInTimezone } from "./calendar";
import {
  appendReminderRunHistory,
  getCalendarNotificationSettings,
  getReminderRunHistory,
  type ReminderRunHistoryEntry,
} from "./notificationSettings";
import {
  buildReminderEmailContent,
  getSmtp2goPublicStatus,
  sendViaSmtp2go,
  type Smtp2goPublicStatus,
  type Smtp2goSender,
} from "./smtp2go";

export const SUPABASE_CRON_JOB_NAME = "process-price-update-reminders";

/**
 * Constant-time verification of `Authorization: Bearer <CRON_SECRET>`.
 * Always fails closed when CRON_SECRET is missing or shorter than 8 chars.
 * (32+ random characters via `openssl rand -hex 32` is strongly recommended;
 * secrets between 8 and 15 chars are accepted so valid configured secrets
 * don't silently 401, while Settings diagnostics flags them as weak.)
 */
export function verifyCronAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 8) return false;
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
  source: "cron" | "manual";
  claimed: number;
  attempted: number;
  sent: number;
  failed: number;
  retriedScheduled: number;
  expired: number;
  cancelled: number;
  details: { reminderId: string; sessionId: string; outcome: string; detail?: string }[];
};

export type SchedulerOperationalState =
  | "operational"
  | "failing"
  | "paused"
  | "configured_unverified"
  | "unconfigured";

export type ReminderDiagnostics = {
  checkedAt: string;
  timezone: string;
  scheduler: {
    provider: "supabase_pg_cron" | "unconfigured";
    operationalState: SchedulerOperationalState;
    operationalReason: string;
    jobName: string;
    pgCronInstalled: boolean;
    pgNetInstalled: boolean;
    jobFound: boolean;
    active: boolean;
    schedule: string | null;
    scheduleLabel: string | null;
    nextExpectedRunAt: string | null;
    lastCronJobRunAt: string | null;
    lastCronJobStatus: string | null;
    lastCronJobMessage: string | null;
    lastHttpRequestAt: string | null;
    lastHttpStatusCode: number | null;
    lastHttpError: string | null;
    lastSuccessfulHttpRequestAt: string | null;
  };
  counts: {
    pending: number;
    due: number;
    processing: number;
    sent: number;
    failed: number;
    expired: number;
  };
  lastExecution: ReminderRunHistoryEntry | null;
  lastCronExecution: ReminderRunHistoryEntry | null;
  lastSuccessfulCronExecution: ReminderRunHistoryEntry | null;
  lastSuccessfulExecution: ReminderRunHistoryEntry | null;
  lastFailedExecution: ReminderRunHistoryEntry | null;
  lastError: string | null;
  history: ReminderRunHistoryEntry[];
  emailConfig: Smtp2goPublicStatus;
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

/** Human-friendly label + delivery delay description for common cron schedules. */
export function describeCronSchedule(expr: string | null | undefined): string | null {
  if (!expr) return null;
  const s = expr.trim();
  if (s === "* * * * *") return "Every minute (testing — up to ~1 min delay)";
  const everyMin = /^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/.exec(s);
  if (everyMin) return `Every ${everyMin[1]} minutes (up to ${everyMin[1]} min delay)`;
  if (/^\d+\s+\*\s+\*\s+\*\s+\*$/.test(s)) return "Every hour (up to 1 hour delay)";
  const daily = /^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/.exec(s);
  if (daily) {
    const hh = String(Number(daily[2])).padStart(2, "0");
    const mm = String(Number(daily[1])).padStart(2, "0");
    return `Once daily at ${hh}:${mm} UTC (up to 24 hr delay for custom times)`;
  }
  return `Custom cron (${s})`;
}

/** Compute next UTC run timestamp for standard 5-field cron expressions. */
export function computeNextCronRun(expr: string | null | undefined, now: Date = new Date()): string | null {
  if (!expr) return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minPart, hourPart, domPart, monPart, dowPart] = parts;
  if (domPart !== "*" || monPart !== "*" || dowPart !== "*") return null;

  const base = new Date(now.getTime());
  base.setUTCSeconds(0, 0);
  base.setUTCMinutes(base.getUTCMinutes() + 1);

  if (minPart === "*" && hourPart === "*") {
    return base.toISOString();
  }
  const stepMin = /^\*\/(\d+)$/.exec(minPart);
  if (stepMin && hourPart === "*") {
    const step = Number(stepMin[1]);
    if (!Number.isInteger(step) || step <= 0 || step > 60) return null;
    const rem = base.getUTCMinutes() % step;
    if (rem !== 0) base.setUTCMinutes(base.getUTCMinutes() + (step - rem));
    return base.toISOString();
  }
  if (/^\d+$/.test(minPart) && hourPart === "*") {
    const targetMin = Number(minPart);
    if (targetMin < 0 || targetMin > 59) return null;
    if (base.getUTCMinutes() > targetMin) {
      base.setUTCHours(base.getUTCHours() + 1);
    }
    base.setUTCMinutes(targetMin);
    return base.toISOString();
  }
  if (/^\d+$/.test(minPart) && /^\d+$/.test(hourPart)) {
    const targetMin = Number(minPart);
    const targetHour = Number(hourPart);
    if (targetMin < 0 || targetMin > 59 || targetHour < 0 || targetHour > 23) return null;
    const cand = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      targetHour,
      targetMin,
      0,
      0,
    ));
    if (cand.getTime() <= now.getTime()) {
      cand.setUTCDate(cand.getUTCDate() + 1);
    }
    return cand.toISOString();
  }
  return null;
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
          AND r."nextRetryAt" IS NOT NULL
          AND r."nextRetryAt" <= $1
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
        return Boolean(r.nextRetryAt && new Date(r.nextRetryAt).getTime() <= now.getTime());
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
  source?: "cron" | "manual";
  triggeredBy?: string;
  /** Respect REMINDER_EMAILS_ENABLED unless explicitly bypassed (e.g. in unit tests). */
  bypassEnabledFlag?: boolean;
  /** Persist execution summary into AppSetting run history (defaults to true). */
  recordHistory?: boolean;
}): Promise<ReminderRunSummary> {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(1, options.limit ?? MAX_REMINDERS_PER_RUN), 100);
  const sender = options.sender ?? sendViaSmtp2go;
  const source = options.source ?? "cron";
  const triggeredBy = options.triggeredBy ?? (source === "cron" ? "scheduler" : "admin");
  const recordHistory = options.recordHistory !== false;

  if (!options.bypassEnabledFlag && process.env.REMINDER_EMAILS_ENABLED?.trim().toLowerCase() !== "true") {
    const skipped: ReminderRunSummary = {
      ok: true,
      skippedBecauseDisabled: true,
      checkedAt: now.toISOString(),
      source,
      claimed: 0,
      attempted: 0,
      sent: 0,
      failed: 0,
      retriedScheduled: 0,
      expired: 0,
      cancelled: 0,
      details: [],
    };
    if (recordHistory) {
      await appendReminderRunHistory(options.prisma, {
        id: cuid(),
        ranAt: now.toISOString(),
        source,
        triggeredBy,
        ok: true,
        skippedBecauseDisabled: true,
        claimed: 0,
        attempted: 0,
        sent: 0,
        failed: 0,
        retriedScheduled: 0,
        expired: 0,
        cancelled: 0,
        error: "REMINDER_EMAILS_ENABLED is not set to true.",
      });
    }
    return skipped;
  }

  const settings = await getCalendarNotificationSettings(options.prisma);
  const todayKey = todayDateKeyInTimezone(settings.timezone, now);

  const claimedRows = options.prisma
    ? await claimDueRemindersPostgres(options.prisma, now, limit)
    : claimDueRemindersFileStore(now, limit);

  const summary: ReminderRunSummary = {
    ok: true,
    checkedAt: now.toISOString(),
    source,
    claimed: claimedRows.length,
    attempted: 0,
    sent: 0,
    failed: 0,
    retriedScheduled: 0,
    expired: 0,
    cancelled: 0,
    details: [],
  };

  let lastRunError: string | null = null;

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
      lastRunError = reason;
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

    // 4. Build email and send via SMTP2GO (outside any open DB transaction)
    summary.attempted++;
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
      lastRunError = result.error.slice(0, 500);
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

  if (recordHistory) {
    await appendReminderRunHistory(options.prisma, {
      id: cuid(),
      ranAt: now.toISOString(),
      source,
      triggeredBy,
      ok: summary.failed === 0,
      claimed: summary.claimed,
      attempted: summary.attempted,
      sent: summary.sent,
      failed: summary.failed,
      retriedScheduled: summary.retriedScheduled,
      expired: summary.expired,
      cancelled: summary.cancelled,
      error: lastRunError,
    });
  }

  return summary;
}

/**
 * Live diagnostics snapshot for Settings → Price Update Calendar & Notifications.
 * Never returns API keys, cron secrets, or Vault secrets.
 */
export async function getReminderDiagnostics(
  prisma: PrismaClient | null,
  now: Date = new Date(),
): Promise<ReminderDiagnostics> {
  const [settings, history] = await Promise.all([
    getCalendarNotificationSettings(prisma),
    getReminderRunHistory(prisma),
  ]);
  const emailConfig = getSmtp2goPublicStatus();

  const counts = {
    pending: 0,
    due: 0,
    processing: 0,
    sent: 0,
    failed: 0,
    expired: 0,
  };
  let latestReminderError: string | null = null;

  const scheduler: ReminderDiagnostics["scheduler"] = {
    provider: "unconfigured",
    operationalState: "unconfigured",
    operationalReason: "No active Supabase Cron job found.",
    jobName: SUPABASE_CRON_JOB_NAME,
    pgCronInstalled: false,
    pgNetInstalled: false,
    jobFound: false,
    active: false,
    schedule: null,
    scheduleLabel: null,
    nextExpectedRunAt: null,
    lastCronJobRunAt: null,
    lastCronJobStatus: null,
    lastCronJobMessage: null,
    lastHttpRequestAt: null,
    lastHttpStatusCode: null,
    lastHttpError: null,
    lastSuccessfulHttpRequestAt: null,
  };

  if (!prisma) {
    const store = loadFileStore();
    const activeSessionIds = new Set(
      store.sessions
        .filter((s) => s.status === "Scheduled" && s.scheduleStatus === "ACTIVE")
        .map((s) => s.id),
    );
    const nowMs = now.getTime();
    for (const r of store.reminders ?? []) {
      if (r.status === "SCHEDULED") {
        counts.pending++;
        if (activeSessionIds.has(r.sessionId) && new Date(r.scheduledReminderAt).getTime() <= nowMs) {
          counts.due++;
        }
      } else if (r.status === "PROCESSING") {
        counts.processing++;
      } else if (r.status === "SENT") {
        counts.sent++;
      } else if (r.status === "FAILED") {
        counts.failed++;
        if (
          activeSessionIds.has(r.sessionId) &&
          r.attemptCount < r.maxAttempts &&
          r.nextRetryAt &&
          new Date(r.nextRetryAt).getTime() <= nowMs
        ) {
          counts.due++;
        }
        if (r.lastError && !latestReminderError) latestReminderError = r.lastError;
      } else if (r.status === "EXPIRED") {
        counts.expired++;
      }
    }
  } else {
    const [grouped, dueRows, latestFailed] = await Promise.all([
      prisma.priceUpdateReminder.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.$queryRawUnsafe<{ cnt: number }[]>(
        `
        SELECT COUNT(*)::int AS cnt
        FROM "PriceUpdateReminder" r
        INNER JOIN "PriceUpdateSession" s ON s."id" = r."sessionId"
        WHERE s."status" = 'Scheduled'
          AND s."scheduleStatus" = 'ACTIVE'
          AND (
            (r."status" = 'SCHEDULED' AND r."scheduledReminderAt" <= $1)
            OR (
              r."status" = 'FAILED'
              AND r."attemptCount" < r."maxAttempts"
              AND r."nextRetryAt" IS NOT NULL
              AND r."nextRetryAt" <= $1
            )
          )
        `,
        now,
      ),
      prisma.priceUpdateReminder.findFirst({
        where: { status: "FAILED", lastError: { not: null } },
        orderBy: { updatedAt: "desc" },
        select: { lastError: true },
      }),
    ]);

    for (const g of grouped) {
      if (g.status === "SCHEDULED") counts.pending = g._count._all;
      else if (g.status === "PROCESSING") counts.processing = g._count._all;
      else if (g.status === "SENT") counts.sent = g._count._all;
      else if (g.status === "FAILED") counts.failed = g._count._all;
      else if (g.status === "EXPIRED") counts.expired = g._count._all;
    }
    counts.due = Number(dueRows[0]?.cnt ?? 0);
    latestReminderError = latestFailed?.lastError ?? null;

    // Inspect Supabase pg_cron & pg_net status safely (never leaks job command/URL/secrets)
    try {
      const exts = await prisma.$queryRawUnsafe<{ name: string; installed_version: string | null }[]>(
        `SELECT name, installed_version FROM pg_available_extensions WHERE name IN ('pg_cron', 'pg_net')`,
      );
      scheduler.pgCronInstalled = exts.some((e) => e.name === "pg_cron" && Boolean(e.installed_version));
      scheduler.pgNetInstalled = exts.some((e) => e.name === "pg_net" && Boolean(e.installed_version));

      if (scheduler.pgCronInstalled) {
        const jobs = await prisma.$queryRawUnsafe<
          { jobid: number; schedule: string; active: boolean }[]
        >(
          `SELECT jobid, schedule, active FROM cron.job WHERE jobname = $1 LIMIT 1`,
          SUPABASE_CRON_JOB_NAME,
        );
        if (jobs.length > 0) {
          const job = jobs[0];
          scheduler.provider = "supabase_pg_cron";
          scheduler.jobFound = true;
          scheduler.active = Boolean(job.active);
          scheduler.schedule = job.schedule;
          scheduler.scheduleLabel = describeCronSchedule(job.schedule);
          scheduler.nextExpectedRunAt = job.active ? computeNextCronRun(job.schedule, now) : null;

          const lastRuns = await prisma
            .$queryRawUnsafe<{ start_time: Date; status: string; return_message: string | null }[]>(
              `SELECT start_time, status, return_message FROM cron.job_run_details WHERE jobid = $1 ORDER BY start_time DESC LIMIT 1`,
              job.jobid,
            )
            .catch(() => []);
          if (lastRuns.length > 0) {
            scheduler.lastCronJobRunAt = new Date(lastRuns[0].start_time).toISOString();
            scheduler.lastCronJobStatus = lastRuns[0].status;
            scheduler.lastCronJobMessage = lastRuns[0].return_message;
          }
        }
      }

      // Inspect pg_net HTTP responses (non-secret status_code, error_msg, timed_out)
      // so we distinguish a scheduled job from actually reaching Vercel with HTTP 200.
      if (scheduler.pgNetInstalled) {
        const [latestHttp, latestOkHttp] = await Promise.all([
          prisma
            .$queryRawUnsafe<
              { status_code: number | null; content_preview: string | null; error_msg: string | null; timed_out: boolean | null; created: Date }[]
            >(
              `SELECT status_code, left(content, 200) AS content_preview, error_msg, timed_out, created FROM net._http_response ORDER BY created DESC LIMIT 1`,
            )
            .catch(() => []),
          prisma
            .$queryRawUnsafe<{ created: Date }[]>(
              `SELECT created FROM net._http_response WHERE status_code BETWEEN 200 AND 299 AND error_msg IS NULL AND NOT COALESCE(timed_out, false) ORDER BY created DESC LIMIT 1`,
            )
            .catch(() => []),
        ]);

        if (latestHttp.length > 0) {
          const row = latestHttp[0];
          scheduler.lastHttpRequestAt = new Date(row.created).toISOString();
          scheduler.lastHttpStatusCode = row.status_code !== null ? Number(row.status_code) : null;
          if (row.timed_out) {
            scheduler.lastHttpError = "pg_net HTTP request to Vercel endpoint timed out.";
          } else if (row.error_msg) {
            scheduler.lastHttpError = `pg_net HTTP error: ${row.error_msg}`;
          } else if (row.status_code !== null && (row.status_code < 200 || row.status_code >= 300)) {
            let safeDetail = "";
            if (row.status_code === 401) {
              safeDetail = "Unauthorized — verify CRON_SECRET in Vercel matches calendar_cron_secret in Supabase Vault (min 8 chars; 32+ recommended).";
            } else if (row.status_code === 404) {
              safeDetail = "Endpoint not found — verify calendar_cron_endpoint_url in Supabase Vault.";
            } else if (row.content_preview) {
              try {
                const parsed = JSON.parse(row.content_preview) as { error?: string };
                if (parsed?.error) safeDetail = String(parsed.error);
              } catch {
                safeDetail = "";
              }
            }
            scheduler.lastHttpError = `HTTP ${row.status_code}${safeDetail ? `: ${safeDetail}` : ""}`;
          }
        }

        if (latestOkHttp.length > 0) {
          scheduler.lastSuccessfulHttpRequestAt = new Date(latestOkHttp[0].created).toISOString();
        }
      }
    } catch {
      // Extensions/cron schema not accessible in this environment; keep safe defaults
    }
  }

  const lastExecution = history[0] ?? null;
  const lastCronExecution = history.find((h) => h.source === "cron") ?? null;
  const lastSuccessfulCronExecution =
    history.find((h) => h.source === "cron" && h.ok && !h.skippedBecauseDisabled) ?? null;
  const lastSuccessfulExecution =
    history.find((h) => h.ok && !h.skippedBecauseDisabled) ?? null;
  const lastFailedExecution = history.find((h) => !h.ok) ?? null;

  // Derive truthful operational state: never claim operational just because cron.job exists
  if (!scheduler.active) {
    scheduler.operationalState = "unconfigured";
    scheduler.operationalReason = scheduler.pgCronInstalled
      ? "Extensions are installed, but the Supabase Cron job is not scheduled/active."
      : "Supabase Cron is not configured.";
  } else if (scheduler.lastHttpError) {
    scheduler.operationalState = "failing";
    scheduler.operationalReason = `Cron requests are failing (${scheduler.lastHttpError})`;
  } else if (scheduler.lastCronJobStatus && scheduler.lastCronJobStatus !== "succeeded") {
    scheduler.operationalState = "failing";
    scheduler.operationalReason = `Supabase pg_cron execution failed (${scheduler.lastCronJobMessage || scheduler.lastCronJobStatus}).`;
  } else if (!emailConfig.automatedSendingEnabled) {
    scheduler.operationalState = "paused";
    scheduler.operationalReason = "Cron job is scheduled, but REMINDER_EMAILS_ENABLED is not set to \"true\" in Vercel.";
  } else if (lastCronExecution && !lastCronExecution.ok) {
    scheduler.operationalState = "failing";
    scheduler.operationalReason = lastCronExecution.error || "Last automatic reminder run failed.";
  } else if (
    lastSuccessfulCronExecution ||
    (scheduler.lastSuccessfulHttpRequestAt && scheduler.lastHttpStatusCode !== null && scheduler.lastHttpStatusCode >= 200 && scheduler.lastHttpStatusCode < 300)
  ) {
    scheduler.operationalState = "operational";
    scheduler.operationalReason = "Supabase Cron is reaching the Vercel endpoint and processing reminders.";
  } else {
    scheduler.operationalState = "configured_unverified";
    scheduler.operationalReason = "Cron job is scheduled in Supabase, waiting for the first successful HTTP 200 call to Vercel.";
  }

  const lastError =
    scheduler.lastHttpError ||
    (lastFailedExecution?.error ?? null) ||
    latestReminderError ||
    (lastExecution?.skippedBecauseDisabled ? lastExecution.error ?? null : null) ||
    null;

  return {
    checkedAt: now.toISOString(),
    timezone: settings.timezone,
    scheduler,
    counts,
    lastExecution,
    lastCronExecution,
    lastSuccessfulCronExecution,
    lastSuccessfulExecution,
    lastFailedExecution,
    lastError,
    history,
    emailConfig,
  };
}
