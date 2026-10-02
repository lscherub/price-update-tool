"use client";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { PriceGrid, type Item } from "@/components/PriceGrid";
import { AddItemDialog, type NewItemInput } from "@/components/AddItemDialog";
import type { SortDir, SortableItemKey } from "@/lib/itemSort";
import { parseSortParam, sortItems } from "@/lib/itemSort";
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [sortKey, setSortKey] = useState<SortableItemKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir | null>(null);
  const [fillBusy, setFillBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
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
    if (filter === "notfound") rows = rows.filter((r) => !r.matched);
    if (filter === "changed") rows = rows.filter((r) => r.matched && r.nearest9 && r.oldRetailPrice && r.nearest9 !== r.oldRetailPrice);
    if (filter === "inactive") rows = rows.filter((r) => r.isInactive);
    if (filter === "missing") rows = rows.filter((r) => !r.vendorListPriceNew);
    // Excel-style sort over the FULL filtered set (not just the visible page),
    // using actual table values via the shared comparator.
    return sortItems(rows, sortKey, sortDir);
  }, [items, q, filter, sortKey, sortDir]);
  const visibleIds = useMemo(() => filtered.map((r) => r.id), [filtered]);

  const changeSort = useCallback((key: SortableItemKey, dir: SortDir | null) => {
    if (!parseSortParam(key, dir ?? "asc") && dir !== null) return;
    if (dir === null) {
      setSortKey(null); setSortDir(null);
    } else {
      setSortKey(key); setSortDir(dir);
    }
    setPage(1);
  }, []);

  const toggleOne = useCallback((item: Item) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(() => {
    setSelected((prev) => {
      const visible = new Set(visibleIds);
      const allOn = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      if (allOn) {
        const next = new Set(prev);
        for (const id of visible) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visible) next.add(id);
      return next;
    });
  }, [visibleIds]);
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

  /**
   * Excel-like fill: copy one already-entered editable value down to following
   * rows. Sends ONE bulk PATCH (existing server recalc per row), so all copied
   * values recalculate through the unchanged pricing pipeline.
   */
  const fillDown = async (item: Item, key: string, value: string, afterIds: string[]) => {
    if (fillBusy || savingCell) return;
    const targets = [item.id, ...afterIds.filter((x) => x !== item.id)];
    if (!targets.length) return;
    setFillBusy(true);
    try {
      const r = await fetch(`/api/sessions/${id}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: targets.map((tid) => ({ id: tid, [key]: value })) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, "Could not fill the selected cells.");
        setMsg(t); toast.error("Could not fill the selected cells.", t); return;
      }
      setMsg("");
      await load();
      toast.success(`Copied to ${targets.length} row${targets.length === 1 ? "" : "s"}.`);
    } catch {
      toast.error("Could not fill the selected cells.", "Could not reach the server while saving.");
    } finally {
      setFillBusy(false);
    }
  };
  /**
   * Add a new row to this existing price update. The server reuses the existing
   * SKU cleaning + inventory matching logic (raw vendor SKU or cleaned SKU), so
   * the new row calculates exactly like an imported one.
   */
  const addItem = async (v: NewItemInput) => {
    if (addBusy) return;
    setAddBusy(true);
    try {
      const r = await fetch(`/api/sessions/${id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, "Could not add that row.");
        setMsg(t); toast.error("Could not add that row.", t); return;
      }
      setMsg("");
      setShowAdd(false);
      await load();
      toast.success("Product added.");
    } catch {
      toast.error("Could not add that row.", "Could not reach the server while adding that row.");
    } finally {
      setAddBusy(false);
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
      setSelected((prev) => { const next = new Set(prev); next.delete(row.id); return next; });
      await load();
      toast.success("Row deleted.");
    } catch {
      toast.error("Could not delete that row.", "Could not reach the server while deleting that row.");
    } finally {
      setSavingCell(null);
    }
  };

  const deleteSelection = async () => {
    if (bulkBusy || selected.size === 0) return;
    setBulkBusy(true);
    try {
      const r = await fetch(`/api/sessions/${id}/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: [...selected] }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, "Could not delete the selected rows.");
        setMsg(t); toast.error("Could not delete the selected rows.", t); return;
      }
      const n = selected.size;
      setMsg("");
      setSelected(new Set());
      setConfirmBulk(false);
      await load();
      toast.success(`${n} row${n === 1 ? "" : "s"} deleted.`);
    } catch {
      toast.error("Could not delete the selected rows.", "Could not reach the server while deleting.");
    } finally {
      setBulkBusy(false);
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
      // Preserve the table's current order: send the sorted visible row ids so
      // the PDF lists products in that same order (inclusion rules unchanged).
      const body = sortKey && sortDir ? { ids: filtered.map((r) => r.id), sortKey, sortDir } : {};
      const r = await fetch(`/api/sessions/${id}/storecount`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-800"
        >
          + Add Row
        </button>
        <input className="min-w-60 flex-1 rounded border px-3 py-1.5" placeholder="Search..." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="rounded border px-2 py-1.5" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
          <option value="all">All rows</option>
          <option value="unmatched">Unmatched</option>
          <option value="notfound">Not Found</option>
          <option value="changed">Price Changed</option>
          <option value="inactive">Inactive</option>
          <option value="missing">Vendor price missing</option>
        </select>
        <LoadingButton
          busy={bulkBusy}
          busyLabel="Deleting..."
          disabled={selected.size === 0}
          onClick={() => setConfirmBulk(true)}
          className="rounded border border-red-200 bg-red-50 px-3 py-1.5 font-semibold text-red-700 disabled:opacity-50"
        >
          {selected.size > 0 ? `Delete Selection (${selected.size})` : "Delete Selection"}
        </LoadingButton>
      </div>
      {msg && <div className="text-sm text-slate-600">{msg}</div>}
      {fillBusy && <div className="text-sm text-slate-500">Copying value to selected rows...</div>}
      <PriceGrid
        rows={filtered} page={page} pageSize={pageSize} onEdit={editCell} onDelete={removeRow}
        selected={selected} onToggle={toggleOne} onToggleAll={toggleAllVisible}
        sortKey={sortKey} sortDir={sortDir} onSort={changeSort} onFillDown={fillDown}
      />
      {showAdd && (
        <AddItemDialog busy={addBusy} onClose={() => { if (!addBusy) setShowAdd(false); }} onSubmit={addItem} />
      )}
      {confirmBulk && selected.size > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Confirm delete selection">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-bold">Delete {selected.size} selected row{selected.size === 1 ? "" : "s"}?</h2>
            <p className="mt-2 text-sm text-slate-600">
              This will permanently delete the selected price-update items from this price update only.{" "}
              <span className="font-semibold text-red-700">This cannot be undone.</span>
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Inventory, pricing calculations, flags, and all other data are unchanged — only the selected rows are removed.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded border px-3 py-1.5 text-sm disabled:opacity-60" disabled={bulkBusy} onClick={() => setConfirmBulk(false)}>
                Cancel
              </button>
              <LoadingButton busy={bulkBusy} busyLabel="Deleting..." onClick={deleteSelection} className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
                Delete permanently
              </LoadingButton>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 text-sm">
        <button disabled={page <= 1} className="rounded border px-3 py-1 disabled:opacity-40" onClick={() => setPage(page - 1)}>Prev</button>
        <span>Page {page} ({filtered.length} rows)</span>
        <button className="rounded border px-3 py-1" onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
