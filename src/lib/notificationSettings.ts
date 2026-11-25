/**
 * Persistent global notification & calendar settings backed by AppSetting
 * (PostgreSQL) with dev JSON file-store parity.
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

export type CalendarNotificationSettings = {
  recipients: string[];
  timezone: string;
  defaultReminderHour: number;
  defaultReminderMinute: number;
  defaultSendReminder: boolean;
  updatedAt?: string | null;
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

export async function getCalendarNotificationSettings(
  prisma: PrismaClient | null,
): Promise<CalendarNotificationSettings> {
  if (!prisma) {
    const store = loadFileStore();
    const raw = store.appSettings?.[CALENDAR_NOTIFICATION_SETTINGS_KEY];
    return parseSettingsPayload(raw, null);
  }
  await prisma.$executeRawUnsafe(ENSURE_APP_SETTING_SQL);
  const rows = await prisma.$queryRawUnsafe<{ value: string; updatedAt: Date }[]>(
    `SELECT "value", "updatedAt" FROM "AppSetting" WHERE "key" = $1 LIMIT 1`,
    CALENDAR_NOTIFICATION_SETTINGS_KEY,
  );
  if (!Array.isArray(rows) || !rows.length) {
    return { ...DEFAULT_CALENDAR_NOTIFICATION_SETTINGS };
  }
  const updatedAt = rows[0].updatedAt instanceof Date
    ? rows[0].updatedAt.toISOString()
    : rows[0].updatedAt ? String(rows[0].updatedAt) : null;
  return parseSettingsPayload(rows[0].value, updatedAt);
}

export async function saveCalendarNotificationSettings(
  prisma: PrismaClient | null,
  input: {
    recipients: unknown;
    timezone?: unknown;
    defaultReminderHour?: unknown;
    defaultReminderMinute?: unknown;
    defaultSendReminder?: unknown;
  },
): Promise<{ ok: true; settings: CalendarNotificationSettings } | { ok: false; error: string }> {
  const { valid, invalid } = normalizeRecipientList(input.recipients);
  if (invalid.length > 0) {
    return {
      ok: false,
      error: `Invalid email address${invalid.length === 1 ? "" : "es"}: ${invalid.slice(0, 5).join(", ")}`,
    };
  }
  if (valid.length > 50) {
    return { ok: false, error: "Too many default recipients (maximum 50)." };
  }

  const tzRaw = typeof input.timezone === "string" ? input.timezone.trim() : DEFAULT_TIMEZONE;
  if (!isValidTimezone(tzRaw)) {
    return { ok: false, error: `Unsupported timezone: ${tzRaw}` };
  }

  const hour = input.defaultReminderHour === undefined ? DEFAULT_REMINDER_HOUR : Number(input.defaultReminderHour);
  const minute = input.defaultReminderMinute === undefined ? DEFAULT_REMINDER_MINUTE : Number(input.defaultReminderMinute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return { ok: false, error: "Default reminder hour must be between 0 and 23." };
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return { ok: false, error: "Default reminder minute must be between 0 and 59." };
  }

  const payload = {
    recipients: valid,
    timezone: tzRaw,
    defaultReminderHour: hour,
    defaultReminderMinute: minute,
    defaultSendReminder: Boolean(input.defaultSendReminder),
  };
  const serialized = JSON.stringify(payload);
  const nowIso = new Date().toISOString();

  if (!prisma) {
    const store = loadFileStore();
    if (!store.appSettings) store.appSettings = {};
    store.appSettings[CALENDAR_NOTIFICATION_SETTINGS_KEY] = serialized;
    saveFileStore(store);
    return { ok: true, settings: { ...payload, updatedAt: nowIso } };
  }

  await prisma.$executeRawUnsafe(ENSURE_APP_SETTING_SQL);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AppSetting" ("key", "value", "updatedAt") VALUES ($1, $2, now()) ` +
      `ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()`,
    CALENDAR_NOTIFICATION_SETTINGS_KEY,
    serialized,
  );
  return { ok: true, settings: { ...payload, updatedAt: nowIso } };
}
