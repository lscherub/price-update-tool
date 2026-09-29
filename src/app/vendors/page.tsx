"use client";
import { useEffect, useState } from "react";

export default function VendorsPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; vendor: string; defaultDiscount: string }[]>([]);
  const [vendor, setVendor] = useState("");
  const [discount, setDiscount] = useState("");
  const load = async () => {
    const r = await fetch(`/api/vendors?q=${encodeURIComponent(q)}`);
    const d = await r.json();
    setRows(d.rows ?? []);
  };
  useEffect(() => { load(); }, []);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Vendor Discounts</h1>
      <div className="flex gap-2">
        <input className="w-full max-w-md rounded border px-3 py-2" placeholder="Search vendors..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        <button className="rounded bg-slate-900 px-4 py-2 text-sm text-white" onClick={load}>Search</button>
      </div>
      <form
        className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          await fetch("/api/vendors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendor, defaultDiscount: discount || "0" }) });
          setVendor(""); setDiscount(""); load();
        }}
      >
        <label className="flex flex-col text-sm">Vendor<input className="rounded border px-2 py-1" value={vendor} onChange={(e) => setVendor(e.target.value)} required /></label>
        <label className="flex flex-col text-sm">Default Discount<input className="rounded border px-2 py-1" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="10" /></label>
        <button className="rounded bg-slate-900 px-4 py-2 text-sm text-white">Add / Update</button>
      </form>
      <div className="overflow-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-left"><th className="px-4 py-2">Vendor</th><th className="px-4 py-2">Default Discount</th><th className="px-4 py-2"></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-4 py-2">{r.vendor}</td>
                <td className="px-4 py-2">{r.defaultDiscount}</td>
                <td className="px-4 py-2 text-right">
                  <button className="text-xs text-red-600 underline" onClick={async () => { await fetch(`/api/vendors?id=${r.id}`, { method: "DELETE" }); load(); }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
