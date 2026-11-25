/**
 * Server-side scheduling, rescheduling, cancellation, completion, and calendar
 * query services. Supports both PostgreSQL (Prisma) and local dev file store.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  cuid,
  loadFileStore,
  saveFileStore,
  type PriceUpdateReminderRow,
  type PriceUpdateScheduleHistoryRow,
  type SessionRow,
} from "./store";
import {
  DEFAULT_TIMEZONE,
  RESTORABLE_STATUSES,
  SCHEDULABLE_STATUSES,
  dateKeyToUtcMidnight,
  formatDateKeyShort,
  getReminderTypeLabel,
  isCalendarEventUpcoming,
  isValidDateKey,
  normalizeRecipientList,
  toDateKey,
  todayDateKeyInTimezone,
  utcToLocalParts,
  validateAndComputeReminder,
  type ReminderType,
} from "./calendar";
import {
  getCalendarNotificationSettings,
  type CalendarNotificationSettings,
} from "./notificationSettings";

export type SerializedReminder = {
  id: string;
  sessionId: string;
  reminderType: string;
  scheduledReminderAt: string;
  scheduledReminderLocal: { dateKey: string; timeHHMM: string; formatted: string };
  customRecipients: string[] | null;
  effectiveRecipients: string[];
  resolvedRecipients: string[] | null;
  status: string;
  sentAt: string | null;
  attemptedAt: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  providerRequestId: string | null;
  providerEmailId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type SerializedScheduleHistory = {
  id: string;
  sessionId: string;
  action: string;
  previousEffectiveDate: string | null;
  newEffectiveDate: string | null;
  performedBy: string;
  detail: string;
  createdAt: string;
};

export type SerializedScheduleSummary = {
  scheduledEffectiveDate: string | null;
  scheduledAt: string | null;
  scheduledBy: string | null;
  previousStatus: string | null;
  scheduleStatus: string | null;
  scheduleCancelledAt: string | null;
  scheduleCancelledBy: string | null;
  activeReminder: SerializedReminder | null;
  latestReminder: SerializedReminder | null;
  history: SerializedScheduleHistory[];
};

export type CalendarEventItem = {
  id: string;
  vendor: string;
  name: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  scheduledEffectiveDate: string;
  scheduledAt: string | null;
  scheduledBy: string | null;
  previousStatus: string | null;
  scheduleStatus: string | null;
  scheduleCancelledAt: string | null;
  scheduleCancelledBy: string | null;
  activeReminder: SerializedReminder | null;
  latestReminder: SerializedReminder | null;
  reminderEnabled: boolean;
  history: SerializedScheduleHistory[];
};

export type ScheduleInput = {
  effectiveDate: string;
  reminderEnabled: boolean;
  reminderType?: ReminderType;
  customDateKey?: string | null;
  customTimeHHMM?: string | null;
  customReminderAtIso?: string | null;
  useCustomRecipients?: boolean;
  customRecipients?: string[];
  confirmAfterEffectiveDate?: boolean;
  /** True for date-only reschedules (e.g. calendar drag/drop) that should preserve custom reminders and recalculate relative ones. */
  preserveExistingReminder?: boolean;
  /** Explicitly create a new reminder even if a previous reminder for this session was already SENT. */
  createNewReminder?: boolean;
};

export type ScheduleActionResult =
  | {
      ok: true;
      action: "SCHEDULED" | "RESCHEDULED" | "REMINDER_UPDATED";
      session: {
        id: string;
        vendor: string;
        name: string;
        status: string;
        schedule: SerializedScheduleSummary;
      };
      warning?: string | null;
    }
  | {
      ok: false;
      status: number;
      code: string;
      error: string;
      requiresConfirmation?: boolean;
    };

function parseJsonStringArray(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((v) => String(v)).filter(Boolean);
  } catch {
    return null;
  }
}

export function serializeReminder(
  r: {
    id: string;
    sessionId: string;
    reminderType: string;
    scheduledReminderAt: Date | string;
    customRecipientsJson: string | null;
    resolvedRecipientsJson: string | null;
    status: string;
    sentAt: Date | string | null;
    attemptedAt: Date | string | null;
    attemptCount: number;
    maxAttempts: number;
    nextRetryAt: Date | string | null;
    lastError: string | null;
    providerRequestId: string | null;
    providerEmailId: string | null;
    createdBy: string;
    createdAt: Date | string;
    updatedAt: Date | string;
  },
  settings: CalendarNotificationSettings,
): SerializedReminder {
  const iso = (v: Date | string | null | undefined) =>
    v ? (v instanceof Date ? v.toISOString() : String(v)) : null;
  const schedIso = iso(r.scheduledReminderAt) ?? new Date().toISOString();
  const customRecipients = parseJsonStringArray(r.customRecipientsJson);
  const resolvedRecipients = parseJsonStringArray(r.resolvedRecipientsJson);
  const effectiveRecipients = customRecipients ?? settings.recipients;

  return {
    id: r.id,
    sessionId: r.sessionId,
    reminderType: r.reminderType,
    scheduledReminderAt: schedIso,
    scheduledReminderLocal: utcToLocalParts(schedIso, settings.timezone),
    customRecipients,
    effectiveRecipients,
    resolvedRecipients,
    status: r.status,
    sentAt: iso(r.sentAt),
    attemptedAt: iso(r.attemptedAt),
    attemptCount: r.attemptCount,
    maxAttempts: r.maxAttempts,
    nextRetryAt: iso(r.nextRetryAt),
    lastError: r.lastError ?? null,
    providerRequestId: r.providerRequestId ?? null,
    providerEmailId: r.providerEmailId ?? null,
    createdBy: r.createdBy,
    createdAt: iso(r.createdAt) ?? schedIso,
    updatedAt: iso(r.updatedAt) ?? schedIso,
  };
}

