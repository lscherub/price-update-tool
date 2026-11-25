/**
 * Persistent global notification & calendar settings and reminder run history
 * backed by AppSetting (PostgreSQL) with dev JSON file-store parity.
 *
 * Scope: Application-wide shared defaults so all authorized staff scheduling
 * price updates consistently see and use the configured recipient list.
 */
import type { PrismaClient } from "@prisma/client";
import { loadFileStore, saveFileStore } from "./store";
import {
  DEFAULT_REMINDER_HOUR,
  DEFAULT_REMINDER_MINUTE,
  DEFAULT_TIMEZONE,
  isValidTimezone,
  normalizeRecipientList,
} from "./calendar";

export const CALENDAR_NOTIFICATION_SETTINGS_KEY = "calendar_notification_settings";
export const REMINDER_RUN_HISTORY_KEY = "calendar_reminder_run_history";
const MAX_RUN_HISTORY_ENTRIES = 25;

export type CalendarNotificationSettings = {
  recipients: string[];
  timezone: string;
  defaultReminderHour: number;
  defaultReminderMinute: number;
  defaultSendReminder: boolean;
  updatedAt?: string | null;
};

export type ReminderRunHistoryEntry = {
  id: string;
  ranAt: string;
  source: "cron" | "manual";
  triggeredBy: string;
  ok: boolean;
  skippedBecauseDisabled?: boolean;
  claimed: number;
  attempted: number;
  sent: number;
  failed: number;
  retriedScheduled: number;
  expired: number;
  cancelled: number;
  error?: string | null;
};

export const DEFAULT_CALENDAR_NOTIFICATION_SETTINGS: CalendarNotificationSettings = {
  recipients: [],
  timezone: DEFAULT_TIMEZONE,
  defaultReminderHour: DEFAULT_REMINDER_HOUR,
  defaultReminderMinute: DEFAULT_REMINDER_MINUTE,
  defaultSendReminder: false,
  updatedAt: null,
};

const ENSURE_APP_SETTING_SQL =
  `CREATE TABLE IF NOT EXISTS "AppSetting" (` +
  `"key" TEXT PRIMARY KEY, ` +
  `"value" TEXT NOT NULL DEFAULT '', ` +
  `"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()` +
  `)`;

function parseSettingsPayload(raw: string | null | undefined, updatedAt?: string | null): CalendarNotificationSettings {
  if (!raw) return { ...DEFAULT_CALENDAR_NOTIFICATION_SETTINGS, updatedAt: updatedAt ?? null };
  try {
    const parsed = JSON.parse(raw) as Partial<CalendarNotificationSettings>;
    const { valid } = normalizeRecipientList(parsed.recipients ?? []);
    const tz = typeof parsed.timezone === "string" && isValidTimezone(parsed.timezone)
      ? parsed.timezone
      : DEFAULT_TIMEZONE;
    const hour = Number.isInteger(parsed.defaultReminderHour) &&
      (parsed.defaultReminderHour as number) >= 0 &&
      (parsed.defaultReminderHour as number) <= 23
      ? (parsed.defaultReminderHour as number)
      : DEFAULT_REMINDER_HOUR;
    const minute = Number.isInteger(parsed.defaultReminderMinute) &&
      (parsed.defaultReminderMinute as number) >= 0 &&
      (parsed.defaultReminderMinute as number) <= 59
      ? (parsed.defaultReminderMinute as number)
      : DEFAULT_REMINDER_MINUTE;

    return {
      recipients: valid,
      timezone: tz,
      defaultReminderHour: hour,
      defaultReminderMinute: minute,
      defaultSendReminder: Boolean(parsed.defaultSendReminder),
      updatedAt: updatedAt ?? null,
    };
  } catch {
    return { ...DEFAULT_CALENDAR_NOTIFICATION_SETTINGS, updatedAt: updatedAt ?? null };
  }
}

async function readAppSettingRaw(
  prisma: PrismaClient | null,
  key: string,
): Promise<{ value: string; updatedAt: string | null } | null> {
  if (!prisma) {
    const store = loadFileStore();
    const raw = store.appSettings?.[key];
    return raw !== undefined ? { value: raw, updatedAt: null } : null;
  }
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    if (!row) return null;
    return {
      value: row.value,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    };
  } catch (e) {
    if ((e as { code?: string })?.code === "P2021") {
      await prisma.$executeRawUnsafe(ENSURE_APP_SETTING_SQL);
      return null;
    }
    throw e;
  }
}

