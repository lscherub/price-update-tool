"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LoadingButton } from "@/components/LoadingButton";
import { ScheduleWorksheetModal } from "@/components/ScheduleWorksheetModal";
import { useToast } from "@/components/Toast";
import { apiErrorText } from "@/lib/apiError";
import {
  DEFAULT_TIMEZONE,
  addDaysToDateKey,
  dateKeyToUtcMidnight,
  formatDateKeyLong,
  formatDateKeyShort,
  getReminderTypeLabel,
  isValidDateKey,
  todayDateKeyInTimezone,
} from "@/lib/calendar";
import type { CalendarEventItem, SerializedScheduleSummary } from "@/lib/calendarServer";

type ViewMode = "month" | "week" | "list";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getMonthGridDays(anchorDateKey: string): { dateKey: string; inMonth: boolean }[] {
  const [y, m] = anchorDateKey.split("-").map(Number);
  const firstOfMonth = new Date(Date.UTC(y, m - 1, 1));
  const startDow = firstOfMonth.getUTCDay(); // 0 = Sun
  const startKey = addDaysToDateKey(`${y}-${String(m).padStart(2, "0")}-01`, -startDow);
  const cells: { dateKey: string; inMonth: boolean }[] = [];
  const monthPrefix = `${y}-${String(m).padStart(2, "0")}-`;
  for (let i = 0; i < 42; i++) {
    const dk = addDaysToDateKey(startKey, i);
    cells.push({ dateKey: dk, inMonth: dk.startsWith(monthPrefix) });
  }
  return cells;
}

function getWeekDays(anchorDateKey: string): string[] {
  const dt = dateKeyToUtcMidnight(anchorDateKey);
  const dow = dt.getUTCDay();
  const sundayKey = addDaysToDateKey(anchorDateKey, -dow);
  return Array.from({ length: 7 }, (_, i) => addDaysToDateKey(sundayKey, i));
}

function formatMonthHeading(anchorDateKey: string): string {
  const dt = dateKeyToUtcMidnight(anchorDateKey);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(dt);
}

function eventStatusBadge(ev: CalendarEventItem): { label: string; cls: string; cardCls: string } {
  if (ev.scheduleStatus === "CANCELLED") {
    return {
      label: "Cancelled",
      cls: "border-slate-300 bg-slate-100 text-slate-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
      cardCls: "border-slate-300 bg-slate-100/80 text-slate-600 line-through dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400",
    };
  }
  if (ev.status === "Exported" || ev.scheduleStatus === "COMPLETED") {
    return {
      label: "Completed (Exported)",
      cls: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
      cardCls: "border-emerald-200 bg-emerald-50/90 text-emerald-900 hover:bg-emerald-100/80 dark:border-emerald-800/80 dark:bg-emerald-950/50 dark:text-emerald-200",
    };
  }
  return {
    label: ev.status,
    cls: "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300",
    cardCls: "border-indigo-200 bg-indigo-50/90 text-indigo-950 hover:bg-indigo-100 dark:border-indigo-800/80 dark:bg-indigo-950/50 dark:text-indigo-100",
  };
}

function reminderBadge(ev: CalendarEventItem): { label: string; cls: string } {
  const r = ev.activeReminder ?? ev.latestReminder;
  if (!r) {
    return {
      label: "No reminder",
      cls: "border-slate-200 bg-slate-50 text-slate-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
    };
  }
  if (r.status === "SENT") {
    return {
      label: "Reminder Sent",
      cls: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
    };
  }
  if (r.status === "FAILED") {
    return {
      label: "Reminder Failed",
      cls: "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300",
    };
  }
  if (r.status === "SCHEDULED" || r.status === "PROCESSING") {
    return {
      label: "Reminder Active",
      cls: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    };
  }
  if (r.status === "EXPIRED") {
    return {
      label: "Reminder Expired",
      cls: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-300",
    };
  }
  return {
    label: "Reminder Off",
    cls: "border-slate-200 bg-slate-50 text-slate-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
  };
}

