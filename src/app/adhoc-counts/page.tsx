"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatAdHocDisplayDate, type AdHocCountSheetSummary, type AdHocSheetStatus } from "@/lib/adhocCount";
import { LoadingButton } from "@/components/LoadingButton";

export default function AdHocCountsListPage() {
  const router = useRouter();
  const [sheets, setSheets] = useState<AdHocCountSheetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AdHocSheetStatus>("all");
  const [error, setError] = useState("");

  // Rename modal state
  const [renameSheetId, setRenameSheetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  // Delete modal state
  const [deleteSheetId, setDeleteSheetId] = useState<string | null>(null);
  const [deleteSheetName, setDeleteSheetName] = useState("");
  const [deleting, setDeleting] = useState(false);

  const loadSheets = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(`/api/adhoc-counts?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load sheets");
      setSheets(data.sheets || []);
    } catch (err: any) {
      setError(err.message || "Could not fetch count sheets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSheets();
  }, [statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadSheets();
  };

  const handleCreateNew = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/adhoc-counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create count sheet.");
      router.push(`/adhoc-counts/${data.sheet.id}`);
    } catch (err: any) {
      setError(err.message || "Could not create new count sheet.");
      setCreating(false);
    }
  };

  const handleRenameConfirm = async () => {
    if (!renameSheetId || !renameValue.trim()) return;
    setRenaming(true);
    try {
      const res = await fetch(`/api/adhoc-counts/${renameSheetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to rename count sheet.");
      setRenameSheetId(null);
      loadSheets();
    } catch (err: any) {
      setError(err.message || "Could not rename count sheet.");
    } finally {
      setRenaming(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteSheetId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/adhoc-counts/${deleteSheetId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete count sheet.");
      setDeleteSheetId(null);
      loadSheets();
    } catch (err: any) {
      setError(err.message || "Could not delete count sheet.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Ad Hoc Inventory Count Sheets
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
            Create fast inventory count sheets for missed products or discrepancy investigations across multiple vendors.
          </p>
        </div>

        <LoadingButton
          type="button"
          busy={creating}
          onClick={handleCreateNew}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Create New Count Sheet
        </LoadingButton>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-zinc-800 dark:bg-zinc-900 sm:flex-row sm:items-center sm:justify-between">
        <form onSubmit={handleSearchSubmit} className="relative flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sheets by name..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-4 pl-9 text-xs text-slate-900 transition-colors focus:border-indigo-600 focus:bg-white focus:outline-hidden dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <svg
            className="absolute top-2.5 left-3 h-4 w-4 text-slate-400 dark:text-zinc-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </form>

        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          {(["all", "In Progress", "Completed"] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                statusFilter === st
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              {st === "all" ? "All Status" : st}
            </button>
          ))}
        </div>
      </div>

      {/* Sheets Table / History */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-3 text-xs font-bold text-slate-700 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300">
          Count Sheet History ({sheets.length})
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center text-xs text-slate-500 dark:text-zinc-400">
            Loading count sheets...
          </div>
        ) : sheets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-slate-100 p-3 text-slate-400 dark:bg-zinc-800 dark:text-zinc-500">
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">No count sheets found</h3>
            <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-zinc-400">
              {search || statusFilter !== "all"
                ? "Try clearing your filters or search terms."
                : "Get started by creating your first ad hoc count sheet."}
            </p>
            <button
              type="button"
              onClick={handleCreateNew}
              className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 dark:bg-indigo-500"
            >
              + Create New Sheet
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:border-zinc-800 dark:bg-zinc-800/80 dark:text-zinc-400">
                <tr>
                  <th className="px-5 py-3">Sheet Name</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Products</th>
                  <th className="px-5 py-3">Created</th>
                  <th className="px-5 py-3">Last Updated</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                {sheets.map((sheet) => (
                  <tr key={sheet.id} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-zinc-800/40">
                    <td className="px-5 py-3 font-semibold text-slate-900 dark:text-white">
                      <Link
                        href={`/adhoc-counts/${sheet.id}`}
                        className="hover:text-indigo-600 hover:underline dark:hover:text-indigo-400"
                      >
                        {sheet.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          sheet.status === "Completed"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300"
                            : "bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300"
                        }`}
                      >
                        {sheet.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600 dark:text-zinc-400 font-mono">
                      {sheet.itemCount} item{sheet.itemCount === 1 ? "" : "s"}
                    </td>
                    <td className="px-5 py-3 text-slate-500 dark:text-zinc-400">
                      {formatAdHocDisplayDate(sheet.createdAt)}
                    </td>
                    <td className="px-5 py-3 text-slate-500 dark:text-zinc-400">
                      {formatAdHocDisplayDate(sheet.updatedAt)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/adhoc-counts/${sheet.id}`}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-600 shadow-2xs hover:bg-indigo-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-indigo-400 dark:hover:bg-zinc-700"
                        >
                          Open
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            setRenameSheetId(sheet.id);
                            setRenameValue(sheet.name);
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-2xs hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteSheetId(sheet.id);
                            setDeleteSheetName(sheet.name);
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 shadow-2xs hover:bg-red-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-red-400 dark:hover:bg-red-950/30"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Rename Dialog */}
      {renameSheetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Rename Count Sheet</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              Enter a new title for this inventory count sheet.
            </p>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="mt-4 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-900 focus:border-indigo-600 focus:bg-white focus:outline-hidden dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameSheetId(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                Cancel
              </button>
              <LoadingButton
                type="button"
                busy={renaming}
                onClick={handleRenameConfirm}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 dark:bg-indigo-500"
              >
                Save
              </LoadingButton>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteSheetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Delete Count Sheet</h3>
            <p className="mt-2 text-xs text-slate-600 dark:text-zinc-300">
              Are you sure you want to delete <span className="font-semibold text-slate-900 dark:text-white">"{deleteSheetName}"</span>?
            </p>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">
              This will delete only this count sheet and its row counts. All Inventory products will remain completely untouched.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteSheetId(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                Cancel
              </button>
              <LoadingButton
                type="button"
                busy={deleting}
                onClick={handleDeleteConfirm}
                className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 dark:bg-red-500"
              >
                Delete Sheet
              </LoadingButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
