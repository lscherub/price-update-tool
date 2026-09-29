"use client";
import { useEffect, useState } from "react";

export default function ExportsPage() {
  const [sessions, setSessions] = useState<{ id: string; name: string; vendor: string }[]>([]);
  useEffect(() => {
    fetch("/api/sessions").then((r) => r.json()).then((d) => setSessions(d.rows ?? [])).catch(() => {});
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Exports</h1>
      <p className="text-sm text-slate-500">POS CSV (Cleaned SKU, Our New List Price, Nearest 9) and Store Count (excludes inactive).</p>
      <div className="rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500"><th className="px-4 py-2">Session</th><th className="px-4 py-2">POS CSV</th><th className="px-4 py-2">Store Count</th></tr></thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="px-4 py-2">{s.vendor} — {s.name}</td>
                <td className="px-4 py-2"><a className="text-blue-600 underline" href={`/api/sessions/${s.id}/export?kind=pos`}>Download POS CSV</a></td>
                <td className="px-4 py-2"><a className="text-blue-600 underline" href={`/api/sessions/${s.id}/export?kind=storecount`}>Download Store Count CSV</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
