"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorText } from "@/lib/apiError";
import { LoadingButton } from "@/components/LoadingButton";
import { useToast } from "@/components/Toast";
import { useUiMode } from "@/contexts/UiModeContext";

type SessionRow = {
  id: string;
  vendor: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  isFullVendor?: boolean;
};

export default function SessionsPage() {
  const toast = useToast();
  const { mode } = useUiMode();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<SessionRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (term: string) => {
    setLoading(true);
    try {
      const url = term.trim()
        ? `/api/sessions?q=${encodeURIComponent(term.trim())}`
        : "/api/sessions";
      const r = await fetch(url);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(apiErrorText(d, "Could not load price updates."));
        setRows([]);
        return;
      }
      setError("");
      setRows(d.rows ?? []);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void load(q); }, q.trim() ? 250 : 0);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, load]);

  const refresh = useCallback(() => load(q), [load, q]);

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/sessions/${pendingDelete.id}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error("Delete failed.", apiErrorText(d, "Could not delete this price update."));
        return;
      }
      const label = pendingDelete.name || pendingDelete.vendor;
      setPendingDelete(null);
      toast.success("Price update deleted.", `"${label}" and its items were removed. Inventory was not affected.`);
      await refresh();
    } catch {
      toast.error("Delete failed.", "Could not reach the server. Nothing was deleted.");
    } finally {
      setDeleting(false);
    }
  };

  // Filter rows for New UI
  const filteredRows = rows.filter((r) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "fullvendor") return r.isFullVendor;
    return r.status.toLowerCase() === statusFilter.toLowerCase();
  });

  // ==========================================
  // CLASSIC UI MODE (Preserved pixel-perfect)
  // ==========================================
  if (mode === "classic") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">Price Update History</h1>
          <div className="flex flex-wrap gap-2">
            <Link href="/sessions/new" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">+ New Price Update</Link>
            <Link href="/fullvendor/new" className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100">Full Vendor Price Update</Link>
          </div>
        </div>
        <input
          className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
          placeholder="Search by vendor, update name, or date (e.g. AOR, Flora, 2026-10-01)..."
          aria-label="Search price update history"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {error && <div className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</div>}
        {loading && <div className="text-sm text-slate-500">Loading price updates...</div>}
        <div className="rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th className="px-4 py-2">Vendor</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Updated</th><th className="px-4 py-2 text-right">Actions</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-4 py-2">{s.vendor}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span>{s.name}</span>
                      {s.isFullVendor && (
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-semibold text-indigo-800">
                          Full Vendor
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2">{s.status}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{new Date(s.updatedAt).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">
                    <span className="inline-flex items-center gap-3">
                      <Link className="text-blue-600 underline" href={`/sessions/${s.id}`}>Open</Link>
                      <button
                        type="button"
                        className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                        onClick={() => setPendingDelete(s)}
                      >
                        Delete
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && !rows.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    {q.trim() ? `No price updates match "${q.trim()}".` : "No sessions yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pendingDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Confirm delete">
            <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
              <h2 className="text-lg font-bold">Delete this price update?</h2>
              <p className="mt-2 text-sm text-slate-600">
                This will permanently delete <span className="font-semibold text-slate-900">{pendingDelete.name || pendingDelete.vendor}</span> and
                all of its price-update items. <span className="font-semibold text-red-700">This cannot be undone.</span>
              </p>
              <p className="mt-2 text-sm text-slate-600">
                Only this price update and its items will be removed. Products in the main inventory, other price
                updates, vendor discounts, and all other data are left untouched.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded border px-3 py-1.5 text-sm disabled:opacity-60"
                  disabled={deleting}
                  onClick={() => setPendingDelete(null)}
                >
                  Cancel
                </button>
                <LoadingButton
                  busy={deleting}
                  busyLabel="Deleting..."
                  onClick={confirmDelete}
                  className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Delete permanently
                </LoadingButton>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // NEW UI MODE (Modernized layout)
  // ==========================================
  return (
    <div className="flex flex-col gap-5">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              Price Update History
            </h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700 dark:bg-zinc-800 dark:text-zinc-300">
              {rows.length} total
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
            Audit, review, and manage vendor price sheets and digital store count worksheets.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/fullvendor/new"
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50/70 px-3.5 py-2 text-xs font-semibold text-violet-800 shadow-2xs hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-900/40"
          >
            <svg className="w-4 h-4 text-violet-600 dark:text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            Full Vendor Update
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

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-white p-3 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <div className="relative min-w-64 flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          <input
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/60 pl-9 pr-8 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:focus:bg-zinc-900"
            placeholder="Search price updates by vendor, name, or date..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200"
            >
              ×
            </button>
          )}
        </div>

        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {[
            { id: "all", label: "All Statuses" },
            { id: "draft", label: "Draft" },
            { id: "ready", label: "Ready" },
            { id: "being reviewed", label: "Being Reviewed" },
            { id: "reviewed", label: "Reviewed" },
            { id: "fullvendor", label: "Full Vendor Only" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                statusFilter === tab.id
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Table */}
      <div className="flex flex-col rounded-xl border border-slate-200/90 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-300">
                <th className="px-5 py-3">Vendor</th>
                <th className="px-5 py-3">Worksheet Name</th>
                <th className="px-5 py-3">Review Status</th>
                <th className="px-5 py-3">Last Updated</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
              {loading && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-slate-600 dark:text-zinc-300">
                    Loading price updates...
                  </td>
                </tr>
              )}

              {!loading && filteredRows.map((s) => {
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
                    <td className="px-5 py-3.5 font-semibold text-slate-900 dark:text-white">
                      <span className="inline-block rounded-md bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-800 dark:bg-zinc-800 dark:text-zinc-200">
                        {s.vendor}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 dark:text-white">{s.name}</span>
                        {s.isFullVendor && (
                          <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.2 text-[10px] font-bold text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
                            Full Vendor
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusColor}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-600 dark:text-zinc-300">
                      {new Date(s.updatedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="inline-flex items-center gap-2">
                        <Link
                          href={`/sessions/${s.id}`}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-slate-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                        >
                          Open Worksheet
                        </Link>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(s)}
                          className="rounded-lg border border-red-200 bg-red-50/60 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
                          title="Delete price update"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!loading && filteredRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-slate-600 dark:text-zinc-300">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-zinc-800 dark:text-zinc-500">
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </div>
                      <span className="font-semibold">No price updates found</span>
                      <span className="text-slate-400 text-[11px]">
                        {q ? `No results match "${q}"` : "Try clearing or selecting a different status filter."}
                      </span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-2xs p-4" role="dialog" aria-modal="true" aria-label="Confirm delete">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:border dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/80 dark:text-red-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </span>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Delete Price Update?</h2>
                <p className="text-xs text-slate-500 dark:text-zinc-400">
                  {pendingDelete.name || pendingDelete.vendor}
                </p>
              </div>
            </div>

            <p className="mt-4 text-xs text-slate-600 dark:text-zinc-300 leading-relaxed">
              This will permanently delete this price update worksheet and its items. This action cannot be undone. Products in the main inventory and other worksheets remain completely safe.
            </p>

            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <LoadingButton
                busy={deleting}
                busyLabel="Deleting..."
                onClick={confirmDelete}
                className="rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-red-700"
              >
                Delete Permanently
              </LoadingButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
