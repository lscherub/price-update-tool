import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEZONE,
  computeRelativeReminderAt,
  isValidDateKey,
  normalizeRecipientList,
  utcToLocalParts,
  validateAndComputeReminder,
} from "@/lib/calendar";
import {
  cancelSessionSchedule,
  markSessionScheduleCompleted,
  queryCalendarEvents,
  scheduleOrRescheduleSession,
} from "@/lib/calendarServer";
import {
  getCalendarNotificationSettings,
  saveCalendarNotificationSettings,
} from "@/lib/notificationSettings";
import { DATA_FILE, emptyStore, loadFileStore, saveFileStore } from "@/lib/store";

let backupRaw: string | null = null;

function seedBaseStore() {
  const store = emptyStore();
  const now = "2027-01-10T16:00:00.000Z";
  store.sessions.push(
    {
      id: "sess_reviewed",
      vendor: "Flora",
      name: "Flora - January 10, 2027",
      status: "Reviewed",
      notes: "Reviewed by manager",
      createdBy: "buyer@genesis.ca",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sess_ready",
      vendor: "AOR",
      name: "AOR - January 10, 2027",
      status: "Ready",
      notes: "",
      createdBy: "buyer@genesis.ca",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sess_draft",
      vendor: "Now Foods",
      name: "Now Foods - January 10, 2027",
      status: "Draft",
      notes: "",
      createdBy: "buyer@genesis.ca",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sess_empty",
      vendor: "Empty Vendor",
      name: "Empty Vendor - January 10, 2027",
      status: "Ready",
      notes: "",
      createdBy: "buyer@genesis.ca",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sess_exported",
      vendor: "Natural Factors",
      name: "Natural Factors - January 10, 2027",
      status: "Exported",
      notes: "",
      createdBy: "buyer@genesis.ca",
      createdAt: now,
      updatedAt: now,
    },
  );
  for (const sid of ["sess_reviewed", "sess_ready", "sess_draft", "sess_exported"]) {
    store.items.push({
      id: `item_${sid}`,
      sessionId: sid,
      rawVendorSku: "1234567890",
      cleanedSku: "123456789",
      cleanedOverridden: false,
      productId: "prod_1",
      productNumber: "P100",
      productName: "Sample Product",
      brand: "Flora",
      vendor: "Flora",
      discount: "10.00",
      currentListPrice: "15.00",
      vendorListPriceNew: "20.00",
      ourNewListPrice: "18.00",
      marginDivisor: "0.605",
      ourNewRetailPrice: "29.7521",
      oldRetailPrice: "26.99",
      nearest9: "29.79",
      nearest9Custom: null,
      notes: "",
      isInactive: false,
      matched: true,
      updatedAt: now,
    });
  }
  saveFileStore(store);
}

beforeEach(() => {
  backupRaw = fs.existsSync(DATA_FILE) ? fs.readFileSync(DATA_FILE, "utf8") : null;
  seedBaseStore();
});

afterEach(() => {
  if (backupRaw !== null) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, backupRaw);
  } else if (fs.existsSync(DATA_FILE)) {
    fs.unlinkSync(DATA_FILE);
  }
});

