import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TIMEZONE } from "@/lib/calendar";
import { scheduleOrRescheduleSession } from "@/lib/calendarServer";
import { saveCalendarNotificationSettings } from "@/lib/notificationSettings";
import {
  computeNextCronRun,
  getReminderDiagnostics,
  processDueReminders,
  verifyCronAuth,
} from "@/lib/reminderProcessor";
import {
  SMTP2GO_SEND_URL,
  buildReminderEmailContent,
  getSmtp2goPublicStatus,
  sendViaSmtp2go,
} from "@/lib/smtp2go";
import { emptyStore, loadFileStore, saveFileStore } from "@/lib/store";

let tmpStoreFile = "";
const envBackup: Record<string, string | undefined> = {};

function setEnv(k: string, v: string | undefined) {
  if (!(k in envBackup)) envBackup[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

function seedScheduledStore() {
  const store = emptyStore();
  const now = "2027-01-10T16:00:00.000Z";
  store.sessions.push({
    id: "sess_flora",
    vendor: "Flora",
    name: "Flora - January 10, 2027",
    status: "Reviewed",
    notes: "",
    createdBy: "admin@genesis.ca",
    createdAt: now,
    updatedAt: now,
  });
  store.items.push({
    id: "item_1",
    sessionId: "sess_flora",
    rawVendorSku: "111222333",
    cleanedSku: "11122233",
    cleanedOverridden: false,
    productId: "p1",
    productNumber: "P1",
    productName: "Flora Flax Oil",
    brand: "Flora",
    vendor: "Flora",
    discount: "10.00",
    currentListPrice: "10.00",
    vendorListPriceNew: "12.00",
    ourNewListPrice: "10.80",
    marginDivisor: "0.605",
    ourNewRetailPrice: "17.8512",
    oldRetailPrice: "16.99",
    nearest9: "17.89",
    nearest9Custom: null,
    notes: "",
    isInactive: false,
    matched: true,
    updatedAt: now,
  });
  saveFileStore(store);
}

beforeEach(() => {
  tmpStoreFile = path.join(os.tmpdir(), `reminder-proc-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  process.env.TEST_STORE_FILE = tmpStoreFile;
  seedScheduledStore();
});

afterEach(() => {
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete envBackup[k];
  }
  delete process.env.TEST_STORE_FILE;
  if (tmpStoreFile && fs.existsSync(tmpStoreFile)) {
    fs.unlinkSync(tmpStoreFile);
  }
});

describe("SMTP2GO email builder, client, and security", () => {
  it("adapts subject and body for tomorrow, 2 days before, and custom dates with secure worksheet link", () => {
    const tomorrow = buildReminderEmailContent({
      sessionId: "sess_flora",
      vendor: "Flora",
      worksheetName: "Flora - January 10, 2027",
      effectiveDateKey: "2027-01-25",
      status: "Scheduled",
      reminderType: "ONE_DAY_BEFORE",
      timeZone: DEFAULT_TIMEZONE,
      now: new Date("2027-01-24T16:00:00.000Z"),
      appBaseUrl: "https://pricing.genesisnutrition.ca",
    });
    expect(tomorrow.subject).toBe("Reminder: Flora Price Update Scheduled for Tomorrow");
    expect(tomorrow.textBody).toContain("https://pricing.genesisnutrition.ca/sessions/sess_flora");
    expect(tomorrow.htmlBody).toContain("Open Price Update Worksheet");

    const twoDays = buildReminderEmailContent({
      sessionId: "sess_flora",
      vendor: "Flora",
      worksheetName: "Flora - January 10, 2027",
      effectiveDateKey: "2027-01-25",
      status: "Scheduled",
      reminderType: "TWO_DAYS_BEFORE",
      timeZone: DEFAULT_TIMEZONE,
      now: new Date("2027-01-23T16:00:00.000Z"),
      appBaseUrl: "https://pricing.genesisnutrition.ca",
    });
    expect(twoDays.subject).toContain("in 2 Days");
    expect(twoDays.textBody).toContain("take effect in 2 days");
  });

  it("sends correct SMTP2GO v3 payload and handles success vs failure responses without exposing API key", async () => {
    setEnv("SMTP2GO_API_KEY", "api-SECRETKEY1234567890ABCDEF123456");
    setEnv("SMTP2GO_FROM_EMAIL", "alerts@genesisnutrition.ca");
    setEnv("SMTP2GO_FROM_NAME", "Genesis Nutrition");

    // Public status never exposes secret API key
    const pub = getSmtp2goPublicStatus();
    expect(pub.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(pub)).not.toContain("SECRETKEY");

    // Success response
    const mockFetchOk = vi.fn(async () =>
      new Response(
        JSON.stringify({
          request_id: "req-123",
          data: { succeeded: 2, failed: 0, failures: [], email_id: "em-456" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const okRes = await sendViaSmtp2go(
      {
        to: ["a@test.com", "b@test.com"],
        subject: "Test",
        textBody: "Hello",
        htmlBody: "<p>Hello</p>",
      },
      mockFetchOk as unknown as typeof fetch,
    );
    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.requestId).toBe("req-123");
      expect(okRes.emailId).toBe("em-456");
    }
    expect(mockFetchOk).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetchOk.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SMTP2GO_SEND_URL);
    expect((init.headers as Record<string, string>)["X-Smtp2go-Api-Key"]).toBe("api-SECRETKEY1234567890ABCDEF123456");

    // Partial/recipient failure inside HTTP 200
    const mockFetchPartialFail = vi.fn(async () =>
      new Response(
        JSON.stringify({
          request_id: "req-fail",
          data: { succeeded: 0, failed: 1, failures: ["invalid sender domain"] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const failRes = await sendViaSmtp2go(
      { to: ["a@test.com"], subject: "Test", textBody: "Hi", htmlBody: "<p>Hi</p>" },
      mockFetchPartialFail as unknown as typeof fetch,
    );
    expect(failRes.ok).toBe(false);
    if (!failRes.ok) expect(failRes.retryable).toBe(false);

    // 503 transient outage -> retryable
    const mockFetch503 = vi.fn(async () => new Response(JSON.stringify({ data: { error: "Service Unavailable" } }), { status: 503 }));
    const retryRes = await sendViaSmtp2go(
      { to: ["a@test.com"], subject: "Test", textBody: "Hi", htmlBody: "<p>Hi</p>" },
      mockFetch503 as unknown as typeof fetch,
    );
    expect(retryRes.ok).toBe(false);
    if (!retryRes.ok) expect(retryRes.retryable).toBe(true);

    // Request timeout -> NOT auto-retryable to avoid potential duplicate emails
    const mockFetchTimeout = vi.fn(async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    });
    const timeoutRes = await sendViaSmtp2go(
      { to: ["a@test.com"], subject: "Test", textBody: "Hi", htmlBody: "<p>Hi</p>" },
      mockFetchTimeout as unknown as typeof fetch,
    );
    expect(timeoutRes.ok).toBe(false);
    if (!timeoutRes.ok) {
      expect(timeoutRes.retryable).toBe(false);
      expect(timeoutRes.error.toLowerCase()).toContain("timed out");
    }
  });
});

describe("Automated reminder processor: idempotency, retries, missed/expired handling, and cron auth", () => {
  it("validates CRON_SECRET strictly, fails closed when missing or < 8 chars, and flags short secrets as weak", () => {
    setEnv("CRON_SECRET", undefined);
    expect(verifyCronAuth(new Request("http://localhost/api/cron/process-reminders"))).toBe(false);

    // Too short (< 8 chars) -> fails closed
    setEnv("CRON_SECRET", "short");
    expect(
      verifyCronAuth(
        new Request("http://localhost/api/cron/process-reminders", {
          headers: { Authorization: "Bearer short" },
        }),
      ),
    ).toBe(false);
    expect(getSmtp2goPublicStatus().cronSecretTooShort).toBe(true);

    // 8-15 chars -> accepted if exact match, but flagged as weak in diagnostics
    setEnv("CRON_SECRET", "test_11char");
    expect(
      verifyCronAuth(
        new Request("http://localhost/api/cron/process-reminders", {
          headers: { Authorization: "Bearer test_11char" },
        }),
      ),
    ).toBe(true);
    expect(getSmtp2goPublicStatus().cronSecretWeak).toBe(true);

    // Strong 32+ char secret -> accepted & not weak
    setEnv("CRON_SECRET", "super-secret-cron-token-32-chars-long");
    expect(
      verifyCronAuth(
        new Request("http://localhost/api/cron/process-reminders", {
          headers: { Authorization: "Bearer wrong-token" },
        }),
      ),
    ).toBe(false);
    expect(
      verifyCronAuth(
        new Request("http://localhost/api/cron/process-reminders", {
          headers: { Authorization: "Bearer super-secret-cron-token-32-chars-long" },
        }),
      ),
    ).toBe(true);
    expect(getSmtp2goPublicStatus().cronSecretWeak).toBe(false);
  });

  it("processes multiple due reminders at the same due time without duplicates across manual and cron runs", async () => {
    const store = loadFileStore();
    const nowIso = "2027-01-10T16:00:00.000Z";
    store.sessions.push({
      id: "sess_aor",
      vendor: "AOR",
      name: "AOR - January 10, 2027",
      status: "Reviewed",
      notes: "",
      createdBy: "admin@genesis.ca",
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    store.items.push({
      ...store.items[0],
      id: "item_2",
      sessionId: "sess_aor",
      vendor: "AOR",
    });
    saveFileStore(store);

    await saveCalendarNotificationSettings(null, {
      recipients: ["team@genesis.ca"],
      timezone: DEFAULT_TIMEZONE,
    });

    // Schedule two worksheets with the EXACT same custom reminder timestamp
    const schedNow = new Date("2027-01-10T18:00:00.000Z");
    await scheduleOrRescheduleSession(
      null,
      "sess_flora",
      "admin@genesis.ca",
      {
        effectiveDate: "2027-01-25",
        reminderEnabled: true,
        reminderType: "CUSTOM",
        customDateKey: "2027-01-20",
        customTimeHHMM: "15:40",
      },
      schedNow,
    );
    await scheduleOrRescheduleSession(
      null,
      "sess_aor",
      "admin@genesis.ca",
      {
        effectiveDate: "2027-01-25",
        reminderEnabled: true,
        reminderType: "CUSTOM",
        customDateKey: "2027-01-20",
        customTimeHHMM: "15:40",
      },
      schedNow,
    );

    setEnv("REMINDER_EMAILS_ENABLED", "true");
    const mockSender = vi.fn(async () => ({
      ok: true as const,
      requestId: "req-multi",
      emailId: "em-multi",
      succeeded: 1,
    }));

    // Automatic cron run at 15:41 PST (23:41 UTC) processes BOTH due reminders
    const cronRun = await processDueReminders({
      prisma: null,
      now: new Date("2027-01-20T23:41:00.000Z"),
      sender: mockSender,
      source: "cron",
      triggeredBy: "supabase-cron",
    });
    expect(cronRun.claimed).toBe(2);
    expect(cronRun.sent).toBe(2);
    expect(mockSender).toHaveBeenCalledTimes(2);

    // Subsequent manual check finds 0 due and sends 0 duplicates
    const manualRun = await processDueReminders({
      prisma: null,
      now: new Date("2027-01-20T23:42:00.000Z"),
      sender: mockSender,
      source: "manual",
      triggeredBy: "admin@genesis.ca",
    });
    expect(manualRun.claimed).toBe(0);
    expect(manualRun.sent).toBe(0);
    expect(mockSender).toHaveBeenCalledTimes(2);
  });

  it("skips sending when REMINDER_EMAILS_ENABLED is false, and prevents duplicate emails across repeated cron runs", async () => {
    await saveCalendarNotificationSettings(null, {
      recipients: ["team@genesis.ca"],
      timezone: DEFAULT_TIMEZONE,
      defaultReminderHour: 8,
      defaultReminderMinute: 0,
      defaultSendReminder: false,
    });
    const sched = await scheduleOrRescheduleSession(
      null,
      "sess_flora",
      "admin@genesis.ca",
      { effectiveDate: "2027-01-25", reminderEnabled: true, reminderType: "ONE_DAY_BEFORE" },
      new Date("2027-01-10T18:00:00.000Z"),
    );
    expect(sched.ok).toBe(true);

    const mockSender = vi.fn(async () => ({
      ok: true as const,
      requestId: "req-1",
      emailId: "em-1",
      succeeded: 1,
    }));

    // Disabled by default -> skips safely
    setEnv("REMINDER_EMAILS_ENABLED", "false");
    const skipped = await processDueReminders({
      prisma: null,
      now: new Date("2027-01-24T16:05:00.000Z"),
      sender: mockSender,
    });
    expect(skipped.skippedBecauseDisabled).toBe(true);
    expect(mockSender).not.toHaveBeenCalled();

    // Enabled -> sends once on due time (Jan 24 08:05 PST = 16:05 UTC)
    setEnv("REMINDER_EMAILS_ENABLED", "true");
    const run1 = await processDueReminders({
      prisma: null,
      now: new Date("2027-01-24T16:05:00.000Z"),
      sender: mockSender,
    });
    expect(run1.claimed).toBe(1);
    expect(run1.sent).toBe(1);
    expect(mockSender).toHaveBeenCalledTimes(1);

    // Duplicate cron execution immediately afterwards -> NEVER sends again!
    const run2 = await processDueReminders({
      prisma: null,
      now: new Date("2027-01-24T16:10:00.000Z"),
      sender: mockSender,
    });
    expect(run2.claimed).toBe(0);
    expect(run2.sent).toBe(0);
    expect(mockSender).toHaveBeenCalledTimes(1);

    // Rescheduling after SENT does NOT reset or re-send the SENT reminder
    const resched = await scheduleOrRescheduleSession(
      null,
      "sess_flora",
      "admin@genesis.ca",
      { effectiveDate: "2027-02-01", reminderEnabled: true, preserveExistingReminder: true },
      new Date("2027-01-24T17:00:00.000Z"),
    );
    expect(resched.ok).toBe(true);
    const run3 = await processDueReminders({
      prisma: null,
      now: new Date("2027-01-31T16:05:00.000Z"),
      sender: mockSender,
    });
    expect(run3.sent).toBe(0);
    expect(mockSender).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures after backoff and expires very late missed reminders", async () => {
    await saveCalendarNotificationSettings(null, {
      recipients: ["team@genesis.ca"],
      timezone: DEFAULT_TIMEZONE,
      defaultReminderHour: 8,
      defaultReminderMinute: 0,
      defaultSendReminder: false,
    });
    await scheduleOrRescheduleSession(
      null,
      "sess_flora",
      "admin@genesis.ca",
      { effectiveDate: "2027-01-25", reminderEnabled: true, reminderType: "ONE_DAY_BEFORE" },
      new Date("2027-01-10T18:00:00.000Z"),
    );
    setEnv("REMINDER_EMAILS_ENABLED", "true");

    // 1st attempt fails transiently (503) at 16:00 UTC
    const failOnce = vi.fn(async () => ({
      ok: false as const,
      error: "SMTP2GO HTTP 503",
      retryable: true,
    }));
    const r1 = await processDueReminders({
      prisma: null,
      now: new Date("2027-01-24T16:00:00.000Z"),
      sender: failOnce,
    });
    expect(r1.failed).toBe(1);
    expect(r1.retriedScheduled).toBe(1);

    // 5 minutes later (before 15m backoff) -> not retried yet
    const rTooSoon = await processDueReminders({
      prisma: null,
      now: new Date("2027-01-24T16:05:00.000Z"),
      sender: failOnce,
    });
    expect(rTooSoon.claimed).toBe(0);

    // 20 minutes later -> retried and succeeds!
    const succeed = vi.fn(async () => ({
      ok: true as const,
      requestId: "req-retry-ok",
      emailId: "em-retry-ok",
      succeeded: 1,
    }));
    const rRetry = await processDueReminders({
      prisma: null,
      now: new Date("2027-01-24T16:20:00.000Z"),
      sender: succeed,
    });
    expect(rRetry.sent).toBe(1);
    expect(loadFileStore().reminders?.[0].attemptCount).toBe(2);
    expect(loadFileStore().reminders?.[0].status).toBe("SENT");

    // Now test very late missed reminder expiry (> 3 days past effective date)
    seedScheduledStore();
    await saveCalendarNotificationSettings(null, {
      recipients: ["team@genesis.ca"],
      timezone: DEFAULT_TIMEZONE,
      defaultReminderHour: 8,
      defaultReminderMinute: 0,
      defaultSendReminder: false,
    });
    await scheduleOrRescheduleSession(
      null,
      "sess_flora",
      "admin@genesis.ca",
      { effectiveDate: "2027-01-25", reminderEnabled: true, reminderType: "ONE_DAY_BEFORE" },
      new Date("2027-01-10T18:00:00.000Z"),
    );
    const rExpired = await processDueReminders({
      prisma: null,
      now: new Date("2027-01-30T16:00:00.000Z"), // 5 days past effective date
      sender: succeed,
    });
    expect(rExpired.expired).toBe(1);
    expect(rExpired.sent).toBe(0);
    expect(loadFileStore().reminders?.[0].status).toBe("EXPIRED");
  });

  it("tracks diagnostics counts, execution history, and next cron run timestamps", async () => {
    expect(computeNextCronRun("* * * * *", new Date("2027-01-10T18:00:20.000Z"))).toBe("2027-01-10T18:01:00.000Z");
    expect(computeNextCronRun("*/15 * * * *", new Date("2027-01-10T18:04:00.000Z"))).toBe("2027-01-10T18:15:00.000Z");
    expect(computeNextCronRun("0 * * * *", new Date("2027-01-10T18:04:00.000Z"))).toBe("2027-01-10T19:00:00.000Z");
    expect(computeNextCronRun("0 16 * * *", new Date("2027-01-10T18:04:00.000Z"))).toBe("2027-01-11T16:00:00.000Z");

    await saveCalendarNotificationSettings(null, {
      recipients: ["team@genesis.ca"],
      timezone: DEFAULT_TIMEZONE,
    });
    await scheduleOrRescheduleSession(
      null,
      "sess_flora",
      "admin@genesis.ca",
      { effectiveDate: "2027-01-25", reminderEnabled: true, reminderType: "ONE_DAY_BEFORE" },
      new Date("2027-01-10T18:00:00.000Z"),
    );

    const beforeDiag = await getReminderDiagnostics(null, new Date("2027-01-24T16:05:00.000Z"));
    expect(beforeDiag.counts.pending).toBe(1);
    expect(beforeDiag.counts.due).toBe(1);
    expect(beforeDiag.counts.sent).toBe(0);

    setEnv("REMINDER_EMAILS_ENABLED", "true");
    const mockOk = vi.fn(async () => ({
      ok: true as const,
      requestId: "req-diag",
      emailId: "em-diag",
      succeeded: 1,
    }));
    await processDueReminders({
      prisma: null,
      now: new Date("2027-01-24T16:05:00.000Z"),
      sender: mockOk,
      source: "manual",
      triggeredBy: "admin@genesis.ca",
    });

    const afterDiag = await getReminderDiagnostics(null, new Date("2027-01-24T16:06:00.000Z"));
    expect(afterDiag.counts.pending).toBe(0);
    expect(afterDiag.counts.due).toBe(0);
    expect(afterDiag.counts.sent).toBe(1);
    expect(afterDiag.lastExecution?.source).toBe("manual");
    expect(afterDiag.lastExecution?.sent).toBe(1);
    expect(afterDiag.lastSuccessfulExecution?.sent).toBe(1);
    expect(afterDiag.history.length).toBeGreaterThanOrEqual(1);
  });
});
