/**
 * Pure calendar, scheduling, timezone, and reminder calculation utilities.
 * Shared safely across server routes, background jobs, client components, and tests.
 */

export const DEFAULT_TIMEZONE = "America/Vancouver";
export const DEFAULT_REMINDER_HOUR = 8;
export const DEFAULT_REMINDER_MINUTE = 0;

export const SUPPORTED_TIMEZONES: { value: string; label: string }[] = [
  { value: "America/Vancouver", label: "Pacific Time (Vancouver / Los Angeles)" },
  { value: "America/Edmonton", label: "Mountain Time (Edmonton / Denver)" },
  { value: "America/Winnipeg", label: "Central Time (Winnipeg / Chicago)" },
  { value: "America/Toronto", label: "Eastern Time (Toronto / New York)" },
  { value: "America/Halifax", label: "Atlantic Time (Halifax)" },
  { value: "UTC", label: "UTC" },
];

export const REMINDER_TYPES = ["ONE_DAY_BEFORE", "TWO_DAYS_BEFORE", "CUSTOM"] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

export const REMINDER_STATUSES = [
  "SCHEDULED",
  "PROCESSING",
  "SENT",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const SCHEDULE_STATUSES = ["ACTIVE", "CANCELLED", "COMPLETED"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

/** Existing worksheet lifecycle statuses + Scheduled. */
export const ALL_SESSION_STATUSES = new Set([
  "Draft",
  "Ready",
  "Being Reviewed",
  "Reviewed",
  "Scheduled",
  "Exported",
]);

/** Statuses eligible to be scheduled (or rescheduled). Draft & Exported cannot be scheduled. */
export const SCHEDULABLE_STATUSES = new Set([
  "Ready",
  "Being Reviewed",
  "Reviewed",
  "Scheduled",
]);

/** Valid statuses that can be restored when a schedule is cancelled. */
export const RESTORABLE_STATUSES = new Set([
  "Ready",
  "Being Reviewed",
  "Reviewed",
]);

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_HHMM_RE = /^(\d{2}):(\d{2})$/;
const EMAIL_RE = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]{2,}$/;

export function isValidTimezone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidDateKey(value: string): boolean {
  const m = DATE_KEY_RE.exec(value.trim());
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function isValidTimeHHMM(value: string): boolean {
  const m = TIME_HHMM_RE.exec(value.trim());
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

/** Extract YYYY-MM-DD from a Date (SQL DATE comes back at UTC midnight) or string. */
export function toDateKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (isValidDateKey(trimmed)) return trimmed;
    const prefix = trimmed.slice(0, 10);
    if (isValidDateKey(prefix)) return prefix;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}

/** Convert a YYYY-MM-DD date key to a Date at UTC midnight for Prisma @db.Date storage. */
export function dateKeyToUtcMidnight(key: string): Date {
  if (!isValidDateKey(key)) throw new Error(`Invalid date key: ${key}`);
  return new Date(`${key}T00:00:00.000Z`);
}

/** Pure calendar date arithmetic on YYYY-MM-DD strings (immune to DST shifts). */
export function addDaysToDateKey(dateKey: string, deltaDays: number): string {
  const base = dateKeyToUtcMidnight(dateKey);
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

/** Number of whole calendar days from dateKeyA to dateKeyB (B - A). */
export function diffDateKeysDays(dateKeyA: string, dateKeyB: string): number {
  const a = dateKeyToUtcMidnight(dateKeyA).getTime();
  const b = dateKeyToUtcMidnight(dateKeyB).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function getZoneParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = get("hour");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: hour === 24 ? 0 : hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Current YYYY-MM-DD calendar date in the given IANA timezone. */
export function todayDateKeyInTimezone(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  const tz = isValidTimezone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const p = getZoneParts(now, tz);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Convert a wall-clock local date + hour:minute in an IANA timezone to the exact UTC Date.
 * Uses two-pass offset convergence so DST transitions resolve accurately without external libs.
 */
export function localDateTimeToUtc(
  dateKey: string,
  hour: number,
  minute: number,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  if (!isValidDateKey(dateKey)) throw new Error(`Invalid date: ${dateKey}`);
  const tz = isValidTimezone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const [y, m, d] = dateKey.split("-").map(Number);
  const targetAsUtcMs = Date.UTC(y, m - 1, d, hour, minute, 0, 0);

  let guess = targetAsUtcMs;
  for (let i = 0; i < 3; i++) {
    const p = getZoneParts(new Date(guess), tz);
    const renderedAsUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
    const diff = targetAsUtcMs - renderedAsUtcMs;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/** Convert a UTC timestamp back into wall-clock parts in the target timezone. */
export function utcToLocalParts(
  utcDate: Date | string,
  timeZone: string = DEFAULT_TIMEZONE,
): { dateKey: string; timeHHMM: string; formatted: string } {
  const tz = isValidTimezone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const d = typeof utcDate === "string" ? new Date(utcDate) : utcDate;
  const p = getZoneParts(d, tz);
  const dateKey = `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const timeHHMM = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
  return { dateKey, timeHHMM, formatted };
}

/** Compute UTC reminder instant for relative reminder types ("ONE_DAY_BEFORE" | "TWO_DAYS_BEFORE"). */
export function computeRelativeReminderAt(
  effectiveDateKey: string,
  reminderType: "ONE_DAY_BEFORE" | "TWO_DAYS_BEFORE",
  timeZone: string = DEFAULT_TIMEZONE,
  hour: number = DEFAULT_REMINDER_HOUR,
  minute: number = DEFAULT_REMINDER_MINUTE,
): Date {
  const offsetDays = reminderType === "TWO_DAYS_BEFORE" ? -2 : -1;
  const reminderDateKey = addDaysToDateKey(effectiveDateKey, offsetDays);
  return localDateTimeToUtc(reminderDateKey, hour, minute, timeZone);
}

export function formatDateKeyLong(dateKey: string): string {
  if (!isValidDateKey(dateKey)) return dateKey;
  const dt = dateKeyToUtcMidnight(dateKey);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(dt);
}

export function formatDateKeyShort(dateKey: string): string {
  if (!isValidDateKey(dateKey)) return dateKey;
  const dt = dateKeyToUtcMidnight(dateKey);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(dt);
}

export function getReminderTypeLabel(type: string): string {
  if (type === "ONE_DAY_BEFORE") return "1 day before effective date";
  if (type === "TWO_DAYS_BEFORE") return "2 days before effective date";
  if (type === "CUSTOM") return "Custom date & time";
  return type;
}

export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  return EMAIL_RE.test(trimmed);
}

export function normalizeRecipientList(raw: unknown): { valid: string[]; invalid: string[] } {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const item of arr) {
    const cleaned = String(item ?? "").trim();
    if (!cleaned) continue;
    const lower = cleaned.toLowerCase();
    if (!isValidEmail(lower)) {
      invalid.push(cleaned);
      continue;
    }
    if (!seen.has(lower)) {
      seen.add(lower);
      valid.push(lower);
    }
  }
  return { valid, invalid };
}

export type ReminderValidationResult =
  | { ok: true; scheduledReminderAt: Date; reminderDateKey: string; isAfterEffectiveDate: boolean }
  | {
      ok: false;
      code: "INVALID_REMINDER_TYPE" | "INVALID_CUSTOM_DATETIME" | "REMINDER_IN_PAST" | "REMINDER_AFTER_EFFECTIVE_DATE";
      error: string;
      requiresConfirmation?: boolean;
      scheduledReminderAt?: Date;
    };

export function validateAndComputeReminder(params: {
  effectiveDateKey: string;
  reminderType: ReminderType;
  customDateKey?: string | null;
  customTimeHHMM?: string | null;
  customReminderAtIso?: string | null;
  timeZone: string;
  defaultHour: number;
  defaultMinute: number;
  confirmAfterEffectiveDate?: boolean;
  now?: Date;
}): ReminderValidationResult {
  const now = params.now ?? new Date();
  const tz = isValidTimezone(params.timeZone) ? params.timeZone : DEFAULT_TIMEZONE;

  let scheduledReminderAt: Date;
  if (params.reminderType === "ONE_DAY_BEFORE" || params.reminderType === "TWO_DAYS_BEFORE") {
    scheduledReminderAt = computeRelativeReminderAt(
      params.effectiveDateKey,
      params.reminderType,
      tz,
      params.defaultHour,
      params.defaultMinute,
    );
  } else if (params.reminderType === "CUSTOM") {
    if (params.customDateKey && params.customTimeHHMM) {
      if (!isValidDateKey(params.customDateKey) || !isValidTimeHHMM(params.customTimeHHMM)) {
        return {
          ok: false,
          code: "INVALID_CUSTOM_DATETIME",
          error: "Enter a valid custom reminder date and time.",
        };
      }
      const [h, min] = params.customTimeHHMM.split(":").map(Number);
      scheduledReminderAt = localDateTimeToUtc(params.customDateKey, h, min, tz);
    } else if (params.customReminderAtIso) {
      const parsed = new Date(params.customReminderAtIso);
      if (Number.isNaN(parsed.getTime())) {
        return {
          ok: false,
          code: "INVALID_CUSTOM_DATETIME",
          error: "Enter a valid custom reminder date and time.",
        };
      }
      scheduledReminderAt = parsed;
    } else {
      return {
        ok: false,
        code: "INVALID_CUSTOM_DATETIME",
        error: "Select a custom reminder date and time.",
      };
    }
  } else {
    return {
      ok: false,
      code: "INVALID_REMINDER_TYPE",
      error: "Invalid reminder timing option.",
    };
  }

  // Must not be in the past (allow a small 30-second clock buffer).
  if (scheduledReminderAt.getTime() <= now.getTime() - 30_000) {
    const localStr = utcToLocalParts(scheduledReminderAt, tz).formatted;
    return {
      ok: false,
      code: "REMINDER_IN_PAST",
      error: `The reminder time (${localStr}) is in the past. Choose a future date or switch to a custom reminder time.`,
    };
  }

  const reminderDateKey = utcToLocalParts(scheduledReminderAt, tz).dateKey;
  const isAfterEffectiveDate = reminderDateKey > params.effectiveDateKey;

  if (isAfterEffectiveDate && !params.confirmAfterEffectiveDate) {
    return {
      ok: false,
      code: "REMINDER_AFTER_EFFECTIVE_DATE",
      error: `The reminder date (${formatDateKeyShort(reminderDateKey)}) is after the effective date (${formatDateKeyShort(params.effectiveDateKey)}). Confirm if you intentionally want a post-effective reminder.`,
      requiresConfirmation: true,
      scheduledReminderAt,
    };
  }

  return {
    ok: true,
    scheduledReminderAt,
    reminderDateKey,
    isAfterEffectiveDate,
  };
}
