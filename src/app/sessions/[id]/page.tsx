"use client";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { PriceGrid, type Item } from "@/components/PriceGrid";
import { apiErrorText } from "@/lib/apiError";
import { LoadingButton } from "@/components/LoadingButton";
import { useToast } from "@/components/Toast";

export default function SessionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [msg, setMsg] = useState("");
  const [page, setPage] = useState(1);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState<string | null>(null);
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const pageSize = 200;

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/sessions/${id}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(apiErrorText(d, "Could not load this price update.")); setItems([]); return; }
      setMsg("");
      setItems(d.items ?? []); setName(d.session?.name ?? "");
    } catch {
      setMsg("Could not reach the server. Check your connection and try again.");
    }
  }, [id]);

  // Initial load; setState happens in the fetch callbacks only.
  useEffect(() => {
    let active = true;
    fetch(`/api/sessions/${id}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!active) return;
        if (!r.ok) { setMsg(apiErrorText(d, "Could not load this price update.")); setItems([]); return; }
        setMsg(""); setItems(d.items ?? []); setName(d.session?.name ?? "");
      })
      .catch(() => { if (active) setMsg("Could not reach the server. Check your connection and try again."); });
    return () => { active = false; };
  }, [id]);
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
    if (savingCell) return;
    setSavingCell(`${item.id}:${key}`);
    try {
      const r = await fetch(`/api/sessions/${id}/items`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, [key]: value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, "Could not save that cell.");
        setMsg(t); toast.error("Could not save that cell.", t); return;
      }
      setMsg("");
      await load();
      toast.success("Row saved.");
    } catch {
      toast.error("Could not save that cell.", "Could not reach the server while saving that cell.");
    } finally {
      setSavingCell(null);
    }
  };
  const removeRow = async (row: { id: string }) => {
    if (savingCell) return;
    setSavingCell(row.id);
    try {
      const r = await fetch(`/api/sessions/${id}/items?itemId=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, "Could not delete that row.");
        setMsg(t); toast.error("Could not delete that row.", t); return;
      }
      setMsg("");
      await load();
      toast.success("Row deleted.");
    } catch {
      toast.error("Could not delete that row.", "Could not reach the server while deleting that row.");
    } finally {
      setSavingCell(null);
    }
  };

  /** Fetch an export, save it to disk, and report success/failure. */
  const download = async (kind: "pos" | "storecount") => {
    if (exportBusy) return;
    setExportBusy(kind);
    try {
      const r = await fetch(`/api/sessions/${id}/export?kind=${kind}`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        const t = apiErrorText(d, "export failed.");
        setMsg(t); toast.error("Export failed.", t); return;
      }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = kind === "pos" ? `pos-export-${id}.csv` : `storecount-${id}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(kind === "pos" ? "POS CSV downloaded." : "Store Count CSV downloaded.");
    } catch {
      toast.error("Export failed.", "Could not reach the server while exporting.");
    } finally {
      setExportBusy(null);
    }
  };

  const pdf = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    setMsg("Generating PDF...");
    try {
      const r = await fetch(`/api/sessions/${id}/storecount`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        const t = apiErrorText(d, "PDF generation failed.");
        setMsg(t); toast.error("Store Count PDF failed.", t); return;
      }
      const blob = await r.blob();
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `storecount-${id}.pdf`; a.click();
      URL.revokeObjectURL(a.href);
      setMsg("PDF downloaded (inactive excluded).");
      toast.success("Store Count PDF downloaded.", "Inactive products are excluded.");
    } catch {
      setMsg("Could not reach the server while generating the PDF.");
      toast.error("Store Count PDF failed.", "Could not reach the server while generating the PDF.");
    } finally {
      setPdfBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{name || "Price Update"}</h1>
        <div className="flex flex-wrap gap-2 text-sm">
          <LoadingButton busy={exportBusy === "pos"} busyLabel="Preparing CSV..." onClick={() => download("pos")} className="rounded border bg-white px-3 py-1.5 text-slate-900 disabled:opacity-60">
            Export for POS
          </LoadingButton>
          <LoadingButton busy={exportBusy === "storecount"} busyLabel="Preparing CSV..." onClick={() => download("storecount")} className="rounded border bg-white px-3 py-1.5 text-slate-900 disabled:opacity-60">
            Store Count CSV
          </LoadingButton>
          <LoadingButton busy={pdfBusy} busyLabel="Generating PDF..." onClick={pdf} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-60">
            Generate Store Count PDF
          </LoadingButton>
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
      <PriceGrid rows={filtered} page={page} pageSize={pageSize} onEdit={editCell} onDelete={removeRow} />
      <div className="flex items-center gap-2 text-sm">
        <button disabled={page <= 1} className="rounded border px-3 py-1 disabled:opacity-40" onClick={() => setPage(page - 1)}>Prev</button>
        <span>Page {page} ({filtered.length} rows)</span>
        <button className="rounded border px-3 py-1" onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