describe("Calendar timezone and validation utilities", () => {
  it("computes PST and PDT relative reminders accurately in America/Vancouver", () => {
    // Winter (PST = UTC-8): Jan 25 -> 1 day before = Jan 24 08:00 PST = Jan 24 16:00 UTC
    const winter1 = computeRelativeReminderAt("2027-01-25", "ONE_DAY_BEFORE", DEFAULT_TIMEZONE, 8, 0);
    expect(winter1.toISOString()).toBe("2027-01-24T16:00:00.000Z");
    expect(utcToLocalParts(winter1, DEFAULT_TIMEZONE).dateKey).toBe("2027-01-24");
    expect(utcToLocalParts(winter1, DEFAULT_TIMEZONE).timeHHMM).toBe("08:00");

    // 2 days before: Jan 25 -> Jan 23 08:00 PST
    const winter2 = computeRelativeReminderAt("2027-01-25", "TWO_DAYS_BEFORE", DEFAULT_TIMEZONE, 8, 0);
    expect(winter2.toISOString()).toBe("2027-01-23T16:00:00.000Z");

    // Summer (PDT = UTC-7): July 25 -> 1 day before = July 24 08:00 PDT = July 24 15:00 UTC
    const summer1 = computeRelativeReminderAt("2027-07-25", "ONE_DAY_BEFORE", DEFAULT_TIMEZONE, 8, 0);
    expect(summer1.toISOString()).toBe("2027-07-24T15:00:00.000Z");
    expect(utcToLocalParts(summer1, DEFAULT_TIMEZONE).dateKey).toBe("2027-07-24");
    expect(utcToLocalParts(summer1, DEFAULT_TIMEZONE).timeHHMM).toBe("08:00");
  });

  it("validates calendar date keys and email lists", () => {
    expect(isValidDateKey("2027-01-25")).toBe(true);
    expect(isValidDateKey("2027-02-30")).toBe(false);
    expect(isValidDateKey("not-a-date")).toBe(false);

    const parsed = normalizeRecipientList(["Admin@Genesis.ca", "admin@genesis.ca", "bad-email", "team@genesis.ca"]);
    expect(parsed.valid).toEqual(["admin@genesis.ca", "team@genesis.ca"]);
    expect(parsed.invalid).toEqual(["bad-email"]);
  });

  it("rejects past reminders and requires confirmation for post-effective reminders", () => {
    const now = new Date("2027-01-20T18:00:00.000Z"); // Jan 20 10:00 PST

    const past = validateAndComputeReminder({
      effectiveDateKey: "2027-01-21",
      reminderType: "ONE_DAY_BEFORE",
      timeZone: DEFAULT_TIMEZONE,
      defaultHour: 8,
      defaultMinute: 0,
      now,
    });
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.code).toBe("REMINDER_IN_PAST");

    const afterUnconfirmed = validateAndComputeReminder({
      effectiveDateKey: "2027-01-25",
      reminderType: "CUSTOM",
      customDateKey: "2027-01-27",
      customTimeHHMM: "09:30",
      timeZone: DEFAULT_TIMEZONE,
      defaultHour: 8,
      defaultMinute: 0,
      confirmAfterEffectiveDate: false,
      now,
    });
    expect(afterUnconfirmed.ok).toBe(false);
    if (!afterUnconfirmed.ok) {
      expect(afterUnconfirmed.code).toBe("REMINDER_AFTER_EFFECTIVE_DATE");
      expect(afterUnconfirmed.requiresConfirmation).toBe(true);
    }

    const afterConfirmed = validateAndComputeReminder({
      effectiveDateKey: "2027-01-25",
      reminderType: "CUSTOM",
      customDateKey: "2027-01-27",
      customTimeHHMM: "09:30",
      timeZone: DEFAULT_TIMEZONE,
      defaultHour: 8,
      defaultMinute: 0,
      confirmAfterEffectiveDate: true,
      now,
    });
    expect(afterConfirmed.ok).toBe(true);
  });
});

