"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function SessionsPage() {
  const [rows, setRows] = useState<{ id: string; vendor: string; name: string; status: string; updatedAt: string }[]>([]);
  useEffect(() => {
    fetch("/api/sessions").then((r) => r.json()).then((d) => setRows(d.rows ?? [])).catch(() => {});
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Price Update History</h1>
        <Link href="/sessions/new" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">+ New Price Update</Link>
      </div>
      <div className="rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500"><th className="px-4 py-2">Vendor</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Updated</th><th className="px-4 py-2"></th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="px-4 py-2">{s.vendor}</td>
                <td className="px-4 py-2">{s.name}</td>
                <td className="px-4 py-2">{s.status}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{new Date(s.updatedAt).toLocaleString()}</td>
                <td className="px-4 py-2 text-right"><Link className="text-blue-600 underline" href={`/sessions/${s.id}`}>Open</Link></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">No sessions yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