export function serializeHistoryRow(h: {
  id: string;
  sessionId: string;
  action: string;
  previousEffectiveDate: Date | string | null;
  newEffectiveDate: Date | string | null;
  performedBy: string;
  detail: string;
  createdAt: Date | string;
}): SerializedScheduleHistory {
  return {
    id: h.id,
    sessionId: h.sessionId,
    action: h.action,
    previousEffectiveDate: toDateKey(h.previousEffectiveDate),
    newEffectiveDate: toDateKey(h.newEffectiveDate),
    performedBy: h.performedBy,
    detail: h.detail,
    createdAt: h.createdAt instanceof Date ? h.createdAt.toISOString() : String(h.createdAt),
  };
}

function pickActiveAndLatest(reminders: SerializedReminder[]): {
  activeReminder: SerializedReminder | null;
  latestReminder: SerializedReminder | null;
} {
  if (!reminders.length) return { activeReminder: null, latestReminder: null };
  const sorted = reminders
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activeReminder =
    sorted.find((r) => r.status === "SCHEDULED" || r.status === "PROCESSING" || r.status === "FAILED") ??
    null;
  const latestReminder = activeReminder ?? sorted[0] ?? null;
  return { activeReminder, latestReminder };
}

export async function getSessionScheduleSummary(
  prisma: PrismaClient | null,
  sessionId: string,
  settingsOverride?: CalendarNotificationSettings,
): Promise<SerializedScheduleSummary | null> {
  const settings = settingsOverride ?? (await getCalendarNotificationSettings(prisma));
  if (!prisma) {
    const store = loadFileStore();
    const s = store.sessions.find((x) => x.id === sessionId);
    if (!s) return null;
    const reminders = (store.reminders ?? [])
      .filter((r) => r.sessionId === sessionId)
      .map((r) => serializeReminder(r, settings));
    const history = (store.scheduleHistory ?? [])
      .filter((h) => h.sessionId === sessionId)
      .slice()
      .reverse()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
      .map(serializeHistoryRow);
    const { activeReminder, latestReminder } = pickActiveAndLatest(reminders);
    return {
      scheduledEffectiveDate: toDateKey(s.scheduledEffectiveDate),
      scheduledAt: s.scheduledAt ?? null,
      scheduledBy: s.scheduledBy ?? null,
      previousStatus: s.previousStatus ?? null,
      scheduleStatus: s.scheduleStatus ?? null,
      scheduleCancelledAt: s.scheduleCancelledAt ?? null,
      scheduleCancelledBy: s.scheduleCancelledBy ?? null,
      activeReminder,
      latestReminder,
      history,
    };
  }

  const s = await prisma.priceUpdateSession.findUnique({
    where: { id: sessionId },
    include: {
      reminders: { orderBy: { createdAt: "desc" }, take: 15 },
      scheduleHistory: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!s) return null;
  const reminders = s.reminders.map((r) => serializeReminder(r, settings));
  const { activeReminder, latestReminder } = pickActiveAndLatest(reminders);
  return {
    scheduledEffectiveDate: toDateKey(s.scheduledEffectiveDate),
    scheduledAt: s.scheduledAt ? s.scheduledAt.toISOString() : null,
    scheduledBy: s.scheduledBy ?? null,
    previousStatus: s.previousStatus ?? null,
    scheduleStatus: s.scheduleStatus ?? null,
    scheduleCancelledAt: s.scheduleCancelledAt ? s.scheduleCancelledAt.toISOString() : null,
    scheduleCancelledBy: s.scheduleCancelledBy ?? null,
    activeReminder,
    latestReminder,
    history: s.scheduleHistory.map(serializeHistoryRow),
  };
}

/**
 * Schedule or reschedule an existing PriceUpdateSession without duplicating it
 * or altering pricing items/calculations.
 */
export async function scheduleOrRescheduleSession(
  prisma: PrismaClient | null,
  sessionId: string,
  userEmail: string,
  input: ScheduleInput,
  now: Date = new Date(),
): Promise<ScheduleActionResult> {
  const effectiveDateKey = String(input.effectiveDate ?? "").trim();
  if (!isValidDateKey(effectiveDateKey)) {
    return { ok: false, status: 400, code: "INVALID_EFFECTIVE_DATE", error: "Select a valid effective date (YYYY-MM-DD)." };
  }

  const settings = await getCalendarNotificationSettings(prisma);
  const todayKey = todayDateKeyInTimezone(settings.timezone, now);
  if (effectiveDateKey < todayKey) {
    return {
      ok: false,
      status: 400,
      code: "EFFECTIVE_DATE_IN_PAST",
      error: `Effective date (${formatDateKeyShort(effectiveDateKey)}) cannot be in the past. Choose today (${formatDateKeyShort(todayKey)}) or a future date.`,
    };
  }

  // Load session + item count + existing reminders
  let existingSession: {
    id: string;
    vendor: string;
    name: string;
    status: string;
    scheduledEffectiveDate: string | null;
    previousStatus: string | null;
    scheduleStatus: string | null;
  } | null = null;
  let itemCount = 0;
  let existingReminders: {
    id: string;
    reminderType: string;
    scheduledReminderAt: Date;
    customRecipientsJson: string | null;
    status: string;
    createdAt: Date;
  }[] = [];

  if (!prisma) {
    const store = loadFileStore();
    const s = store.sessions.find((x) => x.id === sessionId);
    if (s) {
      existingSession = {
        id: s.id,
        vendor: s.vendor,
        name: s.name,
        status: s.status,
        scheduledEffectiveDate: toDateKey(s.scheduledEffectiveDate),
        previousStatus: s.previousStatus ?? null,
        scheduleStatus: s.scheduleStatus ?? null,
      };
      itemCount = store.items.filter((i) => i.sessionId === sessionId).length;
      existingReminders = (store.reminders ?? [])
        .filter((r) => r.sessionId === sessionId)
        .map((r) => ({
          id: r.id,
          reminderType: r.reminderType,
          scheduledReminderAt: new Date(r.scheduledReminderAt),
          customRecipientsJson: r.customRecipientsJson,
          status: r.status,
          createdAt: new Date(r.createdAt),
        }))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
  } else {
    const s = await prisma.priceUpdateSession.findUnique({
      where: { id: sessionId },
      include: {
        _count: { select: { items: true } },
        reminders: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (s) {
      existingSession = {
        id: s.id,
        vendor: s.vendor,
        name: s.name,
        status: s.status,
        scheduledEffectiveDate: toDateKey(s.scheduledEffectiveDate),
        previousStatus: s.previousStatus,
        scheduleStatus: s.scheduleStatus,
      };
      itemCount = s._count.items;
      existingReminders = s.reminders.map((r) => ({
        id: r.id,
        reminderType: r.reminderType,
        scheduledReminderAt: r.scheduledReminderAt,
        customRecipientsJson: r.customRecipientsJson,
        status: r.status,
        createdAt: r.createdAt,
      }));
    }
  }

  if (!existingSession) {
    return { ok: false, status: 404, code: "NOT_FOUND", error: "Price update worksheet not found." };
  }

  if (!SCHEDULABLE_STATUSES.has(existingSession.status)) {
    return {
      ok: false,
      status: 409,
      code: "STATUS_NOT_SCHEDULABLE",
      error:
        existingSession.status === "Draft"
          ? "Draft worksheets cannot be scheduled until vendor rows are imported and ready."
          : existingSession.status === "Exported"
          ? "Exported worksheets cannot be scheduled. Change the worksheet back to Reviewed or Ready first if you want to re-schedule it."
          : `Worksheets with status "${existingSession.status}" cannot be scheduled.`,
    };
  }

  if (itemCount === 0) {
    return {
      ok: false,
      status: 409,
      code: "EMPTY_WORKSHEET",
      error: "Cannot schedule an empty worksheet. Add or import products before scheduling.",
    };
  }

  const wasActiveScheduled =
    existingSession.status === "Scheduled" && existingSession.scheduleStatus === "ACTIVE";
  const prevEffectiveDateKey = wasActiveScheduled ? existingSession.scheduledEffectiveDate : null;
  const dateChanged = !wasActiveScheduled || prevEffectiveDateKey !== effectiveDateKey;

  const activeExisting = existingReminders.find(
    (r) => r.status === "SCHEDULED" || r.status === "FAILED",
  ) ?? null;
  const sentExisting = existingReminders.find((r) => r.status === "SENT") ?? null;

  // Determine reminder mutation plan
  type ReminderPlan =
    | { mode: "NONE" }
    | { mode: "CANCEL_UNSENT" }
    | {
        mode: "UPDATE_EXISTING";
        reminderId: string;
        reminderType: ReminderType;
        scheduledReminderAt: Date;
        customRecipientsJson: string | null;
      }
    | {
        mode: "CREATE_NEW";
        reminderType: ReminderType;
        scheduledReminderAt: Date;
        customRecipientsJson: string | null;
      };

  let reminderPlan: ReminderPlan = { mode: "NONE" };
  let warning: string | null = null;

  if (input.preserveExistingReminder && wasActiveScheduled) {
    // Quick date-only reschedule (e.g. calendar drag-and-drop)
    if (activeExisting) {
      if (activeExisting.reminderType === "ONE_DAY_BEFORE" || activeExisting.reminderType === "TWO_DAYS_BEFORE") {
        const res = validateAndComputeReminder({
          effectiveDateKey,
          reminderType: activeExisting.reminderType,
          timeZone: settings.timezone,
          defaultHour: settings.defaultReminderHour,
          defaultMinute: settings.defaultReminderMinute,
          confirmAfterEffectiveDate: Boolean(input.confirmAfterEffectiveDate),
          now,
        });
        if (!res.ok) {
          return {
            ok: false,
            status: 409,
            code: "REMINDER_INVALIDATED_BY_RESCHEDULE",
            error: `Rescheduling to ${formatDateKeyShort(effectiveDateKey)} makes the existing ${getReminderTypeLabel(activeExisting.reminderType)} reminder invalid: ${res.error}`,
            requiresConfirmation: Boolean(res.requiresConfirmation),
          };
        }
        reminderPlan = {
          mode: "UPDATE_EXISTING",
          reminderId: activeExisting.id,
          reminderType: activeExisting.reminderType,
          scheduledReminderAt: res.scheduledReminderAt,
          customRecipientsJson: activeExisting.customRecipientsJson,
        };
      } else {
        // CUSTOM reminder remains UNCHANGED on reschedule unless invalid
        const customIso = activeExisting.scheduledReminderAt.toISOString();
        const res = validateAndComputeReminder({
          effectiveDateKey,
          reminderType: "CUSTOM",
          customReminderAtIso: customIso,
          timeZone: settings.timezone,
          defaultHour: settings.defaultReminderHour,
          defaultMinute: settings.defaultReminderMinute,
          confirmAfterEffectiveDate: Boolean(input.confirmAfterEffectiveDate),
          now,
        });
        if (!res.ok) {
          return {
            ok: false,
            status: 409,
            code: res.code === "REMINDER_AFTER_EFFECTIVE_DATE" ? "REMINDER_AFTER_EFFECTIVE_DATE" : "REMINDER_INVALIDATED_BY_RESCHEDULE",
            error: `Your custom reminder date is preserved, but ${res.error}`,
            requiresConfirmation: Boolean(res.requiresConfirmation),
          };
        }
        // Leave custom reminder intact without modifying it
        reminderPlan = { mode: "NONE" };
      }
    } else if (sentExisting) {
      // Already sent reminder: never auto-resend on reschedule
      reminderPlan = { mode: "NONE" };
      warning = "A reminder was already sent for this worksheet and will not be resent unless you configure a new reminder.";
    }
  } else if (!input.reminderEnabled) {
    // Explicitly disabled reminders: cancel any unsent reminders (keep SENT untouched)
    reminderPlan = activeExisting ? { mode: "CANCEL_UNSENT" } : { mode: "NONE" };
  } else {
    // Reminder enabled with explicit config
    const reminderType: ReminderType =
      input.reminderType === "TWO_DAYS_BEFORE" || input.reminderType === "CUSTOM"
        ? input.reminderType
        : "ONE_DAY_BEFORE";

    let customRecipientsJson: string | null = null;
    let resolvedRecipients: string[] = settings.recipients;

    if (input.useCustomRecipients) {
      const { valid, invalid } = normalizeRecipientList(input.customRecipients ?? []);
      if (invalid.length > 0) {
        return {
          ok: false,
          status: 400,
          code: "INVALID_RECIPIENTS",
          error: `Invalid recipient email${invalid.length === 1 ? "" : "s"}: ${invalid.slice(0, 5).join(", ")}`,
        };
      }
      if (valid.length === 0) {
        return {
          ok: false,
          status: 400,
          code: "NO_RECIPIENTS",
          error: "Enter at least one valid reminder recipient email, or switch to default recipients.",
        };
      }
      customRecipientsJson = JSON.stringify(valid);
      resolvedRecipients = valid;
    } else if (resolvedRecipients.length === 0) {
      return {
        ok: false,
        status: 400,
        code: "NO_RECIPIENTS",
        error: "No default reminder recipients are configured. Add recipients in Settings → Price Update Calendar & Notifications, or specify custom recipients for this worksheet.",
      };
    }

    const validation = validateAndComputeReminder({
      effectiveDateKey,
      reminderType,
      customDateKey: input.customDateKey,
      customTimeHHMM: input.customTimeHHMM,
      customReminderAtIso: input.customReminderAtIso,
      timeZone: settings.timezone,
      defaultHour: settings.defaultReminderHour,
      defaultMinute: settings.defaultReminderMinute,
      confirmAfterEffectiveDate: Boolean(input.confirmAfterEffectiveDate),
      now,
    });
    if (!validation.ok) {
      return {
        ok: false,
        status: validation.requiresConfirmation ? 409 : 400,
        code: validation.code,
        error: validation.error,
        requiresConfirmation: Boolean(validation.requiresConfirmation),
      };
    }

    if (activeExisting) {
      reminderPlan = {
        mode: "UPDATE_EXISTING",
        reminderId: activeExisting.id,
        reminderType,
        scheduledReminderAt: validation.scheduledReminderAt,
        customRecipientsJson,
      };
    } else if (sentExisting && !input.createNewReminder) {
      // Do not silently resend when a reminder was already sent unless user explicitly requested a new one
      reminderPlan = { mode: "NONE" };
      warning = "A reminder was already sent for this worksheet. Enable 'Schedule a new reminder' if you intentionally want another email.";
    } else {
      reminderPlan = {
        mode: "CREATE_NEW",
        reminderType,
        scheduledReminderAt: validation.scheduledReminderAt,
        customRecipientsJson,
      };
    }
  }

  const nextPreviousStatus =
    existingSession.status === "Scheduled"
      ? (existingSession.previousStatus && RESTORABLE_STATUSES.has(existingSession.previousStatus)
          ? existingSession.previousStatus
          : "Ready")
      : (RESTORABLE_STATUSES.has(existingSession.status) ? existingSession.status : "Ready");

  const historyAction: "SCHEDULED" | "RESCHEDULED" | "REMINDER_UPDATED" = !wasActiveScheduled
    ? "SCHEDULED"
    : dateChanged
    ? "RESCHEDULED"
    : "REMINDER_UPDATED";

  const detailParts: string[] = [];
  if (historyAction === "SCHEDULED") {
    detailParts.push(`Scheduled effective date ${effectiveDateKey}`);
  } else if (historyAction === "RESCHEDULED") {
    detailParts.push(`Rescheduled from ${prevEffectiveDateKey ?? "unscheduled"} to ${effectiveDateKey}`);
  } else {
    detailParts.push(`Updated reminder settings for ${effectiveDateKey}`);
  }
  if (reminderPlan.mode === "CREATE_NEW" || reminderPlan.mode === "UPDATE_EXISTING") {
    const localStr = utcToLocalParts(reminderPlan.scheduledReminderAt, settings.timezone).formatted;
    detailParts.push(`Reminder (${getReminderTypeLabel(reminderPlan.reminderType)}) set for ${localStr}`);
  } else if (reminderPlan.mode === "CANCEL_UNSENT") {
    detailParts.push("Email reminder disabled");
  }
  const detail = detailParts.join(" · ");

  // Persist atomically
  if (!prisma) {
    const store = loadFileStore();
    const s = store.sessions.find((x) => x.id === sessionId) as SessionRow | undefined;
    if (!s) return { ok: false, status: 404, code: "NOT_FOUND", error: "Price update worksheet not found." };
    const nowIso = now.toISOString();
    s.previousStatus = nextPreviousStatus;
    s.status = "Scheduled";
    s.scheduledEffectiveDate = effectiveDateKey;
    s.scheduledAt = nowIso;
    s.scheduledBy = userEmail;
    s.scheduleStatus = "ACTIVE";
    s.scheduleCancelledAt = null;
    s.scheduleCancelledBy = null;
    s.updatedAt = nowIso;

    if (!store.reminders) store.reminders = [];
    if (!store.scheduleHistory) store.scheduleHistory = [];

    if (reminderPlan.mode === "CANCEL_UNSENT") {
      for (const r of store.reminders) {
        if (r.sessionId === sessionId && (r.status === "SCHEDULED" || r.status === "FAILED")) {
          r.status = "CANCELLED";
          r.updatedAt = nowIso;
        }
      }
    } else if (reminderPlan.mode === "UPDATE_EXISTING") {
      const target = store.reminders.find((r) => r.id === reminderPlan.reminderId);
      if (target) {
        target.reminderType = reminderPlan.reminderType;
        target.scheduledReminderAt = reminderPlan.scheduledReminderAt.toISOString();
        target.customRecipientsJson = reminderPlan.customRecipientsJson;
        target.status = "SCHEDULED";
        target.attemptCount = 0;
        target.lastError = null;
        target.nextRetryAt = null;
        target.processingStartedAt = null;
        target.updatedAt = nowIso;
      }
    } else if (reminderPlan.mode === "CREATE_NEW") {
      const row: PriceUpdateReminderRow = {
        id: cuid(),
        sessionId,
        reminderType: reminderPlan.reminderType,
        scheduledReminderAt: reminderPlan.scheduledReminderAt.toISOString(),
        customRecipientsJson: reminderPlan.customRecipientsJson,
        resolvedRecipientsJson: null,
        status: "SCHEDULED",
        processingStartedAt: null,
        sentAt: null,
        attemptedAt: null,
        attemptCount: 0,
        maxAttempts: 3,
        nextRetryAt: null,
        lastError: null,
        providerRequestId: null,
        providerEmailId: null,
        createdBy: userEmail,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      store.reminders.push(row);
    }

    const hist: PriceUpdateScheduleHistoryRow = {
      id: cuid(),
      sessionId,
      action: historyAction,
      previousEffectiveDate: prevEffectiveDateKey,
      newEffectiveDate: effectiveDateKey,
      performedBy: userEmail,
      detail,
      createdAt: nowIso,
    };
    store.scheduleHistory.push(hist);
    saveFileStore(store);

    const schedule = (await getSessionScheduleSummary(null, sessionId, settings))!;
    return {
      ok: true,
      action: historyAction,
      session: { id: s.id, vendor: s.vendor, name: s.name, status: s.status, schedule },
      warning,
    };
  }

  // PostgreSQL transaction
  const effectiveDateUtc = dateKeyToUtcMidnight(effectiveDateKey);
  await prisma.$transaction(async (tx) => {
    await tx.priceUpdateSession.update({
      where: { id: sessionId },
      data: {
        previousStatus: nextPreviousStatus,
        status: "Scheduled",
        scheduledEffectiveDate: effectiveDateUtc,
        scheduledAt: now,
        scheduledBy: userEmail,
        scheduleStatus: "ACTIVE",
        scheduleCancelledAt: null,
        scheduleCancelledBy: null,
      },
    });

    if (reminderPlan.mode === "CANCEL_UNSENT") {
      await tx.priceUpdateReminder.updateMany({
        where: { sessionId, status: { in: ["SCHEDULED", "FAILED"] } },
        data: { status: "CANCELLED" },
      });
    } else if (reminderPlan.mode === "UPDATE_EXISTING") {
      await tx.priceUpdateReminder.update({
        where: { id: reminderPlan.reminderId },
        data: {
          reminderType: reminderPlan.reminderType,
          scheduledReminderAt: reminderPlan.scheduledReminderAt,
          customRecipientsJson: reminderPlan.customRecipientsJson,
          status: "SCHEDULED",
          attemptCount: 0,
          lastError: null,
          nextRetryAt: null,
          processingStartedAt: null,
        },
      });
    } else if (reminderPlan.mode === "CREATE_NEW") {
      await tx.priceUpdateReminder.create({
        data: {
          sessionId,
          reminderType: reminderPlan.reminderType,
          scheduledReminderAt: reminderPlan.scheduledReminderAt,
          customRecipientsJson: reminderPlan.customRecipientsJson,
          status: "SCHEDULED",
          createdBy: userEmail,
        },
      });
    }

    await tx.priceUpdateScheduleHistory.create({
      data: {
        sessionId,
        action: historyAction,
        previousEffectiveDate: prevEffectiveDateKey ? dateKeyToUtcMidnight(prevEffectiveDateKey) : null,
        newEffectiveDate: effectiveDateUtc,
        performedBy: userEmail,
        detail,
      },
    });
  });

  const schedule = (await getSessionScheduleSummary(prisma, sessionId, settings))!;
  return {
    ok: true,
    action: historyAction,
    session: {
      id: existingSession.id,
      vendor: existingSession.vendor,
      name: existingSession.name,
      status: "Scheduled",
      schedule,
    },
    warning,
  };
}

/**
 * Cancel an active schedule on a worksheet, cancel pending reminders,
 * restore the appropriate previous status, and preserve all worksheet data.
 */
export async function cancelSessionSchedule(
  prisma: PrismaClient | null,
  sessionId: string,
  userEmail: string,
  now: Date = new Date(),
): Promise<
  | {
      ok: true;
      restoredStatus: string;
      cancelledReminders: number;
      schedule: SerializedScheduleSummary;
    }
  | { ok: false; status: number; error: string }
> {
  const settings = await getCalendarNotificationSettings(prisma);
  if (!prisma) {
    const store = loadFileStore();
    const s = store.sessions.find((x) => x.id === sessionId);
    if (!s) return { ok: false, status: 404, error: "Price update worksheet not found." };
    if (s.scheduleStatus !== "ACTIVE" && s.status !== "Scheduled") {
      return { ok: false, status: 409, error: "This worksheet does not have an active schedule to cancel." };
    }
    const restoredStatus =
      s.previousStatus && RESTORABLE_STATUSES.has(s.previousStatus) ? s.previousStatus : "Ready";
    const prevDate = toDateKey(s.scheduledEffectiveDate);
    const nowIso = now.toISOString();
    s.status = restoredStatus;
    s.scheduleStatus = "CANCELLED";
    s.scheduleCancelledAt = nowIso;
    s.scheduleCancelledBy = userEmail;
    s.updatedAt = nowIso;

    let cancelledReminders = 0;
    for (const r of store.reminders ?? []) {
      if (r.sessionId === sessionId && (r.status === "SCHEDULED" || r.status === "FAILED")) {
        r.status = "CANCELLED";
        r.updatedAt = nowIso;
        cancelledReminders++;
      }
    }

    if (!store.scheduleHistory) store.scheduleHistory = [];
    store.scheduleHistory.push({
      id: cuid(),
      sessionId,
      action: "CANCELLED",
      previousEffectiveDate: prevDate,
      newEffectiveDate: null,
      performedBy: userEmail,
      detail: `Schedule cancelled; status restored to ${restoredStatus}`,
      createdAt: nowIso,
    });
    saveFileStore(store);

    const schedule = (await getSessionScheduleSummary(null, sessionId, settings))!;
    return { ok: true, restoredStatus, cancelledReminders, schedule };
  }

  const s = await prisma.priceUpdateSession.findUnique({ where: { id: sessionId } });
  if (!s) return { ok: false, status: 404, error: "Price update worksheet not found." };
  if (s.scheduleStatus !== "ACTIVE" && s.status !== "Scheduled") {
    return { ok: false, status: 409, error: "This worksheet does not have an active schedule to cancel." };
  }

  const restoredStatus =
    s.previousStatus && RESTORABLE_STATUSES.has(s.previousStatus) ? s.previousStatus : "Ready";

  let cancelledReminders = 0;
  await prisma.$transaction(async (tx) => {
    await tx.priceUpdateSession.update({
      where: { id: sessionId },
      data: {
        status: restoredStatus,
        scheduleStatus: "CANCELLED",
        scheduleCancelledAt: now,
        scheduleCancelledBy: userEmail,
      },
    });
    const res = await tx.priceUpdateReminder.updateMany({
      where: { sessionId, status: { in: ["SCHEDULED", "FAILED"] } },
      data: { status: "CANCELLED" },
    });
    cancelledReminders = res.count;
    await tx.priceUpdateScheduleHistory.create({
      data: {
        sessionId,
        action: "CANCELLED",
        previousEffectiveDate: s.scheduledEffectiveDate,
        newEffectiveDate: null,
        performedBy: userEmail,
        detail: `Schedule cancelled; status restored to ${restoredStatus}`,
      },
    });
  });

  const schedule = (await getSessionScheduleSummary(prisma, sessionId, settings))!;
  return { ok: true, restoredStatus, cancelledReminders, schedule };
}

/**
 * Mark an active schedule as COMPLETED (e.g. when the worksheet is exported for POS)
 * and cancel any remaining unsent reminders so completed sheets never fire future emails.
 */
export async function markSessionScheduleCompleted(
  prisma: PrismaClient | null,
  sessionId: string,
  performedBy: string,
  reason: string = "Worksheet exported for POS",
  now: Date = new Date(),
): Promise<void> {
  if (!prisma) {
    const store = loadFileStore();
    const s = store.sessions.find((x) => x.id === sessionId);
    if (!s) return;
    const hadActiveSchedule = s.scheduleStatus === "ACTIVE";
    const nowIso = now.toISOString();
    if (hadActiveSchedule) {
      s.scheduleStatus = "COMPLETED";
    }
    let cancelledAny = false;
    for (const r of store.reminders ?? []) {
      if (r.sessionId === sessionId && (r.status === "SCHEDULED" || r.status === "FAILED")) {
        r.status = "CANCELLED";
        r.updatedAt = nowIso;
        cancelledAny = true;
      }
    }
    if (hadActiveSchedule || cancelledAny) {
      if (!store.scheduleHistory) store.scheduleHistory = [];
      store.scheduleHistory.push({
        id: cuid(),
        sessionId,
        action: "COMPLETED",
        previousEffectiveDate: toDateKey(s.scheduledEffectiveDate),
        newEffectiveDate: toDateKey(s.scheduledEffectiveDate),
        performedBy,
        detail: `${reason}; pending reminders stopped`,
        createdAt: nowIso,
      });
      saveFileStore(store);
    }
    return;
  }

  const s = await prisma.priceUpdateSession.findUnique({
    where: { id: sessionId },
    select: { id: true, scheduleStatus: true, scheduledEffectiveDate: true },
  });
  if (!s) return;

  const hadActiveSchedule = s.scheduleStatus === "ACTIVE";
  const cancelled = await prisma.priceUpdateReminder.updateMany({
    where: { sessionId, status: { in: ["SCHEDULED", "FAILED"] } },
    data: { status: "CANCELLED" },
  });

  if (hadActiveSchedule) {
    await prisma.priceUpdateSession.update({
      where: { id: sessionId },
      data: { scheduleStatus: "COMPLETED" },
    });
  }
  if (hadActiveSchedule || cancelled.count > 0) {
    await prisma.priceUpdateScheduleHistory.create({
      data: {
        sessionId,
        action: "COMPLETED",
        previousEffectiveDate: s.scheduledEffectiveDate,
        newEffectiveDate: s.scheduledEffectiveDate,
        performedBy,
        detail: `${reason}; pending reminders stopped`,
      },
    });
  }
}

export type CalendarQueryFilters = {
  from?: string | null;
  to?: string | null;
  vendor?: string | null;
  statusFilter?: string | null; // "all" | "scheduled" | "completed" | "cancelled"
  reminderFilter?: string | null; // "all" | "enabled" | "disabled" | "sent" | "failed"
  timeframe?: string | null; // "all" | "upcoming" | "past"
  q?: string | null;
};

export async function queryCalendarEvents(
  prisma: PrismaClient | null,
  filters: CalendarQueryFilters,
  now: Date = new Date(),
): Promise<{
  events: CalendarEventItem[];
  vendors: string[];
  settings: CalendarNotificationSettings;
  todayKey: string;
}> {
  const settings = await getCalendarNotificationSettings(prisma);
  const todayKey = todayDateKeyInTimezone(settings.timezone || DEFAULT_TIMEZONE, now);

  const fromKey = filters.from && isValidDateKey(filters.from) ? filters.from : null;
  const toKey = filters.to && isValidDateKey(filters.to) ? filters.to : null;
  const vendorFilter = filters.vendor?.trim() || "";
  const statusFilter = (filters.statusFilter ?? "all").toLowerCase();
  const reminderFilter = (filters.reminderFilter ?? "all").toLowerCase();
  const timeframe = (filters.timeframe ?? "all").toLowerCase();
  const q = filters.q?.trim().toLowerCase() ?? "";

  let rawEvents: CalendarEventItem[] = [];
  const allVendorsSet = new Set<string>();

  if (!prisma) {
    const store = loadFileStore();
    const itemCounts = new Map<string, number>();
    for (const it of store.items) {
      itemCounts.set(it.sessionId, (itemCounts.get(it.sessionId) ?? 0) + 1);
    }

    for (const s of store.sessions) {
      const eff = toDateKey(s.scheduledEffectiveDate);
      if (!eff) continue;
      if (s.vendor) allVendorsSet.add(s.vendor);
      const reminders = (store.reminders ?? [])
        .filter((r) => r.sessionId === s.id)
        .map((r) => serializeReminder(r, settings));
      const { activeReminder, latestReminder } = pickActiveAndLatest(reminders);
      const history = (store.scheduleHistory ?? [])
        .filter((h) => h.sessionId === s.id)
        .slice()
        .reverse()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 15)
        .map(serializeHistoryRow);

      rawEvents.push({
        id: s.id,
        vendor: s.vendor,
        name: s.name,
        status: s.status,
        createdBy: s.createdBy,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        itemCount: itemCounts.get(s.id) ?? 0,
        scheduledEffectiveDate: eff,
        scheduledAt: s.scheduledAt ?? null,
        scheduledBy: s.scheduledBy ?? null,
        previousStatus: s.previousStatus ?? null,
        scheduleStatus: s.scheduleStatus ?? null,
        scheduleCancelledAt: s.scheduleCancelledAt ?? null,
        scheduleCancelledBy: s.scheduleCancelledBy ?? null,
        activeReminder,
        latestReminder,
        reminderEnabled: Boolean(activeReminder),
        history,
      });
    }
  } else {
    const where: Prisma.PriceUpdateSessionWhereInput = {
      scheduledEffectiveDate: { not: null },
    };

    if (fromKey || toKey) {
      where.scheduledEffectiveDate = {
        not: null,
        ...(fromKey ? { gte: dateKeyToUtcMidnight(fromKey) } : {}),
        ...(toKey ? { lte: dateKeyToUtcMidnight(toKey) } : {}),
      };
    }
    if (vendorFilter) {
      where.vendor = { equals: vendorFilter, mode: "insensitive" };
    }
    if (statusFilter === "scheduled") {
      where.status = "Scheduled";
      where.scheduleStatus = "ACTIVE";
    } else if (statusFilter === "completed" || statusFilter === "exported") {
      where.OR = [{ status: "Exported" }, { scheduleStatus: "COMPLETED" }];
    } else if (statusFilter === "cancelled") {
      where.scheduleStatus = "CANCELLED";
    } else {
      // By default show active scheduled + completed/exported, hiding cancelled unless explicitly filtered
      where.scheduleStatus = { not: "CANCELLED" };
    }

    const [rows, distinctVendors] = await Promise.all([
      prisma.priceUpdateSession.findMany({
        where,
        orderBy: [{ scheduledEffectiveDate: "asc" }, { updatedAt: "desc" }],
        take: 500,
        include: {
          _count: { select: { items: true } },
          reminders: { orderBy: { createdAt: "desc" }, take: 10 },
          scheduleHistory: { orderBy: { createdAt: "desc" }, take: 15 },
        },
      }),
      prisma.priceUpdateSession.findMany({
        where: { scheduledEffectiveDate: { not: null }, vendor: { not: "" } },
        select: { vendor: true },
        distinct: ["vendor"],
        orderBy: { vendor: "asc" },
      }),
    ]);

    for (const v of distinctVendors) {
      if (v.vendor) allVendorsSet.add(v.vendor);
    }

    rawEvents = rows
      .filter((s) => s.scheduledEffectiveDate !== null)
      .map((s) => {
        const eff = toDateKey(s.scheduledEffectiveDate)!;
        const reminders = s.reminders.map((r) => serializeReminder(r, settings));
        const { activeReminder, latestReminder } = pickActiveAndLatest(reminders);
        return {
          id: s.id,
          vendor: s.vendor,
          name: s.name,
          status: s.status,
          createdBy: s.createdBy,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
          itemCount: s._count.items,
          scheduledEffectiveDate: eff,
          scheduledAt: s.scheduledAt ? s.scheduledAt.toISOString() : null,
          scheduledBy: s.scheduledBy ?? null,
          previousStatus: s.previousStatus ?? null,
          scheduleStatus: s.scheduleStatus ?? null,
          scheduleCancelledAt: s.scheduleCancelledAt ? s.scheduleCancelledAt.toISOString() : null,
          scheduleCancelledBy: s.scheduleCancelledBy ?? null,
          activeReminder,
          latestReminder,
          reminderEnabled: Boolean(activeReminder),
          history: s.scheduleHistory.map(serializeHistoryRow),
        };
      });
  }

  // Apply remaining filters uniformly across both DB and file-store paths
  const filtered = rawEvents.filter((ev) => {
    if (fromKey && ev.scheduledEffectiveDate < fromKey) return false;
    if (toKey && ev.scheduledEffectiveDate > toKey) return false;
    if (vendorFilter && ev.vendor.toLowerCase() !== vendorFilter.toLowerCase()) return false;

    if (statusFilter === "scheduled") {
      if (ev.status !== "Scheduled" || ev.scheduleStatus !== "ACTIVE") return false;
    } else if (statusFilter === "completed" || statusFilter === "exported") {
      if (ev.status !== "Exported" && ev.scheduleStatus !== "COMPLETED") return false;
    } else if (statusFilter === "cancelled") {
      if (ev.scheduleStatus !== "CANCELLED") return false;
    } else if (statusFilter === "all") {
      if (ev.scheduleStatus === "CANCELLED") return false;
    }

    if (timeframe === "upcoming" && !isCalendarEventUpcoming(ev, todayKey)) return false;
    if (timeframe === "past" && ev.scheduledEffectiveDate >= todayKey) return false;

    if (reminderFilter === "enabled" && !ev.activeReminder) return false;
    if (reminderFilter === "disabled" && ev.activeReminder) return false;
    if (reminderFilter === "sent" && ev.latestReminder?.status !== "SENT") return false;
    if (reminderFilter === "failed" && ev.latestReminder?.status !== "FAILED") return false;

    if (q) {
      const hay = `${ev.vendor} ${ev.name} ${ev.scheduledEffectiveDate} ${ev.status}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });

  filtered.sort((a, b) => a.scheduledEffectiveDate.localeCompare(b.scheduledEffectiveDate));

  return {
    events: filtered,
    vendors: Array.from(allVendorsSet).sort((a, b) => a.localeCompare(b)),
    settings,
    todayKey,
  };
}