describe("Scheduling, rescheduling, cancellation, and completion lifecycle", () => {
  const fixedNow = new Date("2027-01-10T18:00:00.000Z");

  it("blocks Draft, empty, and Exported worksheets from scheduling", async () => {
    const draftRes = await scheduleOrRescheduleSession(
      null,
      "sess_draft",
      "admin@genesis.ca",
      { effectiveDate: "2027-03-10", reminderEnabled: false },
      fixedNow,
    );
    expect(draftRes.ok).toBe(false);
    if (!draftRes.ok) expect(draftRes.code).toBe("STATUS_NOT_SCHEDULABLE");

    const emptyRes = await scheduleOrRescheduleSession(
      null,
      "sess_empty",
      "admin@genesis.ca",
      { effectiveDate: "2027-03-10", reminderEnabled: false },
      fixedNow,
    );
    expect(emptyRes.ok).toBe(false);
    if (!emptyRes.ok) expect(emptyRes.code).toBe("EMPTY_WORKSHEET");

    const expRes = await scheduleOrRescheduleSession(
      null,
      "sess_exported",
      "admin@genesis.ca",
      { effectiveDate: "2027-03-10", reminderEnabled: false },
      fixedNow,
    );
    expect(expRes.ok).toBe(false);
    if (!expRes.ok) expect(expRes.code).toBe("STATUS_NOT_SCHEDULABLE");
  });

  it("blocks enabling reminders when no recipients are configured", async () => {
    const res = await scheduleOrRescheduleSession(
      null,
      "sess_reviewed",
      "admin@genesis.ca",
      { effectiveDate: "2027-03-10", reminderEnabled: true, reminderType: "ONE_DAY_BEFORE" },
      fixedNow,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NO_RECIPIENTS");
  });

  it("schedules a Reviewed worksheet, appears on calendar, recalculates relative reminders on reschedule, and preserves previousStatus on cancel", async () => {
    await saveCalendarNotificationSettings(null, {
      recipients: ["pricing@genesis.ca", "manager@genesis.ca"],
      timezone: DEFAULT_TIMEZONE,
      defaultReminderHour: 8,
      defaultReminderMinute: 0,
      defaultSendReminder: false,
    });

    const initial = await scheduleOrRescheduleSession(
      null,
      "sess_reviewed",
      "admin@genesis.ca",
      {
        effectiveDate: "2027-01-25",
        reminderEnabled: true,
        reminderType: "ONE_DAY_BEFORE",
      },
      fixedNow,
    );
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;

    expect(initial.session.status).toBe("Scheduled");
    expect(initial.session.schedule.previousStatus).toBe("Reviewed");
    expect(initial.session.schedule.scheduledEffectiveDate).toBe("2027-01-25");
    expect(initial.session.schedule.activeReminder?.scheduledReminderLocal.dateKey).toBe("2027-01-24");

    // Verify no duplicate session was created and pricing item was untouched
    const storeAfterSchedule = loadFileStore();
    expect(storeAfterSchedule.sessions.filter((s) => s.vendor === "Flora")).toHaveLength(1);
    expect(storeAfterSchedule.items.find((i) => i.sessionId === "sess_reviewed")?.nearest9).toBe("29.79");

    // Verify Calendar query sees it
    const cal = await queryCalendarEvents(null, { vendor: "Flora", statusFilter: "scheduled" }, fixedNow);
    expect(cal.events).toHaveLength(1);
    expect(cal.events[0].id).toBe("sess_reviewed");
    expect(cal.events[0].reminderEnabled).toBe(true);

    // Reschedule (date-only) to Feb 5 -> relative reminder auto-recalculates to Feb 4
    const reschedNow = new Date("2027-01-10T18:05:00.000Z");
    const resched = await scheduleOrRescheduleSession(
      null,
      "sess_reviewed",
      "admin@genesis.ca",
      {
        effectiveDate: "2027-02-05",
        reminderEnabled: true,
        preserveExistingReminder: true,
      },
      reschedNow,
    );
    expect(resched.ok).toBe(true);
    if (!resched.ok) return;
    expect(resched.action).toBe("RESCHEDULED");
    expect(resched.session.schedule.scheduledEffectiveDate).toBe("2027-02-05");
    expect(resched.session.schedule.activeReminder?.scheduledReminderLocal.dateKey).toBe("2027-02-04");
    expect(resched.session.schedule.history.length).toBe(2);
    expect(resched.session.schedule.history[0].action).toBe("RESCHEDULED");

    // Cancel schedule -> restores Reviewed (NOT blindly Ready), cancels reminder, removes from active calendar
    const cancel = await cancelSessionSchedule(null, "sess_reviewed", "admin@genesis.ca", fixedNow);
    expect(cancel.ok).toBe(true);
    if (!cancel.ok) return;
    expect(cancel.restoredStatus).toBe("Reviewed");
    expect(cancel.cancelledReminders).toBe(1);

    const calAfterCancel = await queryCalendarEvents(null, { statusFilter: "all" }, fixedNow);
    expect(calAfterCancel.events.find((e) => e.id === "sess_reviewed")).toBeUndefined();

    // Original worksheet & item remain intact
    const storeFinal = loadFileStore();
    const sess = storeFinal.sessions.find((s) => s.id === "sess_reviewed");
    expect(sess?.status).toBe("Reviewed");
    expect(storeFinal.items.find((i) => i.sessionId === "sess_reviewed")?.nearest9).toBe("29.79");
  });

  it("preserves custom reminder date on reschedule and keeps custom recipients isolated from global default edits", async () => {
    await saveCalendarNotificationSettings(null, {
      recipients: ["default@genesis.ca"],
      timezone: DEFAULT_TIMEZONE,
      defaultReminderHour: 8,
      defaultReminderMinute: 0,
      defaultSendReminder: false,
    });

    const sched = await scheduleOrRescheduleSession(
      null,
      "sess_ready",
      "admin@genesis.ca",
      {
        effectiveDate: "2027-02-20",
        reminderEnabled: true,
        reminderType: "CUSTOM",
        customDateKey: "2027-02-15",
        customTimeHHMM: "10:30",
        useCustomRecipients: true,
        customRecipients: ["special@genesis.ca"],
      },
      fixedNow,
    );
    expect(sched.ok).toBe(true);

    // Change global default recipients -> worksheet-specific recipients must NOT be overwritten
    await saveCalendarNotificationSettings(null, {
      recipients: ["new-global@genesis.ca"],
      timezone: DEFAULT_TIMEZONE,
      defaultReminderHour: 8,
      defaultReminderMinute: 0,
      defaultSendReminder: false,
    });

    // Date-only reschedule from Feb 20 -> Feb 25: custom reminder must remain Feb 15 10:30
    const resched = await scheduleOrRescheduleSession(
      null,
      "sess_ready",
      "admin@genesis.ca",
      {
        effectiveDate: "2027-02-25",
        reminderEnabled: true,
        preserveExistingReminder: true,
      },
      fixedNow,
    );
    expect(resched.ok).toBe(true);
    if (!resched.ok) return;
    expect(resched.session.schedule.activeReminder?.scheduledReminderLocal.dateKey).toBe("2027-02-15");
    expect(resched.session.schedule.activeReminder?.scheduledReminderLocal.timeHHMM).toBe("10:30");
    expect(resched.session.schedule.activeReminder?.effectiveRecipients).toEqual(["special@genesis.ca"]);

    // Reschedule earlier to Feb 12 -> custom reminder (Feb 15) is now AFTER effective date -> requires confirmation!
    const earlier = await scheduleOrRescheduleSession(
      null,
      "sess_ready",
      "admin@genesis.ca",
      {
        effectiveDate: "2027-02-12",
        reminderEnabled: true,
        preserveExistingReminder: true,
      },
      fixedNow,
    );
    expect(earlier.ok).toBe(false);
    if (!earlier.ok) {
      expect(earlier.code).toBe("REMINDER_AFTER_EFFECTIVE_DATE");
      expect(earlier.requiresConfirmation).toBe(true);
    }

    // Marking exported/completed stops pending reminders
    await markSessionScheduleCompleted(null, "sess_ready", "admin@genesis.ca", "POS CSV exported", fixedNow);
    const store = loadFileStore();
    expect(store.sessions.find((s) => s.id === "sess_ready")?.scheduleStatus).toBe("COMPLETED");
    expect(store.reminders?.every((r) => r.sessionId !== "sess_ready" || r.status === "CANCELLED")).toBe(true);

    // Settings load confirms persistence
    const loadedSettings = await getCalendarNotificationSettings(null);
    expect(loadedSettings.recipients).toEqual(["new-global@genesis.ca"]);
  });

  it("persists multiple recipients, partial updates, edits, removals, and preserves timezone defaults", async () => {
    // Save timezone + defaults + first recipient
    const s1 = await saveCalendarNotificationSettings(null, {
      recipients: ["one@genesis.ca", "two@genesis.ca"],
      timezone: "America/Toronto",
      defaultReminderHour: 9,
      defaultReminderMinute: 30,
      defaultSendReminder: true,
    });
    expect(s1.ok).toBe(true);

    // Partial update touching ONLY recipients (e.g. removing one) must preserve timezone & defaults
    const s2 = await saveCalendarNotificationSettings(null, {
      recipients: ["one@genesis.ca", "three@genesis.ca"],
    });
    expect(s2.ok).toBe(true);
    if (!s2.ok) return;
    expect(s2.settings.recipients).toEqual(["one@genesis.ca", "three@genesis.ca"]);
    expect(s2.settings.timezone).toBe("America/Toronto");
    expect(s2.settings.defaultReminderHour).toBe(9);
    expect(s2.settings.defaultReminderMinute).toBe(30);
    expect(s2.settings.defaultSendReminder).toBe(true);

    // Fresh reload from storage matches persisted database state
    const reloaded = await getCalendarNotificationSettings(null);
    expect(reloaded.recipients).toEqual(["one@genesis.ca", "three@genesis.ca"]);
    expect(reloaded.timezone).toBe("America/Toronto");

    // Invalid email is rejected without wiping existing saved recipients
    const bad = await saveCalendarNotificationSettings(null, {
      recipients: ["one@genesis.ca", "not-valid"],
    });
    expect(bad.ok).toBe(false);
    const stillIntact = await getCalendarNotificationSettings(null);
    expect(stillIntact.recipients).toEqual(["one@genesis.ca", "three@genesis.ca"]);
  });
});
