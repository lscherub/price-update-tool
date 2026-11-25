"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LoadingButton } from "@/components/LoadingButton";
import { useToast } from "@/components/Toast";
import { apiErrorText } from "@/lib/apiError";
import {
  DEFAULT_REMINDER_HOUR,
  DEFAULT_REMINDER_MINUTE,
  DEFAULT_TIMEZONE,
  addDaysToDateKey,
  computeRelativeReminderAt,
  formatDateKeyShort,
  isValidDateKey,
  isValidEmail,
  todayDateKeyInTimezone,
  utcToLocalParts,
  type ReminderType,
} from "@/lib/calendar";
import type { SerializedScheduleSummary } from "@/lib/calendarServer";

type NotificationConfigResponse = {
  settings?: {
    recipients: string[];
    timezone: string;
    defaultReminderHour: number;
    defaultReminderMinute: number;
    defaultSendReminder: boolean;
  };
  emailConfig?: {
    readyToSend: boolean;
    automatedSendingEnabled: boolean;
  };
};

interface ScheduleWorksheetModalProps {
  isOpen: boolean;
  sessionId: string;
  vendor: string;
  worksheetName: string;
  currentStatus: string;
  currentSchedule: SerializedScheduleSummary | null;
  onClose: () => void;
  onSaved: (res: { status: string; schedule: SerializedScheduleSummary; warning?: string | null }) => void;
  onCancelled?: (res: { restoredStatus: string; schedule: SerializedScheduleSummary }) => void;
}

