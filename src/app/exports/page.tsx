"use client";
import { useEffect, useState } from "react";
import { apiErrorText } from "@/lib/apiError";
import { LoadingButton } from "@/components/LoadingButton";
import { useToast, InlineSpinner } from "@/components/Toast";
import { useUiMode } from "@/contexts/UiModeContext";

export default function ExportsPage() {
  const toast = useToast();
  const { mode } = useUiMode();
  const [sessions, setSessions] = useState<{ id: string; name: string; vendor: string }[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Initial load; setState occurs in the fetch callbacks only.
  useEffect(() => {
    let active = true;
    fetch("/api/sessions")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!active) return;
        if (!r.ok) { setError(apiErrorText(d, "Could not load price updates.")); return; }
        setError(""); setSessions(d.rows ?? []);
      })
      .catch(() => { if (active) setError("Could not reach the server. Check your connection and try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const download = async (id: string, kind: "pos" | "storecount-excel", label: string) => {
    if (busy) return;
    setBusy(`${id}:${kind}`);
    try {
      const isExcel = kind === "storecount-excel";
      const r = isExcel
        ? await fetch(`/api/sessions/${id}/storecount/excel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        : await fetch(`/api/sessions/${id}/export?kind=${kind}`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        toast.error(`${label} failed.`, apiErrorText(d, "export failed."));
        return;
      }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = isExcel ? `storecount-${id}.xlsx` : `pos-export-${id}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`${label} downloaded.`, label);
    } catch {
      toast.error(`${label} failed.`, "Could not reach the server while exporting.");
    } finally {
      setBusy(null);
    }
  };

  // ==========================================
  // CLASSIC UI MODE (Preserved pixel-perfect)
  // ==========================================
  if (mode === "classic") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Exports</h1>
        <p className="text-sm text-slate-500">POS CSV (Cleaned SKU, Our New List Price, Nearest 9) and Store Count (excludes inactive).</p>
        {error && <div className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</div>}
        {loading && <InlineSpinner label="Loading price updates..." />}
        <div className="rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th className="px-4 py-2">Session</th><th className="px-4 py-2">POS CSV</th><th className="px-4 py-2">Store Count</th></tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-4 py-2">{s.vendor} — {s.name}</td>
                  <td className="px-4 py-2">
                    <LoadingButton busy={busy === `${s.id}:pos`} busyLabel="Preparing..." onClick={() => download(s.id, "pos", "POS CSV")} className="px-0 text-blue-600 underline disabled:opacity-60">
                      Download POS CSV
                    </LoadingButton>
                  </td>
                  <td className="px-4 py-2">
                    <LoadingButton busy={busy === `${s.id}:storecount-excel`} busyLabel="Preparing..." onClick={() => download(s.id, "storecount-excel", "Store Count Excel")} className="px-0 text-blue-600 underline disabled:opacity-60">
                      Download Store Count Excel
                    </LoadingButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ==========================================
  // NEW UI MODE (Modern layout)
  // ==========================================
  const filteredSessions = sessions.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.vendor.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
          Data Exports & Downloader
        </h1>
        <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
          Generate POS-compatible pricing files and Excel spreadsheets for store inventory count audits.
        </p>
      </div>

      {/* Format Explanation Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-xs font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-400">
              CSV
            </span>
            <span className="font-bold text-xs text-slate-900 dark:text-white">POS CSV Export</span>
          </div>
          <p className="mt-2 text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
            Exports <strong>Cleaned SKU</strong>, <strong>Our New List Price</strong>, and <strong>Nearest 9 retail</strong> formatted for immediate point-of-sale register price updates.
          </p>
        </div>

        <div className="flex flex-col rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
              XLS
            </span>
            <span className="font-bold text-xs text-slate-900 dark:text-white">Store Count Excel</span>
          </div>
          <p className="mt-2 text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
            Excel workbook with protected calculation formulas and physical store count inventory columns. Inactive products are automatically excluded.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {error}
        </div>
      )}

      {/* Main Export Table */}
      <div className="flex flex-col rounded-xl border border-slate-200/90 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
        {/* Search header */}
        <div className="border-b border-slate-100 p-3.5 dark:border-zinc-800">
          <input
            className="h-8.5 w-full max-w-sm rounded-lg border border-slate-200 bg-slate-50/60 px-3 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            placeholder="Search price worksheets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-300">
                <th className="px-5 py-3">Worksheet Name</th>
                <th className="px-5 py-3">Vendor</th>
                <th className="px-5 py-3 text-center">POS CSV</th>
                <th className="px-5 py-3 text-center">Store Count Excel</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
              {loading && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-slate-600 dark:text-zinc-300">
                    <InlineSpinner label="Loading price updates..." />
                  </td>
                </tr>
              )}

              {!loading && filteredSessions.map((s) => (
                <tr key={s.id} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-zinc-800/50">
                  <td className="px-5 py-3.5 font-semibold text-slate-900 dark:text-white">
                    {s.name}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-zinc-800 dark:text-zinc-200">
                      {s.vendor}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <LoadingButton
                      busy={busy === `${s.id}:pos`}
                      busyLabel="Exporting..."
                      onClick={() => download(s.id, "pos", "POS CSV")}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-slate-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                    >
                      Download POS CSV
                    </LoadingButton>
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <LoadingButton
                      busy={busy === `${s.id}:storecount-excel`}
                      busyLabel="Exporting..."
                      onClick={() => download(s.id, "storecount-excel", "Store Count Excel")}
                      className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-2xs hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
                    >
                      Download Excel
                    </LoadingButton>
                  </td>
                </tr>
              ))}

              {!loading && filteredSessions.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-slate-600 dark:text-zinc-300">
                    No matching price updates found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
