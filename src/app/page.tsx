"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Dash = {
  totals: { products: number; inactive: number; active: number; vendors: number; sessions: number };
  recentSessions: { id: string; vendor: string; name: string; status: string; updatedAt: string }[];
};

export default function Home() {
  const [data, setData] = useState<Dash | null>(null);
  useEffect(() => {
    fetch("/api/dashboard").then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {});
  }, []);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Price Update Tool</h1>
          <p className="text-sm text-slate-500">Dashboard — fast server-side price processing</p>
        </div>
        <Link href="/sessions/new" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">+ New Price Update</Link>
      </div>
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
                <td className="px-4 py-2"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{s.status}</span></td>
                <td className="px-4 py-2 text-xs text-slate-500">{new Date(s.updatedAt).toLocaleString()}</td>
                <td className="px-4 py-2 text-right"><Link className="text-blue-600 underline" href={`/sessions/${s.id}`}>Open</Link></td>
              </tr>
            ))}
            {!data?.recentSessions?.length && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">No sessions yet. Create your first price update.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