export function ScheduleWorksheetModal({
  isOpen,
  sessionId,
  vendor,
  worksheetName,
  currentStatus,
  currentSchedule,
  onClose,
  onSaved,
  onCancelled,
}: ScheduleWorksheetModalProps) {
  const toast = useToast();
  const isActivelyScheduled =
    currentStatus === "Scheduled" && currentSchedule?.scheduleStatus === "ACTIVE";

  const [loadingConfig, setLoadingConfig] = useState(false);
  const [defaultRecipients, setDefaultRecipients] = useState<string[]>([]);
  const [timeZone, setTimeZone] = useState(DEFAULT_TIMEZONE);
  const [defaultHour, setDefaultHour] = useState(DEFAULT_REMINDER_HOUR);
  const [defaultMinute, setDefaultMinute] = useState(DEFAULT_REMINDER_MINUTE);
  const [emailReady, setEmailReady] = useState<boolean | null>(null);
  const [automatedEnabled, setAutomatedEnabled] = useState<boolean | null>(null);

  // Form state
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderType, setReminderType] = useState<ReminderType>("ONE_DAY_BEFORE");
  const [customDateKey, setCustomDateKey] = useState("");
  const [customTimeHHMM, setCustomTimeHHMM] = useState("08:00");
  const [useCustomRecipients, setUseCustomRecipients] = useState(false);
  const [customRecipients, setCustomRecipients] = useState<string[]>([]);
  const [newRecipientInput, setNewRecipientInput] = useState("");
  const [createNewReminder, setCreateNewReminder] = useState(false);
  const [confirmAfterEffectiveDate, setConfirmAfterEffectiveDate] = useState(false);

  const [error, setError] = useState("");
  const [requiresAfterConfirm, setRequiresAfterConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const existingActiveReminder = currentSchedule?.activeReminder ?? null;
  const existingSentReminder =
    !existingActiveReminder && currentSchedule?.latestReminder?.status === "SENT"
      ? currentSchedule.latestReminder
      : null;

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const ctrl = new AbortController();

    Promise.resolve()
      .then(() => {
        if (!active) return;
        setError("");
        setRequiresAfterConfirm(false);
        setConfirmAfterEffectiveDate(false);
        setShowCancelConfirm(false);
        setNewRecipientInput("");
        setLoadingConfig(true);
      })
      .then(() => fetch("/api/settings/notifications", { signal: ctrl.signal }))
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: NotificationConfigResponse) => {
        if (!active) return;
        const tz = d.settings?.timezone || DEFAULT_TIMEZONE;
        const h = d.settings?.defaultReminderHour ?? DEFAULT_REMINDER_HOUR;
        const m = d.settings?.defaultReminderMinute ?? DEFAULT_REMINDER_MINUTE;
        const recips = Array.isArray(d.settings?.recipients) ? d.settings.recipients : [];
        const defSend = Boolean(d.settings?.defaultSendReminder);

        setTimeZone(tz);
        setDefaultHour(h);
        setDefaultMinute(m);
        setDefaultRecipients(recips);
        setEmailReady(d.emailConfig ? Boolean(d.emailConfig.readyToSend) : null);
        setAutomatedEnabled(d.emailConfig ? Boolean(d.emailConfig.automatedSendingEnabled) : null);

        const today = todayDateKeyInTimezone(tz);
        const initialEff =
          currentSchedule?.scheduledEffectiveDate && currentSchedule.scheduleStatus === "ACTIVE"
            ? currentSchedule.scheduledEffectiveDate
            : addDaysToDateKey(today, 7);
        setEffectiveDate(initialEff);

        if (existingActiveReminder) {
          setReminderEnabled(true);
          const rType =
            existingActiveReminder.reminderType === "TWO_DAYS_BEFORE" ||
            existingActiveReminder.reminderType === "CUSTOM"
              ? existingActiveReminder.reminderType
              : "ONE_DAY_BEFORE";
          setReminderType(rType);
          const local = utcToLocalParts(existingActiveReminder.scheduledReminderAt, tz);
          setCustomDateKey(local.dateKey);
          setCustomTimeHHMM(local.timeHHMM);
          if (existingActiveReminder.customRecipients) {
            setUseCustomRecipients(true);
            setCustomRecipients(existingActiveReminder.customRecipients);
          } else {
            setUseCustomRecipients(false);
            setCustomRecipients([]);
          }
          setCreateNewReminder(false);
        } else if (existingSentReminder) {
          // Do not auto-enable a duplicate reminder when one was already sent
          setReminderEnabled(false);
          setReminderType("ONE_DAY_BEFORE");
          setCustomDateKey(addDaysToDateKey(initialEff, -1));
          setCustomTimeHHMM(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
          setUseCustomRecipients(false);
          setCustomRecipients([]);
          setCreateNewReminder(false);
        } else {
          setReminderEnabled(defSend);
          setReminderType("ONE_DAY_BEFORE");
          setCustomDateKey(addDaysToDateKey(initialEff, -1));
          setCustomTimeHHMM(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
          setUseCustomRecipients(false);
          setCustomRecipients([]);
          setCreateNewReminder(false);
        }
      })
      .catch(() => {
        if (!active) return;
        const today = todayDateKeyInTimezone(DEFAULT_TIMEZONE);
        setEffectiveDate(currentSchedule?.scheduledEffectiveDate || addDaysToDateKey(today, 7));
      })
      .finally(() => {
        if (active) setLoadingConfig(false);
      });

    return () => {
      active = false;
      ctrl.abort();
    };
  }, [isOpen, currentSchedule, existingActiveReminder, existingSentReminder]);

  const todayKey = useMemo(() => todayDateKeyInTimezone(timeZone), [timeZone]);

  const oneDayPreview = useMemo(() => {
    if (!isValidDateKey(effectiveDate)) return "";
    const dt = computeRelativeReminderAt(effectiveDate, "ONE_DAY_BEFORE", timeZone, defaultHour, defaultMinute);
    return utcToLocalParts(dt, timeZone).formatted;
  }, [effectiveDate, timeZone, defaultHour, defaultMinute]);

  const twoDayPreview = useMemo(() => {
    if (!isValidDateKey(effectiveDate)) return "";
    const dt = computeRelativeReminderAt(effectiveDate, "TWO_DAYS_BEFORE", timeZone, defaultHour, defaultMinute);
    return utcToLocalParts(dt, timeZone).formatted;
  }, [effectiveDate, timeZone, defaultHour, defaultMinute]);

  const customIsAfterEffective = useMemo(() => {
    if (!reminderEnabled || reminderType !== "CUSTOM") return false;
    if (!isValidDateKey(effectiveDate) || !isValidDateKey(customDateKey)) return false;
    return customDateKey > effectiveDate;
  }, [reminderEnabled, reminderType, effectiveDate, customDateKey]);

  const activeRecipients = useCustomRecipients ? customRecipients : defaultRecipients;

  const addCustomRecipient = () => {
    const cleaned = newRecipientInput.trim().toLowerCase();
    if (!cleaned) return;
    if (!isValidEmail(cleaned)) {
      setError(`"${newRecipientInput.trim()}" is not a valid email address.`);
      return;
    }
    if (customRecipients.includes(cleaned)) {
      setNewRecipientInput("");
      return;
    }
    setCustomRecipients((prev) => [...prev, cleaned]);
    setNewRecipientInput("");
    setError("");
  };

  const handleSave = async () => {
    if (saving) return;
    setError("");

    if (!isValidDateKey(effectiveDate)) {
      setError("Please select a valid effective date.");
      return;
    }
    if (effectiveDate < todayKey) {
      setError(`Effective date cannot be in the past (today is ${formatDateKeyShort(todayKey)}).`);
      return;
    }
    if (reminderEnabled && activeRecipients.length === 0) {
      setError("No reminder email recipients are configured. Add recipients below or in Settings before enabling reminders.");
      return;
    }
    if (reminderEnabled && customIsAfterEffective && !confirmAfterEffectiveDate) {
      setRequiresAfterConfirm(true);
      setError("Your custom reminder date is after the effective date. Check the confirmation box below to proceed.");
      return;
    }

    setSaving(true);
    try {
      const r = await fetch(`/api/sessions/${sessionId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effectiveDate,
          reminderEnabled,
          reminderType,
          customDateKey: reminderType === "CUSTOM" ? customDateKey : null,
          customTimeHHMM: reminderType === "CUSTOM" ? customTimeHHMM : null,
          useCustomRecipients,
          customRecipients: useCustomRecipients ? customRecipients : undefined,
          confirmAfterEffectiveDate,
          createNewReminder: Boolean(existingSentReminder && reminderEnabled) || createNewReminder,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (d.requiresConfirmation || d.code === "REMINDER_AFTER_EFFECTIVE_DATE") {
          setRequiresAfterConfirm(true);
        }
        setError(apiErrorText(d, "Could not save schedule."));
        return;
      }

      if (d.warning) {
        toast.info("Schedule saved with notice.", String(d.warning));
      } else {
        toast.success(
          isActivelyScheduled ? "Schedule updated." : "Worksheet scheduled.",
          `Effective date set to ${formatDateKeyShort(effectiveDate)}.`,
        );
      }
      onSaved({
        status: String(d.session?.status ?? "Scheduled"),
        schedule: d.session?.schedule,
        warning: d.warning ?? null,
      });
      onClose();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelSchedule = async () => {
    if (cancelling) return;
    setCancelling(true);
    setError("");
    try {
      const r = await fetch(`/api/sessions/${sessionId}/schedule`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(apiErrorText(d, "Could not cancel schedule."));
        return;
      }
      toast.success(
        "Schedule cancelled.",
        `Status restored to ${d.restoredStatus}. Pending reminders were cancelled and all worksheet data is preserved.`,
      );
      onCancelled?.({ restoredStatus: String(d.restoredStatus), schedule: d.schedule });
      onClose();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setCancelling(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-2xs p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isActivelyScheduled ? "Manage Worksheet Schedule" : "Schedule Price Update Worksheet"}
    >
      <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-zinc-800">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {isActivelyScheduled ? "Update Schedule & Reminder" : "Schedule Price Update"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
              <span className="font-semibold text-slate-700 dark:text-zinc-200">{vendor || "Vendor"}</span> — {worksheetName}
            </p>
          </div>
          <button
            type="button"
            disabled={saving || cancelling}
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Info Banner */}
        <div className="mt-4 rounded-xl border border-indigo-200/80 bg-indigo-50/60 px-3.5 py-2.5 text-xs text-indigo-900 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-200">
          Scheduling sets the planned effective date on the Calendar and configures email reminders. It does <strong>not</strong> export POS files or change inventory prices automatically.
        </div>

        {loadingConfig ? (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-zinc-400">
            Loading calendar & notification settings...
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {/* Effective Date */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="schedule-effective-date" className="text-xs font-bold text-slate-700 dark:text-zinc-200">
                Effective Date
              </label>
              <input
                id="schedule-effective-date"
                type="date"
                min={todayKey}
                value={effectiveDate}
                onChange={(e) => {
                  setEffectiveDate(e.target.value);
                  setRequiresAfterConfirm(false);
                  setConfirmAfterEffectiveDate(false);
                  setError("");
                }}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              />
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                Date when {vendor || "vendor"}&apos;s new prices should take effect ({timeZone}).
              </p>
            </div>

            {/* Already-sent reminder notice */}
            {existingSentReminder && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                A reminder email was already sent on{" "}
                <strong>{utcToLocalParts(existingSentReminder.sentAt || existingSentReminder.scheduledReminderAt, timeZone).formatted}</strong>.
                Changing the effective date will not resend that reminder unless you turn on &ldquo;Send email reminder&rdquo; below to schedule a new one.
              </div>
            )}

            {/* Reminder Toggle */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-800/40">
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    {existingSentReminder ? "Schedule a new email reminder" : "Send email reminder"}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-zinc-400">
                    Automatically notify configured recipients via SMTP2GO before the effective date.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={reminderEnabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setReminderEnabled(checked);
                    if (checked && existingSentReminder) setCreateNewReminder(true);
                    setError("");
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
              </label>

              {reminderEnabled && (
                <div className="mt-4 flex flex-col gap-3.5 border-t border-slate-200/80 pt-3.5 dark:border-zinc-700/80">
                  {/* Reminder Timing Options */}
                  <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                      Reminder Timing
                    </span>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-white p-2.5 dark:border-zinc-700 dark:bg-zinc-900">
                      <input
                        type="radio"
                        name="reminder-type"
                        checked={reminderType === "ONE_DAY_BEFORE"}
                        onChange={() => {
                          setReminderType("ONE_DAY_BEFORE");
                          setRequiresAfterConfirm(false);
                          setConfirmAfterEffectiveDate(false);
                          setError("");
                        }}
                        className="mt-0.5 text-indigo-600"
                      />
                      <div className="flex-1 text-xs">
                        <div className="font-semibold text-slate-900 dark:text-white">One day before effective date</div>
                        {oneDayPreview && (
                          <div className="text-[11px] text-slate-500 dark:text-zinc-400">
                            Will send: <span className="font-medium text-slate-700 dark:text-zinc-200">{oneDayPreview}</span> (auto-recalculates if rescheduled)
                          </div>
                        )}
                      </div>
                    </label>

                    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-white p-2.5 dark:border-zinc-700 dark:bg-zinc-900">
                      <input
                        type="radio"
                        name="reminder-type"
                        checked={reminderType === "TWO_DAYS_BEFORE"}
                        onChange={() => {
                          setReminderType("TWO_DAYS_BEFORE");
                          setRequiresAfterConfirm(false);
                          setConfirmAfterEffectiveDate(false);
                          setError("");
                        }}
                        className="mt-0.5 text-indigo-600"
                      />
                      <div className="flex-1 text-xs">
                        <div className="font-semibold text-slate-900 dark:text-white">Two days before effective date</div>
                        {twoDayPreview && (
                          <div className="text-[11px] text-slate-500 dark:text-zinc-400">
                            Will send: <span className="font-medium text-slate-700 dark:text-zinc-200">{twoDayPreview}</span> (auto-recalculates if rescheduled)
                          </div>
                        )}
                      </div>
                    </label>

                    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-white p-2.5 dark:border-zinc-700 dark:bg-zinc-900">
                      <input
                        type="radio"
                        name="reminder-type"
                        checked={reminderType === "CUSTOM"}
                        onChange={() => {
                          setReminderType("CUSTOM");
                          setError("");
                        }}
                        className="mt-0.5 text-indigo-600"
                      />
                      <div className="flex-1 text-xs">
                        <div className="font-semibold text-slate-900 dark:text-white">Custom date and time</div>
                        <div className="text-[11px] text-slate-500 dark:text-zinc-400">
                          Stays fixed when rescheduling unless you explicitly change it.
                        </div>
                        {reminderType === "CUSTOM" && (
                          <div className="mt-2.5 grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] font-semibold uppercase text-slate-500 dark:text-zinc-400">Date</label>
                              <input
                                type="date"
                                min={todayKey}
                                value={customDateKey}
                                onChange={(e) => {
                                  setCustomDateKey(e.target.value);
                                  setConfirmAfterEffectiveDate(false);
                                  setError("");
                                }}
                                className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold uppercase text-slate-500 dark:text-zinc-400">
                                Time ({timeZone.split("/")[1]?.replace("_", " ") || timeZone})
                              </label>
                              <input
                                type="time"
                                value={customTimeHHMM}
                                onChange={(e) => {
                                  setCustomTimeHHMM(e.target.value);
                                  setError("");
                                }}
                                className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </label>
                  </div>

                  {/* Warning if custom reminder is after effective date */}
                  {(customIsAfterEffective || requiresAfterConfirm) && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      <div className="font-bold">Warning: Reminder is scheduled after the effective date</div>
                      <label className="mt-2 flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={confirmAfterEffectiveDate}
                          onChange={(e) => setConfirmAfterEffectiveDate(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-amber-400 text-amber-600"
                        />
                        <span>I intentionally want this reminder sent after {formatDateKeyShort(effectiveDate)}.</span>
                      </label>
                    </div>
                  )}

                  {/* Recipients Section */}
                  <div className="flex flex-col gap-2 border-t border-slate-200/80 pt-3 dark:border-zinc-700/80">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                        Email Recipients
                      </span>
                      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                        <input
                          type="checkbox"
                          checked={useCustomRecipients}
                          onChange={(e) => {
                            const next = e.target.checked;
                            setUseCustomRecipients(next);
                            if (next && customRecipients.length === 0 && defaultRecipients.length > 0) {
                              setCustomRecipients([...defaultRecipients]);
                            }
                            setError("");
                          }}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                        />
                        Customize for this worksheet
                      </label>
                    </div>

                    {!useCustomRecipients ? (
                      defaultRecipients.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {defaultRecipients.map((em) => (
                            <span
                              key={em}
                              className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                            >
                              {em}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                          <strong>No default recipients configured.</strong> Add default emails in{" "}
                          <Link href="/settings" className="font-bold underline" onClick={onClose}>
                            Settings → Price Update Calendar &amp; Notifications
                          </Link>{" "}
                          or enable &ldquo;Customize for this worksheet&rdquo; above.
                        </div>
                      )
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-1.5">
                          <input
                            type="email"
                            value={newRecipientInput}
                            onChange={(e) => setNewRecipientInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                addCustomRecipient();
                              }
                            }}
                            placeholder="name@company.com"
                            className="h-8 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={addCustomRecipient}
                            className="h-8 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
                          >
                            Add
                          </button>
                        </div>
                        {customRecipients.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {customRecipients.map((em) => (
                              <span
                                key={em}
                                className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-medium text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                              >
                                {em}
                                <button
                                  type="button"
                                  onClick={() => setCustomRecipients((prev) => prev.filter((x) => x !== em))}
                                  className="text-indigo-500 hover:text-indigo-900 dark:hover:text-white"
                                  aria-label={`Remove ${em}`}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-amber-700 dark:text-amber-300">
                            Add at least one recipient email for this worksheet.
                          </div>
                        )}
                        <p className="text-[10px] text-slate-500 dark:text-zinc-400">
                          Worksheet-specific recipients are stored independently and won&apos;t be overwritten if global default recipients change later.
                        </p>
                      </div>
                    )}

                    {/* Non-blocking SMTP2GO environment hint */}
                    {emailReady === false && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-300">
                        Note: SMTP2GO server credentials are not yet configured in this environment. Your reminder will still be saved and processed once configured.
                      </p>
                    )}
                    {emailReady === true && automatedEnabled === false && (
                      <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                        Note: Automated background email delivery is currently paused (`REMINDER_EMAILS_ENABLED=false`).
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </div>
            )}

            {/* Cancel schedule confirmation block */}
            {showCancelConfirm && isActivelyScheduled && (
              <div className="rounded-xl border border-red-200 bg-red-50/70 p-3.5 text-xs dark:border-red-900/60 dark:bg-red-950/30">
                <div className="font-bold text-red-900 dark:text-red-200">Cancel this scheduled price update?</div>
                <p className="mt-1 text-red-800/90 dark:text-red-300">
                  This removes the active calendar event, cancels pending email reminders, and restores the worksheet status to{" "}
                  <strong>{currentSchedule?.previousStatus || "Ready"}</strong>. All worksheet rows, pricing calculations, and notes remain completely intact.
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={cancelling}
                    onClick={() => setShowCancelConfirm(false)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  >
                    Keep Schedule
                  </button>
                  <LoadingButton
                    busy={cancelling}
                    busyLabel="Cancelling..."
                    onClick={handleCancelSchedule}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
                  >
                    Confirm Cancel Schedule
                  </LoadingButton>
                </div>
              </div>
            )}

            {/* Footer buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 dark:border-zinc-800">
              <div>
                {isActivelyScheduled && !showCancelConfirm && (
                  <button
                    type="button"
                    disabled={saving || cancelling}
                    onClick={() => setShowCancelConfirm(true)}
                    className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                  >
                    Cancel Schedule
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving || cancelling}
                  onClick={onClose}
                  className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Close
                </button>
                <LoadingButton
                  busy={saving}
                  busyLabel="Saving..."
                  onClick={handleSave}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-60"
                >
                  {isActivelyScheduled ? "Save Changes" : "Save Schedule"}
                </LoadingButton>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