async function writeAppSettingRaw(
  prisma: PrismaClient | null,
  key: string,
  value: string,
): Promise<string> {
  const nowIso = new Date().toISOString();
  if (!prisma) {
    const store = loadFileStore();
    if (!store.appSettings) store.appSettings = {};
    store.appSettings[key] = value;
    saveFileStore(store);
    return nowIso;
  }
  try {
    const row = await prisma.appSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    return row.updatedAt ? row.updatedAt.toISOString() : nowIso;
  } catch (e) {
    if ((e as { code?: string })?.code === "P2021") {
      await prisma.$executeRawUnsafe(ENSURE_APP_SETTING_SQL);
      const row = await prisma.appSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
      return row.updatedAt ? row.updatedAt.toISOString() : nowIso;
    }
    throw e;
  }
}

export async function getCalendarNotificationSettings(
  prisma: PrismaClient | null,
): Promise<CalendarNotificationSettings> {
  const row = await readAppSettingRaw(prisma, CALENDAR_NOTIFICATION_SETTINGS_KEY);
  if (!row) return { ...DEFAULT_CALENDAR_NOTIFICATION_SETTINGS };
  return parseSettingsPayload(row.value, row.updatedAt);
}

export async function saveCalendarNotificationSettings(
  prisma: PrismaClient | null,
  input: {
    recipients?: unknown;
    timezone?: unknown;
    defaultReminderHour?: unknown;
    defaultReminderMinute?: unknown;
    defaultSendReminder?: unknown;
  },
): Promise<{ ok: true; settings: CalendarNotificationSettings } | { ok: false; error: string }> {
  const existing = await getCalendarNotificationSettings(prisma);

  const recipientsSource = input.recipients !== undefined ? input.recipients : existing.recipients;
  const { valid, invalid } = normalizeRecipientList(recipientsSource);
  if (invalid.length > 0) {
    return {
      ok: false,
      error: `Invalid email address${invalid.length === 1 ? "" : "es"}: ${invalid.slice(0, 5).join(", ")}`,
    };
  }
  if (valid.length > 50) {
    return { ok: false, error: "Too many default recipients (maximum 50)." };
  }

  const tzRaw = input.timezone !== undefined
    ? String(input.timezone ?? "").trim()
    : existing.timezone;
  if (!isValidTimezone(tzRaw)) {
    return { ok: false, error: `Unsupported timezone: ${tzRaw}` };
  }

  const hour = input.defaultReminderHour !== undefined
    ? Number(input.defaultReminderHour)
    : existing.defaultReminderHour;
  const minute = input.defaultReminderMinute !== undefined
    ? Number(input.defaultReminderMinute)
    : existing.defaultReminderMinute;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return { ok: false, error: "Default reminder hour must be between 0 and 23." };
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return { ok: false, error: "Default reminder minute must be between 0 and 59." };
  }

  const defaultSendReminder = input.defaultSendReminder !== undefined
    ? Boolean(input.defaultSendReminder)
    : existing.defaultSendReminder;

  const payload = {
    recipients: valid,
    timezone: tzRaw,
    defaultReminderHour: hour,
    defaultReminderMinute: minute,
    defaultSendReminder,
  };
  const updatedAt = await writeAppSettingRaw(
    prisma,
    CALENDAR_NOTIFICATION_SETTINGS_KEY,
    JSON.stringify(payload),
  );
  return { ok: true, settings: { ...payload, updatedAt } };
}

export async function getReminderRunHistory(
  prisma: PrismaClient | null,
): Promise<ReminderRunHistoryEntry[]> {
  try {
    const row = await readAppSettingRaw(prisma, REMINDER_RUN_HISTORY_KEY);
    if (!row?.value) return [];
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_RUN_HISTORY_ENTRIES) as ReminderRunHistoryEntry[];
  } catch {
    return [];
  }
}

export async function appendReminderRunHistory(
  prisma: PrismaClient | null,
  entry: ReminderRunHistoryEntry,
): Promise<void> {
  try {
    const current = await getReminderRunHistory(prisma);
    const next = [entry, ...current].slice(0, MAX_RUN_HISTORY_ENTRIES);
    await writeAppSettingRaw(prisma, REMINDER_RUN_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Diagnostics logging must never break reminder processing
  }
}
