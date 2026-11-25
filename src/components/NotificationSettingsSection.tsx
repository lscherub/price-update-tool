"use client";

import React, { useCallback, useEffect, useState } from "react";
import { LoadingButton } from "@/components/LoadingButton";
import { useToast } from "@/components/Toast";
import { apiErrorText } from "@/lib/apiError";
import {
  DEFAULT_REMINDER_HOUR,
  DEFAULT_REMINDER_MINUTE,
  DEFAULT_TIMEZONE,
  SUPPORTED_TIMEZONES,
  isValidEmail,
  utcToLocalParts,
} from "@/lib/calendar";
import type { Smtp2goPublicStatus } from "@/lib/smtp2go";
import type { ReminderDiagnostics } from "@/lib/reminderProcessor";

type SavedDefaultsSnapshot = {
  timezone: string;
  defaultTime: string;
  defaultSendReminder: boolean;
};

export function NotificationSettingsSection() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [savingRecipients, setSavingRecipients] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const [recipients, setRecipients] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [defaultTime, setDefaultTime] = useState(
    `${String(DEFAULT_REMINDER_HOUR).padStart(2, "0")}:${String(DEFAULT_REMINDER_MINUTE).padStart(2, "0")}`,
  );
  const [defaultSendReminder, setDefaultSendReminder] = useState(false);
  const [savedDefaults, setSavedDefaults] = useState<SavedDefaultsSnapshot>({
    timezone: DEFAULT_TIMEZONE,
    defaultTime: `${String(DEFAULT_REMINDER_HOUR).padStart(2, "0")}:${String(DEFAULT_REMINDER_MINUTE).padStart(2, "0")}`,
    defaultSendReminder: false,
  });
  const [emailConfig, setEmailConfig] = useState<Smtp2goPublicStatus | null>(null);

  // Test email state
  const [testEmailTo, setTestEmailTo] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Diagnostics state
  const [diagnostics, setDiagnostics] = useState<ReminderDiagnostics | null>(null);
  const [diagLoading, setDiagLoading] = useState(true);
  const [diagError, setDiagError] = useState("");
  const [runningCheck, setRunningCheck] = useState(false);
  const [manualRunBanner, setManualRunBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const loadDiagnostics = useCallback(async () => {
    setDiagLoading(true);
    try {
      const r = await fetch("/api/settings/notifications/diagnostics", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setDiagError(apiErrorText(d, "Could not load reminder diagnostics."));
        return;
      }
      setDiagError("");
      setDiagnostics((d.diagnostics as ReminderDiagnostics) ?? null);
    } catch {
      setDiagError("Could not reach the server to load reminder diagnostics.");
    } finally {
      setDiagLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/settings/notifications", { cache: "no-store" }).then(async (r) => ({
        ok: r.ok,
        data: await r.json().catch(() => ({})),
      })),
      fetch("/api/settings/notifications/diagnostics", { cache: "no-store" }).then(async (r) => ({
        ok: r.ok,
        data: await r.json().catch(() => ({})),
      })),
    ])
      .then(([notifRes, diagRes]) => {
        if (!active) return;
        if (!notifRes.ok) {
          setError(apiErrorText(notifRes.data, "Could not load notification settings."));
        } else {
          setError("");
          setCanEdit(Boolean(notifRes.data.canEdit));
          setEmailConfig(notifRes.data.emailConfig ?? null);
          if (notifRes.data.settings) {
            const s = notifRes.data.settings;
            const tz = s.timezone || DEFAULT_TIMEZONE;
            const h = Number(s.defaultReminderHour ?? DEFAULT_REMINDER_HOUR);
            const m = Number(s.defaultReminderMinute ?? DEFAULT_REMINDER_MINUTE);
            const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
            const defSend = Boolean(s.defaultSendReminder);

            setRecipients(Array.isArray(s.recipients) ? s.recipients : []);
            setTimezone(tz);
            setDefaultTime(timeStr);
            setDefaultSendReminder(defSend);
            setSavedDefaults({ timezone: tz, defaultTime: timeStr, defaultSendReminder: defSend });
            setLastSavedAt(s.updatedAt ?? null);
          }
        }

        if (!diagRes.ok) {
          setDiagError(apiErrorText(diagRes.data, "Could not load reminder diagnostics."));
        } else {
          setDiagError("");
          setDiagnostics((diagRes.data.diagnostics as ReminderDiagnostics) ?? null);
        }
      })
      .catch(() => {
        if (active) setError("Could not reach the server to load notification settings.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setDiagLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  /**
   * Persist settings to PostgreSQL via PUT /api/settings/notifications and
   * confirm success ONLY after the server acknowledges the database write.
   */
  const persistToDatabase = async (
    payload: {
      recipients: string[];
      timezone: string;
      defaultTime: string;
      defaultSendReminder: boolean;
    },
    successTitle: string,
    mode: "recipients" | "defaults",
  ): Promise<boolean> => {
    if (!canEdit) return false;
    setError("");
    const [hStr, mStr] = payload.defaultTime.split(":");
    const defaultReminderHour = Number(hStr);
    const defaultReminderMinute = Number(mStr);

    if (mode === "recipients") setSavingRecipients(true);
    else setSavingDefaults(true);

    try {
      const r = await fetch("/api/settings/notifications", {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: payload.recipients,
          timezone: payload.timezone,
          defaultReminderHour,
          defaultReminderMinute,
          defaultSendReminder: payload.defaultSendReminder,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(apiErrorText(d, "Could not save notification settings to the database."));
        return false;
      }
      if (d.settings) {
        const s = d.settings;
        const tz = s.timezone || DEFAULT_TIMEZONE;
        const h = Number(s.defaultReminderHour ?? DEFAULT_REMINDER_HOUR);
        const m = Number(s.defaultReminderMinute ?? DEFAULT_REMINDER_MINUTE);
        const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        const defSend = Boolean(s.defaultSendReminder);

        setRecipients(Array.isArray(s.recipients) ? s.recipients : []);
        setTimezone(tz);
        setDefaultTime(timeStr);
        setDefaultSendReminder(defSend);
        setSavedDefaults({ timezone: tz, defaultTime: timeStr, defaultSendReminder: defSend });
        setLastSavedAt(s.updatedAt ?? new Date().toISOString());
      }
      if (d.emailConfig) setEmailConfig(d.emailConfig);
      toast.success(successTitle);
      return true;
    } catch {
      setError("Could not reach the server while saving. Your changes were not saved.");
      return false;
    } finally {
      if (mode === "recipients") setSavingRecipients(false);
      else setSavingDefaults(false);
    }
  };

  const handleAddEmail = async () => {
    if (!canEdit || savingRecipients) return;
    const cleaned = newEmail.trim().toLowerCase();
    if (!cleaned) return;
    if (!isValidEmail(cleaned)) {
      setError(`"${newEmail.trim()}" is not a valid email address.`);
      return;
    }
    if (recipients.includes(cleaned)) {
      setError(`"${cleaned}" is already in the default recipient list.`);
      return;
    }
    const nextRecipients = [...recipients, cleaned];
    const ok = await persistToDatabase(
      { recipients: nextRecipients, timezone, defaultTime, defaultSendReminder },
      `Added "${cleaned}" and saved to database.`,
      "recipients",
    );
    if (ok) {
      setNewEmail("");
    }
  };

  const handleSaveEdit = async (index: number) => {
    if (!canEdit || savingRecipients) return;
    const cleaned = editingValue.trim().toLowerCase();
    if (!isValidEmail(cleaned)) {
      setError(`"${editingValue.trim()}" is not a valid email address.`);
      return;
    }
    if (recipients.some((em, idx) => idx !== index && em === cleaned)) {
      setError(`"${cleaned}" is already in the default recipient list.`);
      return;
    }
    const nextRecipients = recipients.map((em, idx) => (idx === index ? cleaned : em));
    const ok = await persistToDatabase(
      { recipients: nextRecipients, timezone, defaultTime, defaultSendReminder },
      `Updated recipient to "${cleaned}" and saved to database.`,
      "recipients",
    );
    if (ok) {
      setEditingIndex(null);
      setEditingValue("");
    }
  };

  const handleRemoveEmail = async (index: number) => {
    if (!canEdit || savingRecipients) return;
    const removed = recipients[index];
    const nextRecipients = recipients.filter((_, idx) => idx !== index);
    const ok = await persistToDatabase(
      { recipients: nextRecipients, timezone, defaultTime, defaultSendReminder },
      `Removed "${removed}" and saved to database.`,
      "recipients",
    );
    if (ok && editingIndex === index) {
      setEditingIndex(null);
      setEditingValue("");
    }
  };

  const handleSaveDefaults = async () => {
    if (!canEdit || savingDefaults) return;
    await persistToDatabase(
      { recipients, timezone, defaultTime, defaultSendReminder },
      "Timezone and reminder defaults saved to database.",
      "defaults",
    );
  };

  const defaultsDirty =
    timezone !== savedDefaults.timezone ||
    defaultTime !== savedDefaults.defaultTime ||
    defaultSendReminder !== savedDefaults.defaultSendReminder;

  const handleSendTest = async () => {
    if (!canEdit || sendingTest) return;
    const to = testEmailTo.trim().toLowerCase();
    if (!isValidEmail(to)) {
      setTestResult({ ok: false, text: "Enter a valid test email address first." });
      return;
    }
    setSendingTest(true);
    setTestResult(null);
    try {
      const r = await fetch("/api/settings/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTestResult({ ok: false, text: apiErrorText(d, "Test email failed.") });
        return;
      }
      setTestResult({
        ok: true,
        text: `${d.message || "Test email accepted by SMTP2GO."}${d.emailId ? ` (Email ID: ${d.emailId})` : ""}`,
      });
      toast.success("Test email accepted by SMTP2GO.");
    } catch {
      setTestResult({ ok: false, text: "Could not reach the server to send a test email." });
    } finally {
      setSendingTest(false);
    }
  };

  const handleRunCheckNow = async () => {
    if (!canEdit || runningCheck) return;
    setRunningCheck(true);
    setManualRunBanner(null);
    try {
      const r = await fetch("/api/settings/notifications/run-reminders", {
        method: "POST",
        cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setManualRunBanner({ ok: false, text: apiErrorText(d, "Could not run reminder check.") });
        return;
      }
      if (d.diagnostics) setDiagnostics(d.diagnostics as ReminderDiagnostics);
      const res = d.result;
      if (res?.skippedBecauseDisabled) {
        setManualRunBanner({
          ok: false,
          text: "Skipped: REMINDER_EMAILS_ENABLED is not set to \"true\" in Vercel environment variables. Set it to \"true\" and redeploy to send scheduled reminders.",
        });
      } else {
        setManualRunBanner({
          ok: (res?.failed ?? 0) === 0,
          text: `Check completed: found ${res?.claimed ?? 0} due · ${res?.sent ?? 0} sent · ${res?.failed ?? 0} failed · ${res?.expired ?? 0} expired · ${res?.cancelled ?? 0} cancelled.`,
        });
      }
    } catch {
      setManualRunBanner({ ok: false, text: "Could not reach the server to run reminder check." });
    } finally {
      setRunningCheck(false);
    }
  };

  const formatLocalTs = (iso: string | null | undefined): string => {
    if (!iso) return "Never";
    try {
      return utcToLocalParts(iso, timezone).formatted;
    } catch {
      return new Date(iso).toLocaleString();
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-xs text-slate-500 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        Loading Price Update Calendar &amp; Notifications settings...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {!canEdit && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <strong>Read-only access:</strong> Only users with the <strong>Admin</strong> role can modify default reminder recipients and notification settings.
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Default Reminder Recipients (auto-persisted to DB on every add/edit/remove) */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Price Update Calendar &amp; Notifications — Default Email Recipients
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              Application-wide default recipients shared across all authorized staff scheduling price updates. Adding, editing, or removing an address saves immediately to the database without overwriting per-worksheet custom recipients.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {lastSavedAt && (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                Saved · {formatLocalTs(lastSavedAt)}
              </span>
            )}
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700 dark:bg-zinc-800 dark:text-zinc-300">
              {recipients.length} recipient{recipients.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {canEdit && (
          <div className="mt-4 flex flex-wrap gap-2">
            <input
              type="email"
              value={newEmail}
              disabled={savingRecipients}
              onChange={(e) => {
                setNewEmail(e.target.value);
                if (error) setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleAddEmail();
                }
              }}
              placeholder="Enter email address (e.g. pricing@genesisnutrition.ca)"
              className="h-9 min-w-64 flex-1 rounded-lg border border-slate-200 bg-slate-50/50 px-3 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
            <LoadingButton
              busy={savingRecipients}
              busyLabel="Saving..."
              onClick={() => void handleAddEmail()}
              className="h-9 rounded-lg bg-slate-900 px-4 text-xs font-bold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-zinc-200"
            >
              + Add &amp; Save Recipient
            </LoadingButton>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {recipients.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center text-xs text-slate-500 dark:border-zinc-800 dark:bg-zinc-800/30 dark:text-zinc-400">
              No default reminder recipients configured yet. Add an email address above to save it to the database.
            </div>
          ) : (
            recipients.map((em, idx) => (
              <div
                key={`${em}-${idx}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/40 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-800/40"
              >
                {editingIndex === idx ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      type="email"
                      value={editingValue}
                      disabled={savingRecipients}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleSaveEdit(idx);
                        } else if (e.key === "Escape") {
                          setEditingIndex(null);
                          setEditingValue("");
                        }
                      }}
                      className="h-7 flex-1 rounded border border-indigo-400 bg-white px-2 text-xs text-slate-900 dark:bg-zinc-900 dark:text-white"
                    />
                    <LoadingButton
                      busy={savingRecipients}
                      busyLabel="Saving..."
                      onClick={() => void handleSaveEdit(idx)}
                      className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
                    >
                      Save
                    </LoadingButton>
                    <button
                      type="button"
                      disabled={savingRecipients}
                      onClick={() => {
                        setEditingIndex(null);
                        setEditingValue("");
                      }}
                      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 dark:border-zinc-700 dark:text-zinc-300"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="font-medium text-slate-800 dark:text-zinc-200">{em}</span>
                    {canEdit && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={savingRecipients}
                          onClick={() => {
                            setEditingIndex(idx);
                            setEditingValue(em);
                          }}
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={savingRecipients}
                          onClick={() => void handleRemoveEmail(idx)}
                          className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Timezone & Default Reminder Timing */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Timezone &amp; Reminder Defaults</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              All scheduled effective dates and relative reminders (&ldquo;1 day before&rdquo; / &ldquo;2 days before&rdquo;) are calculated using this timezone with automatic daylight saving time handling.
            </p>
          </div>
          {defaultsDirty && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
              Unsaved changes
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="calendar-timezone" className="text-xs font-bold text-slate-700 dark:text-zinc-200">
              Application Timezone
            </label>
            <select
              id="calendar-timezone"
              disabled={!canEdit}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            >
              {SUPPORTED_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="calendar-default-time" className="text-xs font-bold text-slate-700 dark:text-zinc-200">
              Default Send Time (Relative Reminders)
            </label>
            <input
              id="calendar-default-time"
              type="time"
              disabled={!canEdit}
              value={defaultTime}
              onChange={(e) => setDefaultTime(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={defaultSendReminder}
            onChange={(e) => setDefaultSendReminder(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
          />
          <div className="text-xs">
            <div className="font-semibold text-slate-900 dark:text-white">
              Pre-check &ldquo;Send email reminder&rdquo; when opening the Schedule modal
            </div>
            <div className="text-[11px] text-slate-500 dark:text-zinc-400">
              Off by default so reminders are only enabled intentionally.
            </div>
          </div>
        </label>

        {canEdit && (
          <div className="mt-4 flex justify-end">
            <LoadingButton
              busy={savingDefaults}
              busyLabel="Saving..."
              onClick={() => void handleSaveDefaults()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700"
            >
              Save Timezone &amp; Defaults
            </LoadingButton>
          </div>
        )}
      </div>

      {/* Reminder Scheduler Diagnostics & Manual Processing */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Automated Reminder Scheduler Diagnostics
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              Live status of Supabase Cron (<code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-zinc-800">pg_cron</code> + <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-zinc-800">pg_net</code>), due reminder counts, and recent processing runs.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={diagLoading}
              onClick={() => void loadDiagnostics()}
              className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            >
              {diagLoading ? "Refreshing..." : "Refresh"}
            </button>
            {canEdit && (
              <LoadingButton
                busy={runningCheck}
                busyLabel="Checking..."
                onClick={() => void handleRunCheckNow()}
                className="h-8 rounded-lg bg-indigo-600 px-3.5 text-xs font-bold text-white shadow-xs hover:bg-indigo-700"
              >
                Run Reminder Check Now
              </LoadingButton>
            )}
          </div>
        </div>

        {diagError && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            {diagError}
          </div>
        )}

        {manualRunBanner && (
          <div
            className={`mt-3 rounded-lg border p-3 text-xs font-medium ${
              manualRunBanner.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
                : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
            }`}
          >
            {manualRunBanner.text}
          </div>
        )}

        {diagnostics && (
          <div className="mt-4 flex flex-col gap-4">
            {/* Scheduler & Timing Summary */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-zinc-800">
                <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-zinc-400">Scheduler Status</div>
                <div
                  className={`mt-1 font-bold ${
                    diagnostics.scheduler.operationalState === "operational"
                      ? "text-emerald-700 dark:text-emerald-400"
                      : diagnostics.scheduler.operationalState === "failing"
                      ? "text-red-600 dark:text-red-400"
                      : "text-amber-700 dark:text-amber-400"
                  }`}
                >
                  {diagnostics.scheduler.operationalState === "operational"
                    ? "Operational (Supabase Cron)"
                    : diagnostics.scheduler.operationalState === "failing"
                    ? `Failing${diagnostics.scheduler.lastHttpStatusCode ? ` (HTTP ${diagnostics.scheduler.lastHttpStatusCode})` : ""}`
                    : diagnostics.scheduler.operationalState === "paused"
                    ? "Scheduled · Paused by ENV"
                    : diagnostics.scheduler.operationalState === "configured_unverified"
                    ? "Configured · Waiting for First 200 OK"
                    : diagnostics.scheduler.pgCronInstalled
                    ? "Extensions Ready · Job Not Scheduled"
                    : "Not Configured"}
                </div>
                {diagnostics.scheduler.scheduleLabel && (
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-zinc-400">
                    {diagnostics.scheduler.scheduleLabel}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-zinc-800">
                <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-zinc-400">Last Automatic Cron Request</div>
                <div className="mt-1 font-semibold text-slate-900 dark:text-white">
                  {formatLocalTs(diagnostics.scheduler.lastHttpRequestAt ?? diagnostics.lastCronExecution?.ranAt)}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-zinc-400">
                  {diagnostics.scheduler.lastHttpStatusCode !== null
                    ? `HTTP ${diagnostics.scheduler.lastHttpStatusCode}${
                        diagnostics.scheduler.lastSuccessfulHttpRequestAt
                          ? ` · Last OK: ${formatLocalTs(diagnostics.scheduler.lastSuccessfulHttpRequestAt)}`
                          : " · No 200 OK yet"
                      }`
                    : "No Cron HTTP request recorded yet"}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-zinc-800">
                <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-zinc-400">Last Successful Processing</div>
                <div className="mt-1 font-semibold text-slate-900 dark:text-white">
                  {formatLocalTs(diagnostics.lastSuccessfulCronExecution?.ranAt ?? diagnostics.lastSuccessfulExecution?.ranAt)}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-zinc-400">
                  {diagnostics.lastSuccessfulCronExecution
                    ? `Automatic cron · ${diagnostics.lastSuccessfulCronExecution.sent} sent`
                    : diagnostics.lastSuccessfulExecution
                    ? `Manual check only · ${diagnostics.lastSuccessfulExecution.sent} sent`
                    : "No successful run yet"}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-zinc-800">
                <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-zinc-400">Next Expected Run</div>
                <div className="mt-1 font-semibold text-slate-900 dark:text-white">
                  {diagnostics.scheduler.nextExpectedRunAt
                    ? formatLocalTs(diagnostics.scheduler.nextExpectedRunAt)
                    : "Not scheduled"}
                </div>
              </div>
            </div>

            {/* Reminder Counters */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/40">
                <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-zinc-400">Pending Reminders</div>
                <div className="mt-1 text-xl font-black text-slate-900 dark:text-white">{diagnostics.counts.pending}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/40">
                <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-zinc-400">Currently Due</div>
                <div className={`mt-1 text-xl font-black ${diagnostics.counts.due > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-white"}`}>
                  {diagnostics.counts.due}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/40">
                <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-zinc-400">Sent (Accepted)</div>
                <div className="mt-1 text-xl font-black text-emerald-700 dark:text-emerald-400">{diagnostics.counts.sent}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/40">
                <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-zinc-400">Failed</div>
                <div className={`mt-1 text-xl font-black ${diagnostics.counts.failed > 0 ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white"}`}>
                  {diagnostics.counts.failed}
                </div>
              </div>
            </div>

            {diagnostics.lastError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
                <strong>Last Processing Notice / Error:</strong> {diagnostics.lastError}
              </div>
            )}

            {/* Execution History Table */}
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                Recent Execution History
              </div>
              {diagnostics.history.length === 0 ? (
                <div className="mt-2 rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-500 dark:border-zinc-800 dark:text-zinc-400">
                  No reminder checks recorded yet. Click &ldquo;Run Reminder Check Now&rdquo; above or configure Supabase Cron to start automated checks.
                </div>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 dark:border-zinc-800">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase text-slate-500 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-400">
                        <th className="px-3 py-2">Ran At</th>
                        <th className="px-3 py-2">Source</th>
                        <th className="px-3 py-2 text-right">Due Found</th>
                        <th className="px-3 py-2 text-right">Attempted</th>
                        <th className="px-3 py-2 text-right">Sent</th>
                        <th className="px-3 py-2 text-right">Failed</th>
                        <th className="px-3 py-2">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                      {diagnostics.history.slice(0, 10).map((run) => (
                        <tr key={run.id}>
                          <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800 dark:text-zinc-200">
                            {formatLocalTs(run.ranAt)}
                          </td>
                          <td className="px-3 py-2 capitalize text-slate-600 dark:text-zinc-300">
                            {run.source}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{run.claimed}</td>
                          <td className="px-3 py-2 text-right font-mono">{run.attempted}</td>
                          <td className="px-3 py-2 text-right font-mono text-emerald-700 dark:text-emerald-400">{run.sent}</td>
                          <td className={`px-3 py-2 text-right font-mono ${run.failed > 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                            {run.failed}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-600 dark:text-zinc-400">
                            {run.skippedBecauseDisabled
                              ? "Paused (REMINDER_EMAILS_ENABLED != true)"
                              : run.error
                              ? run.error
                              : "OK"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* SMTP2GO Server Configuration Status (non-secret) */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">SMTP2GO &amp; Automated Delivery Status</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
          API keys and secrets are configured exclusively in Vercel server environment variables and Supabase Vault — never exposed to the browser.
        </p>

        {emailConfig && (
          <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-zinc-800">
              <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-zinc-400">SMTP2GO API Key</div>
              <div className={`mt-1 font-bold ${emailConfig.apiKeyConfigured ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                {emailConfig.apiKeyConfigured ? "Configured (Server)" : "Missing"}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-zinc-800">
              <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-zinc-400">Verified Sender</div>
              <div className={`mt-1 truncate font-bold ${emailConfig.fromEmailConfigured ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`} title={emailConfig.fromEmail || "Not configured"}>
                {emailConfig.fromEmailConfigured ? emailConfig.fromEmail : "Missing"}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-zinc-800">
              <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-zinc-400">Scheduler Auth Secret</div>
              <div
                className={`mt-1 font-bold ${
                  emailConfig.cronSecretConfigured && !emailConfig.cronSecretTooShort && !emailConfig.cronSecretWeak
                    ? "text-emerald-700 dark:text-emerald-400"
                    : emailConfig.cronSecretTooShort
                    ? "text-red-600 dark:text-red-400"
                    : "text-amber-700 dark:text-amber-400"
                }`}
              >
                {!emailConfig.cronSecretConfigured
                  ? "Missing"
                  : emailConfig.cronSecretTooShort
                  ? "Invalid (< 8 chars)"
                  : emailConfig.cronSecretWeak
                  ? "Configured (Short — rotate to 32+ chars)"
                  : "Configured"}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-zinc-800">
              <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-zinc-400">Automated Sending</div>
              <div className={`mt-1 font-bold ${emailConfig.automatedSendingEnabled ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                {emailConfig.automatedSendingEnabled ? "Enabled" : "Paused (REMINDER_EMAILS_ENABLED != true)"}
              </div>
            </div>
          </div>
        )}

        <p className="mt-3 text-[11px] text-slate-500 dark:text-zinc-400">
          Reminder: SMTP2GO requires <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-zinc-800">SMTP2GO_FROM_EMAIL</code> to be verified under <strong>Sending → Verified Senders</strong> (SPF/DKIM CNAME records). Set <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-zinc-800">REMINDER_EMAILS_ENABLED=true</code> in Vercel once tested.
        </p>

        {canEdit && (
          <div className="mt-4 border-t border-slate-100 pt-4 dark:border-zinc-800">
            <div className="text-xs font-bold text-slate-800 dark:text-zinc-200">Send a Safe Test Email</div>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-zinc-400">
              Sends one test message only to the address entered below — never to your default production recipient list.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <input
                type="email"
                value={testEmailTo}
                onChange={(e) => setTestEmailTo(e.target.value)}
                placeholder="your-test-address@example.com"
                className="h-9 min-w-64 flex-1 rounded-lg border border-slate-200 bg-slate-50/50 px-3 text-xs text-slate-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              />
              <LoadingButton
                busy={sendingTest}
                busyLabel="Sending..."
                onClick={() => void handleSendTest()}
                className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-800 shadow-2xs hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                Send Test Email
              </LoadingButton>
            </div>
            {testResult && (
              <div
                className={`mt-2.5 rounded-lg border px-3 py-2 text-xs ${
                  testResult.ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
                    : "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
                }`}
              >
                {testResult.text}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
