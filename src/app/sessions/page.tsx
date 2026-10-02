"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorText } from "@/lib/apiError";
import { LoadingButton } from "@/components/LoadingButton";
import { useToast } from "@/components/Toast";

type SessionRow = {
  id: string;
  vendor: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export default function SessionsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [q, setQ] = useState("");
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Price Update History</h1>
        <Link href="/sessions/new" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">+ New Price Update</Link>
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
                <td className="px-4 py-2">{s.name}</td>
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
