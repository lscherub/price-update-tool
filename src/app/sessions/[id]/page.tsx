"use client";
import { use, useEffect, useMemo, useState } from "react";
import { PriceGrid, type Item } from "@/components/PriceGrid";

export default function SessionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [msg, setMsg] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 200;

  const load = async () => {
    const r = await fetch(`/api/sessions/${id}`);
    const d = await r.json();
    setItems(d.items ?? []); setName(d.session?.name ?? "");
  };
  useEffect(() => { load(); }, [id]);
  const filtered = useMemo(() => {
    let rows = items;
    if (q) {
      const s = q.toLowerCase();
      rows = rows.filter((r) => [r.rawVendorSku, r.cleanedSku, r.productNumber, r.productName, r.brand, r.vendor].join(" ").toLowerCase().includes(s));
    }
    if (filter === "unmatched") rows = rows.filter((r) => !r.matched);
    if (filter === "changed") rows = rows.filter((r) => r.matched && r.nearest9 && r.oldRetailPrice && r.nearest9 !== r.oldRetailPrice);
    if (filter === "inactive") rows = rows.filter((r) => r.isInactive);
    if (filter === "missing") rows = rows.filter((r) => !r.vendorListPriceNew);
    return rows;
  }, [items, q, filter]);
  const editCell = async (item: Item, key: string, value: string) => {
    await fetch(`/api/sessions/${id}/items`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, [key]: value }) });
    load();
  };
  const pdf = async () => {
    setMsg("Generating PDF...");
    const r = await fetch(`/api/sessions/${id}/storecount`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) { setMsg("PDF failed"); return; }
    const blob = await r.blob();
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `storecount-${id}.pdf`; a.click();
    setMsg("PDF downloaded (inactive excluded).");
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{name || "Price Update"}</h1>
        <div className="flex flex-wrap gap-2 text-sm">
          <a className="rounded border bg-white px-3 py-1.5" href={`/api/sessions/${id}/export?kind=pos`}>Export for POS</a>
          <a className="rounded border bg-white px-3 py-1.5" href={`/api/sessions/${id}/export?kind=storecount`}>Store Count CSV</a>
          <button className="rounded bg-slate-900 px-3 py-1.5 text-white" onClick={pdf}>Generate Store Count PDF</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <input className="min-w-60 flex-1 rounded border px-3 py-1.5" placeholder="Search..." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="rounded border px-2 py-1.5" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
          <option value="all">All rows</option>
          <option value="unmatched">Unmatched</option>
          <option value="changed">Price Changed</option>
          <option value="inactive">Inactive</option>
          <option value="missing">Vendor price missing</option>
        </select>
      </div>
      {msg && <div className="text-sm text-slate-600">{msg}</div>}
      <PriceGrid rows={filtered} page={page} pageSize={pageSize} onEdit={editCell} onDelete={async (r) => { await fetch(`/api/sessions/${id}/items?itemId=${r.id}`, { method: "DELETE" }); load(); }} />
      <div className="flex items-center gap-2 text-sm">
        <button disabled={page <= 1} className="rounded border px-3 py-1 disabled:opacity-40" onClick={() => setPage(page - 1)}>Prev</button>
        <span>Page {page} ({filtered.length} rows)</span>
        <button className="rounded border px-3 py-1" onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
