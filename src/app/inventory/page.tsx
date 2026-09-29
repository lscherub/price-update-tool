"use client";
import { useEffect, useState } from "react";

export default function InventoryPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<unknown[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState("");

  const load = async () => {
    const r = await fetch(`/api/inventory?q=${encodeURIComponent(q)}&page=${page}&pageSize=100`);
    const d = await r.json();
    setRows(d.rows ?? []); setTotal(d.total ?? 0);
  };
  useEffect(() => { load(); }, [page]);

  const upload = async (mode: "inventory" | "inactive", file: File) => {
    setMsg("Uploading...");
    const fd = new FormData();
    fd.append("file", file); fd.append("mode", mode);
    const r = await fetch("/api/inventory/import", { method: "POST", body: fd });
    const d = await r.json();
    setMsg(r.ok ? `Done: ${JSON.stringify(d)}` : `Error: ${d.error}`);
    load();
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Inventory</h1>
      <div className="flex flex-wrap gap-3 rounded-xl border bg-white p-4">
        <label className="flex flex-col gap-1 text-sm">
          Import POS inventory (Excel/CSV)
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && upload("inventory", e.target.files[0])} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Import inactive SKU list
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && upload("inactive", e.target.files[0])} />
        </label>
        {msg && <div className="w-full text-sm text-slate-600">{msg}</div>}
      </div>
      <div className="flex gap-2">
        <input className="w-full max-w-md rounded border px-3 py-2" placeholder="Search SKU, product #, description, brand..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (setPage(1), load())} />
        <button className="rounded bg-slate-900 px-4 py-2 text-sm text-white" onClick={() => { setPage(1); load(); }}>Search</button>
      </div>
      <div className="text-sm text-slate-500">{total.toLocaleString()} products</div>
      <div className="overflow-auto rounded-xl border bg-white">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-slate-50">
            <tr className="text-left">
              {["Sku", "Product Number", "Description", "Vendor", "Brand", "List Cost", "Price", "Size Desc", "Status"].map((h) => (
                <th key={h} className="px-2 py-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(rows as Record<string, string | boolean>[]).map((r, i) => (
              <tr key={i} className="border-t">
                <td className="px-2 py-1 font-mono">{String(r.sku)}</td>
                <td className="px-2 py-1">{String(r.productNumber)}</td>
                <td className="px-2 py-1">{String(r.description)}</td>
                <td className="px-2 py-1">{String(r.vendor)}</td>
                <td className="px-2 py-1">{String(r.brand)}</td>
                <td className="px-2 py-1 text-right">{String(r.listCost)}</td>
                <td className="px-2 py-1 text-right">{String(r.price)}</td>
                <td className="px-2 py-1">{String(r.sizeDesc)}</td>
                <td className="px-2 py-1">{r.isInactive ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Inactive</span> : <span className="text-slate-400">Active</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button disabled={page <= 1} className="rounded border px-3 py-1 text-sm disabled:opacity-40" onClick={() => setPage(page - 1)}>Prev</button>
        <span className="text-sm">Page {page}</span>
        <button className="rounded border px-3 py-1 text-sm" onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
