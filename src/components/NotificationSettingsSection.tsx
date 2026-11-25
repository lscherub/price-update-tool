"use client";

import React, { useEffect, useState } from "react";
import { LoadingButton } from "@/components/LoadingButton";
import { useToast } from "@/components/Toast";
import { apiErrorText } from "@/lib/apiError";
import {
  DEFAULT_REMINDER_HOUR,
  DEFAULT_REMINDER_MINUTE,
  DEFAULT_TIMEZONE,
  SUPPORTED_TIMEZONES,
  isValidEmail,
} from "@/lib/calendar";
import type { Smtp2goPublicStatus } from "@/lib/smtp2go";

export function NotificationSettingsSection() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState("");

  const [recipients, setRecipients] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [defaultTime, setDefaultTime] = useState(
    `${String(DEFAULT_REMINDER_HOUR).padStart(2, "0")}:${String(DEFAULT_REMINDER_MINUTE).padStart(2, "0")}`,
  );
  const [defaultSendReminder, setDefaultSendReminder] = useState(false);
  const [emailConfig, setEmailConfig] = useState<Smtp2goPublicStatus | null>(null);

  // Test email state
  const [testEmailTo, setTestEmailTo] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/settings/notifications")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!active) return;
        if (!r.ok) {
          setError(apiErrorText(d, "Could not load notification settings."));
          return;
        }
        setError("");
        setCanEdit(Boolean(d.canEdit));
        setEmailConfig(d.emailConfig ?? null);
        if (d.settings) {
          setRecipients(Array.isArray(d.settings.recipients) ? d.settings.recipients : []);
          setTimezone(d.settings.timezone || DEFAULT_TIMEZONE);
          const h = Number(d.settings.defaultReminderHour ?? DEFAULT_REMINDER_HOUR);
          const m = Number(d.settings.defaultReminderMinute ?? DEFAULT_REMINDER_MINUTE);
          setDefaultTime(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
          setDefaultSendReminder(Boolean(d.settings.defaultSendReminder));
        }
      })
      .catch(() => {
        if (active) setError("Could not reach the server to load notification settings.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleAddEmail = () => {
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
    setRecipients((prev) => [...prev, cleaned]);
    setNewEmail("");
    setError("");
  };

  const handleSaveEdit = (index: number) => {
    const cleaned = editingValue.trim().toLowerCase();
    if (!isValidEmail(cleaned)) {
      setError(`"${editingValue.trim()}" is not a valid email address.`);
      return;
    }
    if (recipients.some((em, idx) => idx !== index && em === cleaned)) {
      setError(`"${cleaned}" is already in the default recipient list.`);
      return;
    }
    setRecipients((prev) => prev.map((em, idx) => (idx === index ? cleaned : em)));
    setEditingIndex(null);
    setEditingValue("");
    setError("");
  };

  const handleRemoveEmail = (index: number) => {
    setRecipients((prev) => prev.filter((_, idx) => idx !== index));
    if (editingIndex === index) {
      setEditingIndex(null);
      setEditingValue("");
    }
    setError("");
  };

  const handleSaveSettings = async () => {
    if (!canEdit || saving) return;
    setError("");
    const [hStr, mStr] = defaultTime.split(":");
    const defaultReminderHour = Number(hStr);
    const defaultReminderMinute = Number(mStr);

    setSaving(true);
    try {
      const r = await fetch("/api/settings/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients,
          timezone,
          defaultReminderHour,
          defaultReminderMinute,
          defaultSendReminder,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(apiErrorText(d, "Could not save notification settings."));
        return;
      }
      if (d.settings) {
        setRecipients(d.settings.recipients ?? []);
        setTimezone(d.settings.timezone ?? DEFAULT_TIMEZONE);
      }
      toast.success("Calendar & notification settings saved.");
    } catch {
      setError("Could not reach the server while saving.");
    } finally {
      setSaving(false);
    }
  };

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

      {/* Default Reminder Recipients */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Price Update Calendar &amp; Notifications — Default Email Recipients
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              Manage the default email addresses that receive automated price update reminders. Changing this list does not overwrite custom recipients saved on individual worksheets.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700 dark:bg-zinc-800 dark:text-zinc-300">
            {recipients.length} recipient{recipients.length === 1 ? "" : "s"}
          </span>
        </div>

        {canEdit && (
          <div className="mt-4 flex flex-wrap gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                if (error) setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddEmail();
                }
              }}
              placeholder="Enter email address (e.g. pricing@genesisnutrition.ca)"
              className="h-9 min-w-64 flex-1 rounded-lg border border-slate-200 bg-slate-50/50 px-3 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
            <button
              type="button"
              onClick={handleAddEmail}
              className="h-9 rounded-lg bg-slate-900 px-4 text-xs font-bold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-zinc-200"
            >
              + Add Recipient
            </button>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {recipients.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center text-xs text-slate-500 dark:border-zinc-800 dark:bg-zinc-800/30 dark:text-zinc-400">
              No default reminder recipients configured yet. Add at least one email address above before scheduling automated reminders.
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
                      onChange={(e) => setEditingValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleSaveEdit(idx);
                        } else if (e.key === "Escape") {
                          setEditingIndex(null);
                          setEditingValue("");
                        }
                      }}
                      className="h-7 flex-1 rounded border border-indigo-400 bg-white px-2 text-xs text-slate-900 dark:bg-zinc-900 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(idx)}
                      className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
                    >
                      Apply
                    </button>
                    <button
                      type="button"
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
                          onClick={() => {
                            setEditingIndex(idx);
                            setEditingValue(em);
                          }}
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveEmail(idx)}
                          className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
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
        <h2 className="text-base font-bold text-slate-900 dark:text-white">Timezone &amp; Reminder Defaults</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
          All scheduled effective dates and relative reminders (&ldquo;1 day before&rdquo; / &ldquo;2 days before&rdquo;) are calculated using this timezone with automatic daylight saving time handling.
        </p>

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
              busy={saving}
              busyLabel="Saving..."
              onClick={handleSaveSettings}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700"
            >
              Save Calendar &amp; Notification Settings
            </LoadingButton>
          </div>
        )}
      </div>

      {/* SMTP2GO Server Configuration Status (non-secret) */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">SMTP2GO &amp; Automated Delivery Status</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
          API keys and secrets are configured exclusively in Vercel server environment variables and are never exposed to the browser.
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
              <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-zinc-400">Vercel Cron Secret</div>
              <div className={`mt-1 font-bold ${emailConfig.cronSecretConfigured ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                {emailConfig.cronSecretConfigured ? "Configured" : "Missing"}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-zinc-800">
              <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-zinc-400">Automated Cron Sends</div>
              <div className={`mt-1 font-bold ${emailConfig.automatedSendingEnabled ? "text-emerald-700 dark:text-emerald-400" : "text-slate-600 dark:text-zinc-300"}`}>
                {emailConfig.automatedSendingEnabled ? "Enabled" : "Paused (Test Mode)"}
              </div>
            </div>
          </div>
        )}

        <p className="mt-3 text-[11px] text-slate-500 dark:text-zinc-400">
          Reminder: SMTP2GO requires <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-zinc-800">SMTP2GO_FROM_EMAIL</code> to be verified under <strong>Sending → Verified Senders</strong> (SPF/DKIM CNAME records for your domain). Set <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-zinc-800">REMINDER_EMAILS_ENABLED=true</code> in Vercel once your test email succeeds.
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
                onClick={handleSendTest}
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
