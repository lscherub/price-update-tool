"use client";

import React, { useState } from "react";
import { useUiMode, type UiMode, type UiTheme, type UiAccent, type UiDensity, type DashboardSectionId, type MetricKey } from "@/contexts/UiModeContext";
import { useToast } from "@/components/Toast";

export default function SettingsPage() {
  const toast = useToast();
  const {
    mode,
    theme,
    accent,
    density,
    dashboard,
    navigation,
    requestModeChange,
    setTheme,
    setAccent,
    setDensity,
    toggleSectionVisibility,
    reorderSections,
    toggleMetricVisibility,
    toggleNavItemVisibility,
    resetDefaults,
  } = useUiMode();

  const [activeTab, setActiveTab] = useState<"appearance" | "dashboard" | "system">("appearance");

  const handleModeSelect = (newMode: UiMode) => {
    if (newMode === mode) return;
    const ok = requestModeChange(newMode);
    if (ok) {
      toast.success(
        `Switched to ${newMode === "new" ? "New UI" : "Classic UI"}.`,
        "All data and preferences remain preserved."
      );
    }
  };

  const handleReset = () => {
    resetDefaults();
    toast.success("Appearance and layout reset to default settings.");
  };

  const ACCENTS: { id: UiAccent; name: string; color: string; sample: string }[] = [
    { id: "indigo", name: "Indigo", color: "#4f46e5", sample: "bg-indigo-600" },
    { id: "blue", name: "Corporate Blue", color: "#2563eb", sample: "bg-blue-600" },
    { id: "emerald", name: "Emerald", color: "#059669", sample: "bg-emerald-600" },
    { id: "violet", name: "Violet", color: "#7c3aed", sample: "bg-violet-600" },
    { id: "slate", name: "Slate Neutral", color: "#334155", sample: "bg-slate-700" },
  ];

  const DENSITIES: { id: UiDensity; label: string; desc: string }[] = [
    { id: "compact", label: "Compact", desc: "Highest information density, reduced padding, ideal for continuous data entry" },
    { id: "comfortable", label: "Comfortable", desc: "Recommended balance between readability and screen space" },
    { id: "spacious", label: "Spacious", desc: "Open spacing with generous touch targets and relaxed margins" },
  ];

  const SECTION_LABELS: Record<DashboardSectionId, { label: string; desc: string }> = {
    metrics: { label: "Key Operational Metrics", desc: "Summary cards with total products, active/inactive counts, vendors, and sessions" },
    quickActions: { label: "Workflow Launchpad", desc: "One-click shortcuts to start updates, import inventory, or calculate prices" },
    recentUpdates: { label: "Recent Price Updates", desc: "Table showing latest worksheets, status, and direct open links" },
    inventoryHealth: { label: "Inventory Health & Sync Status", desc: "Visual active-to-inactive inventory breakdown and last import status" },
  };

  const METRIC_LABELS: Record<MetricKey, string> = {
    products: "Total Products",
    active: "Active Products",
    inactive: "Inactive Products",
    vendors: "Vendors Count",
    sessions: "Total Sessions",
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings & Customization</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
          Personalize interface mode, appearance, theme, and dashboard layout.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setActiveTab("appearance")}
          className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
            activeTab === "appearance"
              ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
              : "border-transparent text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          Appearance & Themes
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("dashboard")}
          className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
            activeTab === "dashboard"
              ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
              : "border-transparent text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          Dashboard & Layout
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("system")}
          className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
            activeTab === "system"
              ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
              : "border-transparent text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          System & Data Rules
        </button>
      </div>

      {/* TAB 1: Appearance & Themes */}
      {activeTab === "appearance" && (
        <div className="flex flex-col gap-6">
          {/* Section 1: Interface Mode */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Interface Mode</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              Select between the modernized New UI or the original Classic UI. Switching modes never modifies business data.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Option: New UI */}
              <div
                onClick={() => handleModeSelect("new")}
                className={`relative flex cursor-pointer flex-col justify-between rounded-xl border p-4 transition-all ${
                  mode === "new"
                    ? "border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-600/20 dark:border-indigo-400 dark:bg-indigo-950/20"
                    : "border-slate-200 bg-white hover:border-slate-300 dark:border-zinc-800 dark:bg-zinc-900"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-white">New UI</span>
                    {mode === "new" && (
                      <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-zinc-400">
                    Modern enterprise design with collapsible grouped sidebar, customizable dashboard, accessible color themes, and compact density controls.
                  </p>
                </div>
                <div className="mt-4 flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                  <span>Default recommended experience</span>
                </div>
              </div>

              {/* Option: Classic UI */}
              <div
                onClick={() => handleModeSelect("classic")}
                className={`relative flex cursor-pointer flex-col justify-between rounded-xl border p-4 transition-all ${
                  mode === "classic"
                    ? "border-slate-900 bg-slate-50 ring-2 ring-slate-900/20 dark:border-slate-400 dark:bg-zinc-800"
                    : "border-slate-200 bg-white hover:border-slate-300 dark:border-zinc-800 dark:bg-zinc-900"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-white">Classic UI</span>
                    {mode === "classic" && (
                      <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white dark:bg-slate-200 dark:text-slate-900">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-zinc-400">
                    The familiar original layout preserved exactly as previously built. Ideal for existing team members preferring continuity.
                  </p>
                </div>
                <div className="mt-4 flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                  <span>Preserves original visual style</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Theme Selection */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Theme & Color Mode</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              Control light, dark, or system-matching color presentation (applies in New UI).
            </p>

            <div className="mt-4 grid grid-cols-3 gap-3 max-w-md">
              {(
                [
                  { id: "light" as UiTheme, label: "Light", icon: "☀️" },
                  { id: "dark" as UiTheme, label: "Dark", icon: "🌙" },
                  { id: "system" as UiTheme, label: "System", icon: "💻" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTheme(t.id)}
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-xs font-semibold transition-all ${
                    theme === t.id
                      ? "border-indigo-600 bg-indigo-50/50 font-bold text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/40 dark:text-indigo-200 ring-1 ring-indigo-500/30"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
                  }`}
                >
                  <span className="text-base">{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Section 3: Accent Color Presets */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Accent Color</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              Select a restrained, accessible accent palette for primary actions and active navigation items.
            </p>

            <div className="mt-4 flex flex-wrap gap-3">
              {ACCENTS.map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => setAccent(acc.id)}
                  className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all ${
                    accent === acc.id
                      ? "border-slate-900 ring-2 ring-slate-900/10 dark:border-white dark:ring-white/10"
                      : "border-slate-200 bg-white hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-900"
                  }`}
                >
                  <span className={`h-4 w-4 rounded-full ${acc.sample}`} />
                  <span className="text-slate-800 dark:text-zinc-200">{acc.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Section 4: Display Density */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Table & Interface Density</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              Choose padding and font proportions for large worksheets and inventory tables.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {DENSITIES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDensity(d.id)}
                  className={`flex flex-col rounded-xl border p-3.5 text-left transition-all ${
                    density === d.id
                      ? "border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-500/30 dark:border-indigo-400 dark:bg-indigo-950/30"
                      : "border-slate-200 bg-white hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-900"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-900 dark:text-white">{d.label}</span>
                    {density === d.id && (
                      <span className="h-2 w-2 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400 leading-normal">
                    {d.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Dashboard & Layout Customization */}
      {activeTab === "dashboard" && (
        <div className="flex flex-col gap-6">
          {/* Dashboard Sections Reordering and Visibility */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Dashboard Sections & Order</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                  Toggle visibility and arrange the order of operational widgets on your main dashboard.
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2.5">
              {dashboard.sections.map((secId, index) => {
                const info = SECTION_LABELS[secId];
                const isVisible = dashboard.sectionVisibility[secId];

                return (
                  <div
                    key={secId}
                    className={`flex items-center justify-between rounded-xl border p-3 transition-colors ${
                      isVisible
                        ? "border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                        : "border-dashed border-slate-200 bg-slate-50/60 opacity-60 dark:border-zinc-800 dark:bg-zinc-900/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isVisible}
                        onChange={() => toggleSectionVisibility(secId)}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <div className="text-xs font-bold text-slate-900 dark:text-white">{info.label}</div>
                        <div className="text-[11px] text-slate-500 dark:text-zinc-400">{info.desc}</div>
                      </div>
                    </div>

                    {/* Reorder Buttons */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => reorderSections(index, index - 1)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 dark:hover:bg-zinc-800"
                        title="Move Up"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={index === dashboard.sections.length - 1}
                        onClick={() => reorderSections(index, index + 1)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 dark:hover:bg-zinc-800"
                        title="Move Down"
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Metric Cards Visibility */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Displayed Key Metrics</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              Select which high-level metrics appear in the Key Operational Metrics section.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
              {(Object.keys(METRIC_LABELS) as MetricKey[]).map((k) => (
                <label
                  key={k}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
                >
                  <input
                    type="checkbox"
                    checked={dashboard.visibleMetrics[k]}
                    onChange={() => toggleMetricVisibility(k)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-xs font-semibold text-slate-800 dark:text-zinc-200">
                    {METRIC_LABELS[k]}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Navigation Item Visibility */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Navigation Items</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              Hide optional navigation shortcuts if not needed for your daily workflow. Essential system links remain accessible.
            </p>

            <div className="mt-4 flex flex-wrap gap-2.5">
              {[
                { href: "/fullvendor/new", label: "Full Vendor Update" },
                { href: "/calculator", label: "Pricing Calculator" },
                { href: "/exports", label: "Data Exports" },
              ].map((item) => {
                const isHidden = navigation.hiddenNavItems.includes(item.href);
                return (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => toggleNavItemVisibility(item.href)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      isHidden
                        ? "border-dashed border-slate-300 bg-slate-50 text-slate-400 dark:border-zinc-800 dark:bg-zinc-900"
                        : "border-slate-200 bg-white text-slate-800 shadow-2xs hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                    }`}
                  >
                    {isHidden ? `+ Show ${item.label}` : `✓ ${item.label}`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reset to Defaults */}
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              Restore Default Appearance & Layout
            </button>
          </div>
        </div>
      )}

      {/* TAB 3: System & Data Rules */}
      {activeTab === "system" && (
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Business Integrity & Safety Rules</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              How user interface modes interact with application business data.
            </p>

            <div className="mt-4 flex flex-col gap-3 text-xs text-slate-600 dark:text-zinc-400">
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-zinc-800/60">
                <span className="font-bold text-slate-900 dark:text-zinc-200">Shared Database & APIs:</span> Both Classic UI and New UI query the identical PostgreSQL schema, database endpoints, and authorization logic. No duplicate database schemas or diverged pricing logic exist.
              </div>
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-zinc-800/60">
                <span className="font-bold text-slate-900 dark:text-zinc-200">Zero Data Loss on Switch:</span> Switching interface modes re-renders the presentation shell without discarding unsaved worksheet changes, modifying vendor discounts, altering inventory products, or triggering database migrations.
              </div>
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-zinc-800/60">
                <span className="font-bold text-slate-900 dark:text-zinc-200">Strict Safety Confirmations:</span> Bulk deletions, inventory clearing, and status modifications maintain full confirmation guards in both modes.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