function toScheduleSummary(ev: CalendarEventItem): SerializedScheduleSummary {
  return {
    scheduledEffectiveDate: ev.scheduledEffectiveDate,
    scheduledAt: ev.scheduledAt,
    scheduledBy: ev.scheduledBy,
    previousStatus: ev.previousStatus,
    scheduleStatus: ev.scheduleStatus,
    scheduleCancelledAt: ev.scheduleCancelledAt,
    scheduleCancelledBy: ev.scheduleCancelledBy,
    activeReminder: ev.activeReminder,
    latestReminder: ev.latestReminder,
    history: ev.history,
  };
}

export default function CalendarPage() {
  const toast = useToast();
  const [view, setView] = useState<ViewMode>("month");
  const [todayKey, setTodayKey] = useState(() => todayDateKeyInTimezone(DEFAULT_TIMEZONE));
  const [anchorDate, setAnchorDate] = useState(() => todayDateKeyInTimezone(DEFAULT_TIMEZONE));
  const [timeZone, setTimeZone] = useState(DEFAULT_TIMEZONE);

  // Filters
  const [q, setQ] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reminderFilter, setReminderFilter] = useState("all");
  const [timeframeFilter, setTimeframeFilter] = useState("all");

  // Data
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [vendors, setVendors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Interactive modals
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventItem | null>(null);
  const [editingScheduleEvent, setEditingScheduleEvent] = useState<CalendarEventItem | null>(null);
  const [confirmCancelDetail, setConfirmCancelDetail] = useState(false);
  const [cancellingDetail, setCancellingDetail] = useState(false);

  // Drag-and-drop confirmed reschedule state
  const [draggingEventId, setDraggingEventId] = useState<string | null>(null);
  const [dropTargetDate, setDropTargetDate] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ event: CalendarEventItem; targetDate: string } | null>(null);
  const [dropSaving, setDropSaving] = useState(false);
  const [dropError, setDropError] = useState("");
  const [dropNeedsConfirm, setDropNeedsConfirm] = useState(false);

  const loadCalendar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (vendorFilter) params.set("vendor", vendorFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (reminderFilter !== "all") params.set("reminder", reminderFilter);
      if (timeframeFilter !== "all") params.set("timeframe", timeframeFilter);
      if (q.trim()) params.set("q", q.trim());

      const r = await fetch(`/api/calendar?${params.toString()}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(apiErrorText(d, "Could not load scheduled price updates."));
        setEvents([]);
        return;
      }
      setError("");
      const loaded: CalendarEventItem[] = Array.isArray(d.events) ? d.events : [];
      setEvents(loaded);
      setVendors(Array.isArray(d.vendors) ? d.vendors : []);
      if (d.settings?.timezone) setTimeZone(d.settings.timezone);
      if (d.todayKey) setTodayKey(d.todayKey);

      // Keep open detail modal synced with fresh data
      setSelectedEvent((prev) => (prev ? loaded.find((x) => x.id === prev.id) ?? null : null));
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [vendorFilter, statusFilter, reminderFilter, timeframeFilter, q]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadCalendar();
    }, q.trim() ? 200 : 0);
    return () => clearTimeout(t);
  }, [loadCalendar, q]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    for (const ev of events) {
      const list = map.get(ev.scheduledEffectiveDate) ?? [];
      list.push(ev);
      map.set(ev.scheduledEffectiveDate, list);
    }
    return map;
  }, [events]);

  const stats = useMemo(() => {
    let scheduled = 0;
    let upcoming = 0;
    let remindersActive = 0;
    let remindersFailed = 0;
    for (const ev of events) {
      if (ev.status === "Scheduled" && ev.scheduleStatus === "ACTIVE") {
        scheduled++;
        if (ev.scheduledEffectiveDate >= todayKey) upcoming++;
      }
      if (ev.activeReminder && (ev.activeReminder.status === "SCHEDULED" || ev.activeReminder.status === "PROCESSING")) {
        remindersActive++;
      }
      if (ev.latestReminder?.status === "FAILED") {
        remindersFailed++;
      }
    }
    return { scheduled, upcoming, remindersActive, remindersFailed };
  }, [events, todayKey]);

  const monthCells = useMemo(() => getMonthGridDays(anchorDate), [anchorDate]);
  const weekDays = useMemo(() => getWeekDays(anchorDate), [anchorDate]);

  const navigatePrev = () => {
    if (view === "week") {
      setAnchorDate(addDaysToDateKey(anchorDate, -7));
    } else {
      const [y, m] = anchorDate.split("-").map(Number);
      const prev = new Date(Date.UTC(y, m - 2, 1));
      setAnchorDate(prev.toISOString().slice(0, 10));
    }
  };

  const navigateNext = () => {
    if (view === "week") {
      setAnchorDate(addDaysToDateKey(anchorDate, 7));
    } else {
      const [y, m] = anchorDate.split("-").map(Number);
      const next = new Date(Date.UTC(y, m, 1));
      setAnchorDate(next.toISOString().slice(0, 10));
    }
  };

  const navigateToday = () => {
    setAnchorDate(todayKey);
  };

  const handleDragStart = (e: React.DragEvent, ev: CalendarEventItem) => {
    if (ev.status !== "Scheduled" || ev.scheduleStatus !== "ACTIVE") return;
    setDraggingEventId(ev.id);
    e.dataTransfer.setData("text/plain", ev.id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDropOnDate = (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || draggingEventId;
    setDraggingEventId(null);
    setDropTargetDate(null);
    if (!id) return;
    const ev = events.find((x) => x.id === id);
    if (!ev || ev.scheduledEffectiveDate === targetDate) return;
    if (ev.status !== "Scheduled" || ev.scheduleStatus !== "ACTIVE") return;
    if (targetDate < todayKey) {
      toast.error("Cannot move to a past date.", `Choose ${formatDateKeyShort(todayKey)} or a future date.`);
      return;
    }
    setDropError("");
    setDropNeedsConfirm(false);
    setPendingDrop({ event: ev, targetDate });
  };

  const confirmDragReschedule = async (confirmAfterEffectiveDate = false) => {
    if (!pendingDrop || dropSaving) return;
    setDropSaving(true);
    setDropError("");
    try {
      const r = await fetch(`/api/sessions/${pendingDrop.event.id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effectiveDate: pendingDrop.targetDate,
          reminderEnabled: Boolean(pendingDrop.event.activeReminder),
          preserveExistingReminder: true,
          confirmAfterEffectiveDate,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (d.requiresConfirmation || d.code === "REMINDER_AFTER_EFFECTIVE_DATE") {
          setDropNeedsConfirm(true);
        }
        setDropError(apiErrorText(d, "Could not reschedule this worksheet."));
        return;
      }
      toast.success(
        "Worksheet rescheduled.",
        `${pendingDrop.event.vendor || pendingDrop.event.name} moved to ${formatDateKeyShort(pendingDrop.targetDate)}.`,
      );
      if (d.warning) toast.info("Notice", String(d.warning));
      setPendingDrop(null);
      await loadCalendar();
    } catch {
      setDropError("Could not reach the server while rescheduling.");
    } finally {
      setDropSaving(false);
    }
  };

  const cancelSelectedSchedule = async () => {
    if (!selectedEvent || cancellingDetail) return;
    setCancellingDetail(true);
    try {
      const r = await fetch(`/api/sessions/${selectedEvent.id}/schedule`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error("Could not cancel schedule.", apiErrorText(d, "Could not cancel schedule."));
        return;
      }
      toast.success(
        "Schedule cancelled.",
        `Status restored to ${d.restoredStatus}. Pending reminders were cancelled.`,
      );
      setConfirmCancelDetail(false);
      setSelectedEvent(null);
      await loadCalendar();
    } catch {
      toast.error("Could not cancel schedule.", "Could not reach the server.");
    } finally {
      setCancellingDetail(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              Price Update Calendar
            </h1>
            <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-bold text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
              {stats.upcoming} upcoming
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
            Track scheduled vendor price update effective dates, reschedule worksheets, and monitor automated email reminders ({timeZone}).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/settings"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            Reminder Recipients
          </Link>
          <Link
            href="/sessions"
            className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 dark:bg-white dark:text-slate-900"
          >
            Open Price Updates
          </Link>
        </div>
      </div>

      {/* Compact Metrics Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">Active Scheduled</div>
          <div className="mt-1 text-2xl font-black text-indigo-700 dark:text-indigo-400">{stats.scheduled}</div>
        </div>
        <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">Upcoming</div>
          <div className="mt-1 text-2xl font-black text-slate-900 dark:text-white">{stats.upcoming}</div>
        </div>
        <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">Reminders Queued</div>
          <div className="mt-1 text-2xl font-black text-amber-700 dark:text-amber-400">{stats.remindersActive}</div>
        </div>
        <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">Reminder Failures</div>
          <div className={`mt-1 text-2xl font-black ${stats.remindersFailed > 0 ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white"}`}>
            {stats.remindersFailed}
          </div>
        </div>
      </div>

      {/* Navigation & Filters Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        {/* Top Row: View Switcher + Date Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100/70 p-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-800">
              {(["month", "week", "list"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setView(m)}
                  className={`rounded-md px-3 py-1 font-semibold capitalize transition-colors ${
                    view === m
                      ? "bg-white text-slate-900 shadow-2xs dark:bg-zinc-700 dark:text-white"
                      : "text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {view !== "list" && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={navigatePrev}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  ← Prev
                </button>
                <button
                  type="button"
                  onClick={navigateToday}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={navigateNext}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  Next →
                </button>
              </div>
            )}

            <h2 className="ml-1 text-base font-bold text-slate-900 dark:text-white">
              {view === "month"
                ? formatMonthHeading(anchorDate)
                : view === "week"
                ? `${formatDateKeyShort(weekDays[0])} – ${formatDateKeyShort(weekDays[6])}`
                : `Chronological Schedule (${events.length})`}
            </h2>
          </div>

          {view !== "list" && (
            <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-zinc-400">
              <span>Jump to:</span>
              <input
                type="date"
                value={anchorDate}
                onChange={(e) => {
                  if (isValidDateKey(e.target.value)) setAnchorDate(e.target.value);
                }}
                className="h-8 rounded-lg border border-slate-200 bg-slate-50/50 px-2 text-xs text-slate-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              />
            </label>
          )}
        </div>

        {/* Bottom Row: Search + Filters */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-zinc-800">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search vendor or worksheet reference..."
            className="h-8 min-w-52 flex-1 rounded-lg border border-slate-200 bg-slate-50/50 px-3 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          />

          <select
            aria-label="Filter by vendor"
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            <option value="">All Vendors</option>
            {vendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            <option value="all">Scheduled &amp; Completed</option>
            <option value="scheduled">Scheduled Only</option>
            <option value="completed">Completed / Exported</option>
            <option value="cancelled">Cancelled Schedules</option>
          </select>

          <select
            aria-label="Filter by reminder status"
            value={reminderFilter}
            onChange={(e) => setReminderFilter(e.target.value)}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            <option value="all">All Reminders</option>
            <option value="enabled">Reminder Enabled</option>
            <option value="disabled">Reminder Disabled</option>
            <option value="sent">Reminder Sent</option>
            <option value="failed">Reminder Failed</option>
          </select>

          <select
            aria-label="Filter by timeframe"
            value={timeframeFilter}
            onChange={(e) => setTimeframeFilter(e.target.value)}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            <option value="all">All Dates</option>
            <option value="upcoming">Upcoming Only</option>
            <option value="past">Past Scheduled Dates</option>
          </select>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadCalendar()}
            className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Loading scheduled price updates...
        </div>
      )}

      {/* MONTH VIEW */}
      {!loading && view === "month" && (
        <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/70 text-center text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300">
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="py-2.5">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 divide-x divide-y divide-slate-100 dark:divide-zinc-800">
            {monthCells.map((cell) => {
              const dayEvents = eventsByDate.get(cell.dateKey) ?? [];
              const isToday = cell.dateKey === todayKey;
              const isDropTarget = dropTargetDate === cell.dateKey;
              const dayNum = Number(cell.dateKey.slice(8, 10));

              return (
                <div
                  key={cell.dateKey}
                  onDragOver={(e) => {
                    if (draggingEventId) {
                      e.preventDefault();
                      setDropTargetDate(cell.dateKey);
                    }
                  }}
                  onDragLeave={() => {
                    if (dropTargetDate === cell.dateKey) setDropTargetDate(null);
                  }}
                  onDrop={(e) => handleDropOnDate(e, cell.dateKey)}
                  className={`min-h-28 p-1.5 transition-colors sm:min-h-32 sm:p-2 ${
                    !cell.inMonth
                      ? "bg-slate-50/70 text-slate-400 dark:bg-zinc-950/40 dark:text-zinc-600"
                      : "bg-white dark:bg-zinc-900"
                  } ${isDropTarget ? "ring-2 ring-inset ring-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                        isToday
                          ? "bg-indigo-600 text-white"
                          : cell.inMonth
                          ? "text-slate-800 dark:text-zinc-200"
                          : "text-slate-400 dark:text-zinc-600"
                      }`}
                    >
                      {dayNum}
                    </span>
                    {dayEvents.length > 0 && (
                      <span className="text-[10px] font-semibold text-slate-400 dark:text-zinc-500">
                        {dayEvents.length}
                      </span>
                    )}
                  </div>

                  <div className="mt-1.5 flex flex-col gap-1">
                    {dayEvents.map((ev) => {
                      const st = eventStatusBadge(ev);
                      const rem = ev.activeReminder ?? ev.latestReminder;
                      const draggable = ev.status === "Scheduled" && ev.scheduleStatus === "ACTIVE";
                      return (
                        <button
                          key={ev.id}
                          type="button"
                          draggable={draggable}
                          onDragStart={(e) => handleDragStart(e, ev)}
                          onDragEnd={() => {
                            setDraggingEventId(null);
                            setDropTargetDate(null);
                          }}
                          onClick={() => {
                            setConfirmCancelDetail(false);
                            setSelectedEvent(ev);
                          }}
                          title={`${ev.vendor || "Vendor"} — ${ev.name} (${st.label})${draggable ? " · Drag to reschedule" : ""}`}
                          className={`group flex w-full flex-col rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight transition-colors ${st.cardCls}`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate font-bold">{ev.vendor || "Vendor"}</span>
                            {rem && (
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                  rem.status === "SENT"
                                    ? "bg-emerald-500"
                                    : rem.status === "FAILED"
                                    ? "bg-red-500"
                                    : rem.status === "SCHEDULED" || rem.status === "PROCESSING"
                                    ? "bg-amber-500"
                                    : "bg-slate-400"
                                }`}
                                title={`Reminder: ${rem.status}`}
                              />
                            )}
                          </div>
                          <span className="truncate text-[10px] opacity-80">{ev.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* WEEK VIEW */}
      {!loading && view === "week" && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          {weekDays.map((dk, idx) => {
            const dayEvents = eventsByDate.get(dk) ?? [];
            const isToday = dk === todayKey;
            const isDropTarget = dropTargetDate === dk;
            return (
              <div
                key={dk}
                onDragOver={(e) => {
                  if (draggingEventId) {
                    e.preventDefault();
                    setDropTargetDate(dk);
                  }
                }}
                onDragLeave={() => {
                  if (dropTargetDate === dk) setDropTargetDate(null);
                }}
                onDrop={(e) => handleDropOnDate(e, dk)}
                className={`flex min-h-60 flex-col rounded-xl border bg-white p-3 shadow-xs dark:bg-zinc-900 ${
                  isToday
                    ? "border-indigo-400 ring-1 ring-indigo-500/20 dark:border-indigo-500"
                    : "border-slate-200/90 dark:border-zinc-800"
                } ${isDropTarget ? "ring-2 ring-indigo-500 bg-indigo-50/30 dark:bg-indigo-950/30" : ""}`}
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-zinc-800">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                      {WEEKDAY_LABELS[idx]}
                    </div>
                    <div className={`text-sm font-bold ${isToday ? "text-indigo-600 dark:text-indigo-400" : "text-slate-900 dark:text-white"}`}>
                      {formatDateKeyShort(dk)}
                    </div>
                  </div>
                  {isToday && (
                    <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                      Today
                    </span>
                  )}
                </div>

                <div className="mt-2.5 flex flex-1 flex-col gap-2">
                  {dayEvents.length === 0 ? (
                    <div className="py-6 text-center text-[11px] text-slate-400 dark:text-zinc-600">
                      No updates
                    </div>
                  ) : (
                    dayEvents.map((ev) => {
                      const st = eventStatusBadge(ev);
                      const rb = reminderBadge(ev);
                      const draggable = ev.status === "Scheduled" && ev.scheduleStatus === "ACTIVE";
                      return (
                        <button
                          key={ev.id}
                          type="button"
                          draggable={draggable}
                          onDragStart={(e) => handleDragStart(e, ev)}
                          onDragEnd={() => {
                            setDraggingEventId(null);
                            setDropTargetDate(null);
                          }}
                          onClick={() => {
                            setConfirmCancelDetail(false);
                            setSelectedEvent(ev);
                          }}
                          className={`flex flex-col gap-1.5 rounded-lg border p-2.5 text-left transition-colors ${st.cardCls}`}
                        >
                          <div className="text-xs font-bold">{ev.vendor || "Vendor"}</div>
                          <div className="text-[11px] opacity-90">{ev.name}</div>
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            <span className={`rounded-full border px-1.5 py-0.2 text-[9px] font-bold ${st.cls}`}>
                              {st.label}
                            </span>
                            <span className={`rounded-full border px-1.5 py-0.2 text-[9px] font-bold ${rb.cls}`}>
                              {rb.label}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* LIST VIEW */}
      {!loading && view === "list" && (
        <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          {events.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500 dark:text-zinc-400">
              <div className="font-semibold text-slate-700 dark:text-zinc-200">No scheduled price updates match your filters</div>
              <p className="mt-1">
                Open any Ready or Reviewed worksheet in{" "}
                <Link href="/sessions" className="font-semibold text-indigo-600 underline dark:text-indigo-400">
                  Price Updates
                </Link>{" "}
                and click <strong>Schedule</strong> to add it to the Calendar.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-300">
                    <th className="px-4 py-3">Effective Date</th>
                    <th className="px-4 py-3">Vendor</th>
                    <th className="px-4 py-3">Worksheet Reference</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Email Reminder</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                  {events.map((ev) => {
                    const st = eventStatusBadge(ev);
                    const rb = reminderBadge(ev);
                    const rem = ev.activeReminder ?? ev.latestReminder;
                    return (
                      <tr key={ev.id} className="hover:bg-slate-50/70 dark:hover:bg-zinc-800/50">
                        <td className="whitespace-nowrap px-4 py-3 font-bold text-slate-900 dark:text-white">
                          <div>{formatDateKeyShort(ev.scheduledEffectiveDate)}</div>
                          {ev.scheduledEffectiveDate === todayKey && (
                            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">Today</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 font-bold text-slate-800 dark:bg-zinc-800 dark:text-zinc-200">
                            {ev.vendor || "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmCancelDetail(false);
                              setSelectedEvent(ev);
                            }}
                            className="text-left font-semibold text-indigo-700 hover:underline dark:text-indigo-300"
                          >
                            {ev.name}
                          </button>
                          <div className="text-[11px] text-slate-500 dark:text-zinc-400">
                            {ev.itemCount.toLocaleString()} item{ev.itemCount === 1 ? "" : "s"}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold ${rb.cls}`}>
                              {rb.label}
                            </span>
                            {rem && (
                              <span className="text-[11px] text-slate-500 dark:text-zinc-400">
                                {rem.scheduledReminderLocal.formatted}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmCancelDetail(false);
                                setSelectedEvent(ev);
                              }}
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                            >
                              Details
                            </button>
                            <Link
                              href={`/sessions/${ev.id}`}
                              className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300"
                            >
                              Open Worksheet
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Legend & Tip */}
      {!loading && view !== "list" && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-zinc-400">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-indigo-200 border border-indigo-400" /> Scheduled</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-200 border border-emerald-400" /> Completed / Exported</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> Reminder Queued</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Reminder Sent</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" /> Reminder Failed</span>
          </div>
          <span>Tip: Click any event for details, or drag an active scheduled worksheet to another date to reschedule with confirmation.</span>
        </div>
      )}

      {/* EVENT DETAIL MODAL */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-2xs p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Scheduled Worksheet Details"
        >
          <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-zinc-800">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-800 dark:bg-zinc-800 dark:text-zinc-200">
                    {selectedEvent.vendor || "Vendor"}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${eventStatusBadge(selectedEvent).cls}`}>
                    {eventStatusBadge(selectedEvent).label}
                  </span>
                </div>
                <h2 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">{selectedEvent.name}</h2>
                <p className="text-xs text-slate-500 dark:text-zinc-400">
                  Effective Date: <strong className="text-slate-800 dark:text-zinc-200">{formatDateKeyLong(selectedEvent.scheduledEffectiveDate)}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-zinc-800"
                aria-label="Close details"
              >
                ✕
              </button>
            </div>

            {/* Metadata Grid */}
            <div className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
                <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-zinc-400">Worksheet Info</div>
                <div className="mt-1 space-y-1 text-slate-700 dark:text-zinc-300">
                  <div>Items: <strong>{selectedEvent.itemCount.toLocaleString()}</strong></div>
                  <div>Created: <strong>{new Date(selectedEvent.createdAt).toLocaleString()}</strong></div>
                  <div>Created by: <strong>{selectedEvent.createdBy || "—"}</strong></div>
                </div>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
                <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-zinc-400">Scheduling Info</div>
                <div className="mt-1 space-y-1 text-slate-700 dark:text-zinc-300">
                  <div>Scheduled at: <strong>{selectedEvent.scheduledAt ? new Date(selectedEvent.scheduledAt).toLocaleString() : "—"}</strong></div>
                  <div>Scheduled by: <strong>{selectedEvent.scheduledBy || "—"}</strong></div>
                  {selectedEvent.scheduleCancelledAt && (
                    <div className="text-red-600 dark:text-red-400">
                      Cancelled by {selectedEvent.scheduleCancelledBy} on {new Date(selectedEvent.scheduleCancelledAt).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Reminder Status Card */}
            <div className="mt-4 rounded-xl border border-slate-200 p-4 text-xs dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900 dark:text-white">Email Reminder</span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${reminderBadge(selectedEvent).cls}`}>
                  {reminderBadge(selectedEvent).label}
                </span>
              </div>
              {(() => {
                const rem = selectedEvent.activeReminder ?? selectedEvent.latestReminder;
                if (!rem) {
                  return (
                    <p className="mt-2 text-slate-500 dark:text-zinc-400">
                      Email reminders are disabled for this worksheet.
                    </p>
                  );
                }
                const recips = rem.resolvedRecipients ?? rem.effectiveRecipients;
                return (
                  <div className="mt-2.5 space-y-1.5 text-slate-700 dark:text-zinc-300">
                    <div>
                      Timing: <strong>{getReminderTypeLabel(rem.reminderType)}</strong>
                    </div>
                    <div>
                      Scheduled Send: <strong>{rem.scheduledReminderLocal.formatted}</strong>
                    </div>
                    <div>
                      Recipients ({rem.customRecipients ? "worksheet custom" : "default"}):{" "}
                      <strong>{recips.length ? recips.join(", ") : "None configured"}</strong>
                    </div>
                    <div>
                      Delivery Status: <strong>{rem.status}</strong>
                      {rem.attemptCount > 0 ? ` (${rem.attemptCount}/${rem.maxAttempts} attempts)` : ""}
                    </div>
                    {rem.sentAt && (
                      <div className="text-emerald-700 dark:text-emerald-400">
                        Accepted by SMTP2GO at: <strong>{new Date(rem.sentAt).toLocaleString()}</strong>
                        {rem.providerEmailId ? ` (ID: ${rem.providerEmailId})` : ""}
                      </div>
                    )}
                    {rem.lastError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
                        Last Error: {rem.lastError}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Schedule Audit History */}
            {selectedEvent.history.length > 0 && (
              <div className="mt-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                  Scheduling History
                </div>
                <div className="mt-2 flex max-h-36 flex-col gap-1.5 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/50 p-2.5 text-[11px] dark:border-zinc-800 dark:bg-zinc-800/30">
                  {selectedEvent.history.map((h) => (
                    <div key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-1 last:border-0 last:pb-0 dark:border-zinc-800">
                      <div>
                        <span className="font-bold text-slate-800 dark:text-zinc-200">{h.action}</span>{" "}
                        <span className="text-slate-600 dark:text-zinc-400">— {h.detail}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 dark:text-zinc-500">
                        {h.performedBy} · {new Date(h.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cancel Confirmation */}
            {confirmCancelDetail && selectedEvent.scheduleStatus === "ACTIVE" && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50/70 p-3.5 text-xs dark:border-red-900/60 dark:bg-red-950/30">
                <div className="font-bold text-red-900 dark:text-red-200">Confirm Schedule Cancellation</div>
                <p className="mt-1 text-red-800 dark:text-red-300">
                  Remove from active calendar, cancel pending reminders, and restore worksheet status to{" "}
                  <strong>{selectedEvent.previousStatus || "Ready"}</strong>? The worksheet and all pricing rows stay untouched.
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={cancellingDetail}
                    onClick={() => setConfirmCancelDetail(false)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  >
                    Keep Schedule
                  </button>
                  <LoadingButton
                    busy={cancellingDetail}
                    busyLabel="Cancelling..."
                    onClick={cancelSelectedSchedule}
                    className="rounded-lg bg-red-600 px-3 py-1.5 font-bold text-white hover:bg-red-700"
                  >
                    Confirm Cancel
                  </LoadingButton>
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 dark:border-zinc-800">
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/sessions/${selectedEvent.id}`}
                  className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
                >
                  Open Worksheet
                </Link>
                {selectedEvent.status === "Scheduled" && selectedEvent.scheduleStatus === "ACTIVE" && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingScheduleEvent(selectedEvent);
                        setSelectedEvent(null);
                      }}
                      className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                    >
                      Change Schedule / Edit Reminder
                    </button>
                    {!confirmCancelDetail && (
                      <button
                        type="button"
                        onClick={() => setConfirmCancelDetail(true)}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                      >
                        Cancel Schedule
                      </button>
                    )}
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DRAG-AND-DROP RESCHEDULE CONFIRMATION MODAL */}
      {pendingDrop && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-2xs p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm Reschedule"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Confirm Reschedule</h2>
            <p className="mt-2 text-xs text-slate-600 dark:text-zinc-300">
              Move <strong>{pendingDrop.event.vendor || pendingDrop.event.name}</strong> ({pendingDrop.event.name}) from{" "}
              <strong>{formatDateKeyShort(pendingDrop.event.scheduledEffectiveDate)}</strong> to{" "}
              <strong>{formatDateKeyShort(pendingDrop.targetDate)}</strong>?
            </p>
            {pendingDrop.event.activeReminder && (
              <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-slate-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {pendingDrop.event.activeReminder.reminderType === "CUSTOM"
                  ? `Your custom reminder (${pendingDrop.event.activeReminder.scheduledReminderLocal.formatted}) will stay unchanged unless you edit it.`
                  : `Your ${getReminderTypeLabel(pendingDrop.event.activeReminder.reminderType)} reminder will automatically recalculate for the new effective date.`}
              </p>
            )}
            {dropError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
                {dropError}
              </div>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={dropSaving}
                onClick={() => setPendingDrop(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-zinc-700 dark:text-zinc-300"
              >
                Cancel
              </button>
              {dropError && !dropNeedsConfirm && (
                <button
                  type="button"
                  onClick={() => {
                    const ev = pendingDrop.event;
                    setPendingDrop(null);
                    setEditingScheduleEvent(ev);
                  }}
                  className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800"
                >
                  Edit Reminder Instead
                </button>
              )}
              {dropNeedsConfirm ? (
                <LoadingButton
                  busy={dropSaving}
                  busyLabel="Saving..."
                  onClick={() => void confirmDragReschedule(true)}
                  className="rounded-lg bg-amber-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-amber-700"
                >
                  Confirm Move Anyway
                </LoadingButton>
              ) : (
                <LoadingButton
                  busy={dropSaving}
                  busyLabel="Saving..."
                  onClick={() => void confirmDragReschedule(false)}
                  className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
                >
                  Save New Date
                </LoadingButton>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SCHEDULE / EDIT REMINDER MODAL */}
      {editingScheduleEvent && (
        <ScheduleWorksheetModal
          isOpen={true}
          sessionId={editingScheduleEvent.id}
          vendor={editingScheduleEvent.vendor}
          worksheetName={editingScheduleEvent.name}
          currentStatus={editingScheduleEvent.status}
          currentSchedule={toScheduleSummary(editingScheduleEvent)}
          onClose={() => setEditingScheduleEvent(null)}
          onSaved={() => {
            void loadCalendar();
          }}
          onCancelled={() => {
            void loadCalendar();
          }}
        />
      )}
    </div>
  );
}
