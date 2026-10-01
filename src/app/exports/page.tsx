"use client";
import { useEffect, useState } from "react";
import { apiErrorText } from "@/lib/apiError";
import { LoadingButton } from "@/components/LoadingButton";
import { useToast, InlineSpinner } from "@/components/Toast";

export default function ExportsPage() {
  const toast = useToast();
  const [sessions, setSessions] = useState<{ id: string; name: string; vendor: string }[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

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

  const download = async (id: string, kind: "pos" | "storecount", label: string) => {
    if (busy) return;
    setBusy(`${id}:${kind}`);
    try {
      const r = await fetch(`/api/sessions/${id}/export?kind=${kind}`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        toast.error(`${label} failed.`, apiErrorText(d, "export failed."));
        return;
      }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = kind === "pos" ? `pos-export-${id}.csv` : `storecount-${id}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`${label} downloaded.`, label);
    } catch {
      toast.error(`${label} failed.`, "Could not reach the server while exporting.");
    } finally {
      setBusy(null);
    }
  };
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
                  <LoadingButton busy={busy === `${s.id}:storecount`} busyLabel="Preparing..." onClick={() => download(s.id, "storecount", "Store Count CSV")} className="px-0 text-blue-600 underline disabled:opacity-60">
                    Download Store Count CSV
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
