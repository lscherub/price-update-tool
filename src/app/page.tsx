"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiErrorText } from "@/lib/apiError";
import { useUiMode, type DashboardSectionId, type MetricKey } from "@/contexts/UiModeContext";

type Dash = {
  totals: { products: number; inactive: number; active: number; vendors: number; sessions: number };
  recentSessions: { id: string; vendor: string; name: string; status: string; updatedAt: string }[];
};

export default function Home() {
  const { mode, dashboard } = useUiMode();
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState("");
  const [lastImported, setLastImported] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/dashboard");
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(apiErrorText(d, "Could not load the dashboard."));
          return;
        }
        setError("");
        setData(d as Dash);
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
      }
    })();
  }, []);

  useEffect(() => {
    fetch("/api/inventory/last-import")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d?.lastImportedAt === "string") setLastImported(d.lastImportedAt);
      })
      .catch(() => {});
  }, []);

  // ==========================================
  // CLASSIC UI MODE (Preserved pixel-perfect)
  // ==========================================
  if (mode === "classic") {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Price Update Tool</h1>
            <p className="text-sm text-slate-500">Dashboard — fast server-side price processing</p>
          </div>
          <Link href="/sessions/new" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            + New Price Update
          </Link>
        </div>
        {error && <div className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</div>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ["Products", data?.totals.products ?? "—"],
            ["Active", data?.totals.active ?? "—"],
            ["Inactive", data?.totals.inactive ?? "—"],
            ["Vendors", data?.totals.vendors ?? "—"],
            ["Sessions", data?.totals.sessions ?? "—"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border bg-white p-4">
              <div className="text-xs uppercase text-slate-500">{k}</div>
              <div className="text-2xl font-bold">{v}</div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border bg-white">
          <div className="border-b px-4 py-3 font-semibold">Recent Price Updates</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="px-4 py-2">Vendor</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Updated</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(data?.recentSessions ?? []).map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-4 py-2">{s.vendor}</td>
                  <td className="px-4 py-2">{s.name}</td>
                  <td className="px-4 py-2">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{s.status}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">{new Date(s.updatedAt).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">
                    <Link className="text-blue-600 underline" href={`/sessions/${s.id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
              {!data?.recentSessions?.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    No sessions yet. Create your first price update.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ==========================================
  // NEW UI MODE (Modern, customizable layout)
  // ==========================================
  const totalProducts = data?.totals.products ?? 0;
  const activeProducts = data?.totals.active ?? 0;
  const inactiveProducts = data?.totals.inactive ?? 0;
  const activeRatio = totalProducts > 0 ? Math.round((activeProducts / totalProducts) * 100) : 0;

  const METRIC_DEFS: { key: MetricKey; label: string; value: string | number; sub: string; icon: string }[] = [
    {
      key: "products",
      label: "Total Products",
      value: data?.totals.products?.toLocaleString() ?? "—",
      sub: "Master catalog SKUs",
      icon: "📦",
    },
    {
      key: "active",
      label: "Active Products",
      value: data?.totals.active?.toLocaleString() ?? "—",
      sub: `${activeRatio}% catalog active`,
      icon: "✅",
    },
    {
      key: "inactive",
      label: "Inactive Products",
      value: data?.totals.inactive?.toLocaleString() ?? "—",
      sub: "Excluded from updates",
      icon: "⏸️",
    },
    {
      key: "vendors",
      label: "Vendor Discounts",
      value: data?.totals.vendors?.toLocaleString() ?? "—",
      sub: "Discount rules configured",
      icon: "🏷️",
    },
    {
      key: "sessions",
      label: "Price Updates",
      value: data?.totals.sessions?.toLocaleString() ?? "—",
      sub: "Historical worksheets",
      icon: "📋",
    },
  ];

  const visibleMetrics = METRIC_DEFS.filter((m) => dashboard.visibleMetrics[m.key]);

  const renderSection = (sectionId: DashboardSectionId) => {
    if (!dashboard.sectionVisibility[sectionId]) return null;

    switch (sectionId) {
      case "metrics":
        return (
          <div key="metrics" className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                Operational Overview
              </h2>
              <Link
                href="/settings"
                className="text-xs text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-white"
              >
                Customize metrics →
              </Link>
            </div>
            <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-${Math.min(visibleMetrics.length, 5)}`}>
              {visibleMetrics.map((m) => (
                <div
                  key={m.key}
                  className="group relative flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs transition-all hover:border-slate-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600 dark:text-zinc-300">{m.label}</span>
                    <span className="text-sm opacity-80">{m.icon}</span>
                  </div>
                  <div className="my-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                    {m.value}
                  </div>
                  <div className="text-[11px] font-medium text-slate-600 dark:text-zinc-300">{m.sub}</div>
                </div>
              ))}
            </div>
          </div>
        );

      case "quickActions":
        return (
          <div key="quickActions" className="flex flex-col gap-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
              Workflow Launchpad
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Link
                href="/sessions/new"
                className="group flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs transition-all hover:border-indigo-300 hover:bg-indigo-50/20 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-950/20"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400">
                      ⚡
                    </span>
                    <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      Start →
                    </span>
                  </div>
                  <h3 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">
                    New Price Update
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-zinc-300">
                    Import vendor price changes or paste SKU data to generate a worksheet.
                  </p>
                </div>
              </Link>

              <Link
                href="/fullvendor/new"
                className="group flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs transition-all hover:border-violet-300 hover:bg-violet-50/20 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-violet-500/50 dark:hover:bg-violet-950/20"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400">
                      🏢
                    </span>
                    <span className="text-xs font-bold text-violet-600 dark:text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      Create →
                    </span>
                  </div>
                  <h3 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">
                    Full Vendor Update
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-zinc-300">
                    Create a full catalog worksheet to update all products for a chosen vendor.
                  </p>
                </div>
              </Link>

              <Link
                href="/inventory"
                className="group flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs transition-all hover:border-emerald-300 hover:bg-emerald-50/20 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-500/50 dark:hover:bg-emerald-950/20"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                      📥
                    </span>
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      Manage →
                    </span>
                  </div>
                  <h3 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">
                    All Inventory
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-zinc-300">
                    Import POS catalog files, filter items, and manage active/inactive statuses.
                  </p>
                </div>
              </Link>

              <Link
                href="/calculator"
                className="group flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs transition-all hover:border-blue-300 hover:bg-blue-50/20 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-500/50 dark:hover:bg-blue-950/20"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                      🧮
                    </span>
                    <span className="text-xs font-bold text-blue-600 dark:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      Calculate →
                    </span>
                  </div>
                  <h3 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">
                    Pricing Calculator
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-zinc-300">
                    Single item, batch, and bulk CSV simulation using saved discount rules.
                  </p>
                </div>
              </Link>
            </div>
          </div>
        );

      case "recentUpdates":
        return (
          <div
            key="recentUpdates"
            className="flex flex-col rounded-xl border border-slate-200/80 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-zinc-800">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Recent Price Updates</h2>
                <p className="text-xs text-slate-600 dark:text-zinc-300">
                  Latest working sheets and their current review progress
                </p>
              </div>
              <Link
                href="/sessions"
                className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
              >
                View all history →
              </Link>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-300">
                    <th className="px-5 py-3">Vendor</th>
                    <th className="px-5 py-3">Update Sheet Name</th>
                    <th className="px-5 py-3">Review Status</th>
                    <th className="px-5 py-3">Last Modified</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                  {(data?.recentSessions ?? []).map((s) => {
                    const statusColor =
                      s.status === "Reviewed"
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800"
                        : s.status === "Being Reviewed"
                        ? "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800"
                        : s.status === "Ready"
                        ? "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800"
                        : "bg-slate-100 text-slate-700 border-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700";

                    return (
                      <tr
                        key={s.id}
                        className="transition-colors hover:bg-slate-50/70 dark:hover:bg-zinc-800/50"
                      >
                        <td className="px-5 py-3 font-semibold text-slate-900 dark:text-white">
                          <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700 dark:bg-zinc-800 dark:text-zinc-200">
                            {s.vendor}
                          </span>
                        </td>
                        <td className="px-5 py-3 font-medium text-slate-800 dark:text-zinc-200">
                          {s.name}
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusColor}`}
                          >
                            {s.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-600 dark:text-zinc-300">
                          {new Date(s.updatedAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Link
                            href={`/sessions/${s.id}`}
                            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/50"
                          >
                            Open Worksheet →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                  {!data?.recentSessions?.length && (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-slate-600 dark:text-zinc-300">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <span className="text-2xl">📋</span>
                          <span className="font-semibold">No price updates created yet</span>
                          <Link
                            href="/sessions/new"
                            className="mt-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-slate-900"
                          >
                            + Create First Price Update
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );

      case "inventoryHealth":
        return (
          <div
            key="inventoryHealth"
            className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Catalog Sync & System Status</h2>
                <p className="text-xs text-slate-600 dark:text-zinc-300">
                  Inventory alignment and active product distribution
                </p>
              </div>
              <Link
                href="/inventory"
                className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Manage Inventory →
              </Link>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <div>
                <div className="mb-1.5 flex justify-between text-xs font-semibold">
                  <span className="text-slate-700 dark:text-zinc-300">
                    Active Catalog Ratio: {activeRatio}%
                  </span>
                  <span className="text-slate-600 dark:text-zinc-300">
                    {activeProducts.toLocaleString()} active / {totalProducts.toLocaleString()} total
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${activeRatio}%`,
                      background: "var(--accent-primary, #4f46e5)",
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600 dark:border-zinc-800 dark:text-zinc-300">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span>
                    Last POS Import:{" "}
                    <strong className="text-slate-700 dark:text-zinc-300">
                      {lastImported
                        ? new Date(lastImported).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : "Never"}
                    </strong>
                  </span>
                </div>
                <div>
                  <span>Database: </span>
                  <strong className="text-slate-700 dark:text-zinc-300">PostgreSQL</strong>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Dashboard Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            Operations Dashboard
          </h1>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-zinc-300">
            Real-time pricing workspace, catalog status, and workflow shortcuts.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/settings"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            Customize Layout
          </Link>
          <Link
            href="/sessions/new"
            className="rounded-lg px-4 py-2 text-xs font-bold text-white shadow-xs hover:opacity-95"
            style={{ background: "var(--accent-primary, #4f46e5)" }}
          >
            + New Price Update
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {error}
        </div>
      )}

      {/* Render customizable sections in user-defined order */}
      <div className="flex flex-col gap-6">
        {dashboard.sections.map((sectionId) => renderSection(sectionId))}
      </div>
    </div>
  );
}
