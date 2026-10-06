"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COLS, PriceGrid, type Item } from "@/components/PriceGrid";
import { AddItemDialog, type NewItemInput } from "@/components/AddItemDialog";
import { MarkdownDoc, MarkdownEditor, NotesModal } from "@/components/MarkdownEditor";
import { applyPinnedOrder } from "@/lib/markdown";
import type { SortDir, SortableItemKey } from "@/lib/itemSort";
import { parseSortParam, sortItems } from "@/lib/itemSort";
import { apiErrorText } from "@/lib/apiError";
import { LoadingButton } from "@/components/LoadingButton";
import { useToast } from "@/components/Toast";
import {
  canRedo, canUndo, EMPTY_HISTORY, pushHistory, redoLabel, takeRedo, takeUndo, undoLabel,
  type HistoryState,
} from "@/lib/tableUi";

/**
 * Field set that re-creates an exact copy of a row through the existing
 * Add Row endpoint — used when undoing a row deletion. Derived fields (product
 * details, pricing, flags) are recalculated by the server exactly like on
 * import, so the restored row matches the original data.
 */
function restorePayload(row: Item): Record<string, unknown> {
  return {
    rawVendorSku: row.rawVendorSku,
    // A manually-set Cleaned SKU goes back through the manual path; a derived
    // one is recomputed from the raw vendor SKU, just like on import.
    cleanedSku: row.cleanedOverridden || !row.rawVendorSku ? row.cleanedSku : "",
    discount: row.discount ?? "",
    vendorListPriceNew: row.vendorListPriceNew ?? "",
    marginDivisor: row.marginDivisor ?? "",
    notes: row.notes ?? "",
    nearest9: row.nearest9Custom ?? "",
  };
}

/** Numeric value of a price string, or null when missing/non-numeric. */
function toNum(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/[$,%\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** True when the row already has a custom (manual) Nearest 9 override. */
function isCustomRow(r: Item): boolean {
  return !!r.nearest9Custom && String(r.nearest9Custom).trim() !== "";
}

/**
 * Rows eligible for "Set Lower Prices to Old Retail": matched rows with an
 * automatically calculated Nearest 9 that is lower than Old Retail Price.
 * Callers pass only the user-selected rows, so only checked rows can change.
 */
function lowerCandidates(rows: Item[]): Item[] {
  return rows.filter((r) => {
    if (!r.matched) return false;
    if (isCustomRow(r)) return false;
    const n9 = toNum(r.nearest9);
    const old = toNum(r.oldRetailPrice);
    if (n9 === null || old === null) return false;
    return n9 < old;
  });
}

export default function SessionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [sheetNotes, setSheetNotes] = useState("");
  const [sheetNotesBusy, setSheetNotesBusy] = useState(false);
  const [sheetNotesEditing, setSheetNotesEditing] = useState(false);
  const [sheetNotesDraft, setSheetNotesDraft] = useState("");
  const [noteRow, setNoteRow] = useState<Item | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  /**
   * Pinned visual row order ("stay where you are" after a save).
   * Set by fill-down / notes saves from the pre-save displayed order; applied
   * to freshly loaded rows so the user's working set never rearranges. Never
   * changes sorting itself — cleared on any explicit sort/filter/search change
   * or row add/delete, when re-sorting is the correct behaviour.
   */
  const [pinnedOrder, setPinnedOrder] = useState<string[] | null>(null);
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
  const [confirmLower, setConfirmLower] = useState(false);
  const [lowerBusy, setLowerBusy] = useState(false);
  const [sortKey, setSortKey] = useState<SortableItemKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir | null>(null);
  const [fillBusy, setFillBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  // Undo/Redo of table actions (cell edits, fills, add/delete rows). The ref is
  // the synchronous source of truth; state only drives the buttons/shortcuts.
  // History is tagged with the price update it belongs to, so switching price
  // updates simply reads as "nothing to undo" — no reset effect needed.
  const historyBoxRef = useRef<{ sid: string; state: HistoryState }>({ sid: id, state: EMPTY_HISTORY });
  const [historyBox, setHistoryBox] = useState<{ sid: string; state: HistoryState }>({ sid: id, state: EMPTY_HISTORY });
  const histBusyRef = useRef(false);
  const [histBusy, setHistBusy] = useState(false);
  const pageSize = 200;
  const history: HistoryState = historyBox.sid === id ? historyBox.state : EMPTY_HISTORY;

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/sessions/${id}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(apiErrorText(d, "Could not load this price update.")); setItems([]); return; }
      setMsg("");
      let next: Item[] = d.items ?? [];
      // A save-triggered pin ("stay where you are") wins over re-sorting: keep
      // the pre-save visual order with fresh values merged in.
      setPinnedOrder((pin) => {
        if (pin && pin.length) next = applyPinnedOrder(next, pin);
        return pin;
      });
      setItems(next); setName(d.session?.name ?? ""); setSheetNotes(String(d.session?.notes ?? ""));
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
        setMsg(""); setItems(d.items ?? []); setName(d.session?.name ?? ""); setSheetNotes(String(d.session?.notes ?? ""));
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
    if (filter === "custom") rows = rows.filter((r) => !!r.nearest9Custom && String(r.nearest9Custom).trim() !== "");
    // Excel-style sort over the FULL filtered set (not just the visible page),
    // using actual table values via the shared comparator. A save-triggered
    // pin ("stay where you are", e.g. after a fill-down) keeps the pre-save
    // visual order instead — it never changes the sort itself.
    const sorted = sortItems(rows, sortKey, sortDir);
    return pinnedOrder && pinnedOrder.length ? applyPinnedOrder(sorted, pinnedOrder) : sorted;
  }, [items, q, filter, sortKey, sortDir, pinnedOrder]);
  const lowerCount = useMemo(
    () => lowerCandidates(items.filter((r) => selected.has(r.id))).length,
    [items, selected],
  );
  const visibleIds = useMemo(() => filtered.map((r) => r.id), [filtered]);

  const changeSort = useCallback((key: SortableItemKey, dir: SortDir | null) => {
    if (!parseSortParam(key, dir ?? "asc") && dir !== null) return;
    if (dir === null) {
      setSortKey(null); setSortDir(null);
    } else {
      setSortKey(key); setSortDir(dir);
    }
    setPinnedOrder(null); // explicit re-sort replaces any save pin
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
  /** Current history, but only when it belongs to this price update. */
  const readHistory = useCallback(
    (): HistoryState => (historyBoxRef.current.sid === id ? historyBoxRef.current.state : EMPTY_HISTORY),
    [id],
  );

  const commitHistory = useCallback((next: HistoryState) => {
    const box = { sid: id, state: next };
    historyBoxRef.current = box;
    setHistoryBox(box);
  }, [id]);

  /** Remember how to reverse (and re-apply) one completed table action. */
  const recordHistory = useCallback((label: string, undo: () => Promise<void>, redo: () => Promise<void>) => {
    commitHistory(pushHistory(readHistory(), { label, undo, redo }));
  }, [commitHistory, readHistory]);

  /** PATCH cells through the existing endpoint (single cell or bulk). */
  const patchCells = useCallback(async (cells: Record<string, unknown>[]) => {
    if (!cells.length) return;
    const r = await fetch(`/api/sessions/${id}/items`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cells.length === 1 ? cells[0] : { items: cells }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(apiErrorText(d, "Could not save that cell."));
  }, [id]);

  /** Re-create one row through the existing Add Row endpoint; returns its id. */
  const postRow = useCallback(async (payload: Record<string, unknown>) => {
    const r = await fetch(`/api/sessions/${id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(apiErrorText(d, "Could not restore that row."));
    return ((d as { item?: { id?: string } }).item?.id) ?? "";
  }, [id]);

  /** Delete rows by id through the existing bulk DELETE endpoint. */
  const deleteByIds = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const r = await fetch(`/api/sessions/${id}/items`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds: ids }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(apiErrorText(d, "Could not delete that row."));
  }, [id]);

  /** Re-create deleted rows (used by Undo), returning their new ids. */
  const restoreRows = async (rows: Item[]) => {
    const ids: string[] = [];
    for (const row of rows) {
      const newId = await postRow(restorePayload(row));
      if (newId) ids.push(newId);
    }
    return ids;
  };

  /** Run the next Undo or Redo entry; every entry re-reads the server state. */
  const runHistory = useCallback(async (dir: "undo" | "redo") => {
    if (histBusyRef.current) return;
    const taken = dir === "undo" ? takeUndo(readHistory()) : takeRedo(readHistory());
    if (!taken) return;
    commitHistory(taken.state);
    histBusyRef.current = true;
    setHistBusy(true);
    try {
      await taken.entry[dir]();
      toast.success(dir === "undo" ? `Undid: ${taken.entry.label}` : `Redid: ${taken.entry.label}`);
    } catch (e) {
      const t = e instanceof Error ? e.message : "";
      setMsg(t);
      toast.error(dir === "undo" ? "Undo failed." : "Redo failed.", t || "Could not reach the server.");
    } finally {
      histBusyRef.current = false;
      setHistBusy(false);
    }
  }, [toast, readHistory, commitHistory]);

  // Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z or Ctrl+Y to redo — never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (!e.metaKey && !e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        if (!canUndo(readHistory())) return;
        e.preventDefault();
        void runHistory("undo");
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        if (!canRedo(readHistory())) return;
        e.preventDefault();
        void runHistory("redo");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runHistory, readHistory]);

  const editCell = async (item: Item, key: string, value: string) => {
    if (savingCell) return;
    const before = (((item as unknown as Record<string, string | null>)[key] ?? "") as string);
    setSavingCell(`${item.id}:${key}`);
    // Notes saves must not rearrange the working set either.
    if (key === "notes") setPinnedOrder(visibleIds);
    try {
      const r = await fetch(`/api/sessions/${id}/items`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, [key]: value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, "Could not save that cell.");
        setMsg(t); toast.error("Could not save that cell.", t); return;
      }
      setMsg("");
      if (before !== value) {
        const label = COLS.find((c) => c.key === key)?.label ?? key;
        recordHistory(
          `Edit ${label}`,
          async () => { await patchCells([{ id: item.id, [key]: before }]); await load(); },
          async () => { await patchCells([{ id: item.id, [key]: value }]); await load(); },
        );
      }
      await load();
      toast.success("Row saved.");
    } catch {
      toast.error("Could not save that cell.", "Could not reach the server while saving that cell.");
    } finally {
      setSavingCell(null);
    }
  };

  /**
   * Save a product note from the Markdown popup. Reuses the exact same
   * `editCell("notes")` PATCH + history path as the old inline editor, so
   * storage, recalc, flags, filters, CSV export and the Store Count PDF are
   * unchanged. The order pin keeps the working set in place (never resets
   * sort/filter/page/selection), and the modal closes on success.
   */
  const saveNoteRow = async (value: string) => {
    if (!noteRow || noteBusy) return;
    const before = noteRow.notes ?? "";
    if (value === before) { setNoteRow(null); return; }
    setNoteBusy(true);
    setPinnedOrder(visibleIds);
    try {
      await patchCells([{ id: noteRow.id, notes: value }]);
      setMsg("");
      recordHistory(
        "Edit Notes",
        async () => { await patchCells([{ id: noteRow.id, notes: before }]); await load(); },
        async () => { await patchCells([{ id: noteRow.id, notes: value }]); await load(); },
      );
      setNoteRow(null);
      await load();
      toast.success("Note saved.");
    } catch {
      toast.error("Could not save that note.", "Could not reach the server while saving that note.");
    } finally {
      setNoteBusy(false);
    }
  };

  /**
   * Save the Price Sheet Notes (whole-update notes). Uses the existing session
   * PATCH `notes` field — the same storage that already backs the session on
   * both the Prisma and file-store backends — so no migration or new table.
   * Updates local state only: the items table is never reloaded, so sort,
   * filter, page, and selection cannot move.
   */
  const saveSheetNotes = async () => {
    if (sheetNotesBusy) return;
    setSheetNotesBusy(true);
    try {
      const r = await fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: sheetNotesDraft }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, "Could not save the price sheet notes.");
        setMsg(t); toast.error("Could not save the price sheet notes.", t); return;
      }
      setSheetNotes(sheetNotesDraft);
      setSheetNotesEditing(false);
      setMsg("");
      toast.success("Price sheet notes saved.");
    } catch {
      toast.error("Could not save the price sheet notes.", "Could not reach the server while saving.");
    } finally {
      setSheetNotesBusy(false);
    }
  };

  /**
   * Bulk action: set Old Retail Price as the custom Nearest 9 override, but
   * ONLY for checked rows that qualify (automatic Nearest 9 lower than Old
   * Retail). Selected rows that do not meet the condition are left untouched:
   * no custom override, no flag change. Uses the exact same `nearest9` PATCH
   * path as a manual cell edit, so the server stores a real custom override
   * and the Custom badge/flag/filter behave identically to a manually typed
   * value. Checkbox selection is preserved.
   */
  const applyLowerToOld = async () => {
    const targets = lowerCandidates(items.filter((r) => selected.has(r.id)));
    if (lowerBusy || !targets.length) return;
    setLowerBusy(true);
    try {
      // Remember prior custom values (all blank here) so Undo restores them.
      const prev = new Map(targets.map((t) => [t.id, t.nearest9Custom ?? null]));
      const applyPayload = targets.map((t) => ({ id: t.id, nearest9: t.oldRetailPrice ?? "" }));
      const undoPayload = targets.map((t) => ({ id: t.id, nearest9: prev.get(t.id) ?? "" }));
      // Chunked: the bulk PATCH endpoint accepts at most 1000 rows per request.
      const applyChunked = async (payload: { id: string; nearest9: string }[]) => {
        for (let i = 0; i < payload.length; i += 500) {
          await patchCells(payload.slice(i, i + 500));
        }
      };
      try {
        await applyChunked(applyPayload);
      } catch {
        const t = "Could not apply the bulk change.";
        setMsg(t); toast.error("Could not apply the bulk change.", t); return;
      }
      const count = targets.length;
      recordHistory(
        `Set Lower Prices to Old Retail (${count})`,
        async () => {
          await applyChunked(undoPayload);
          await load();
        },
        async () => {
          await applyChunked(applyPayload);
          await load();
        },
      );
      setConfirmLower(false);
      await load();
      setMsg(`Set Old Retail Price as custom Nearest 9 for ${count} selected product${count === 1 ? "" : "s"}.`);
      toast.success(`Updated ${count} product${count === 1 ? "" : "s"}.`, "Old Retail Price saved as custom Nearest 9 for the qualifying selected rows.");
    } catch {
      toast.error("Could not apply the bulk change.", "Could not reach the server while applying the bulk change.");
    } finally {
      setLowerBusy(false);
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
    const beforeCells = targets
      .map((tid) => items.find((x) => x.id === tid))
      .filter((x): x is Item => x !== undefined)
      .map((x) => ({ id: x.id, value: (((x as unknown as Record<string, string | null>)[key] ?? "") as string) }));
    // Snapshot the CURRENT visual order before saving, so the refresh keeps
    // the user's working set in exactly the same positions. Sort/filter/page
    // state is left untouched.
    setPinnedOrder(visibleIds);
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
      const label = COLS.find((c) => c.key === key)?.label ?? key;
      recordHistory(
        `Fill ${label} down`,
        async () => { await patchCells(beforeCells.map((b) => ({ id: b.id, [key]: b.value }))); await load(); },
        async () => { await patchCells(targets.map((tid) => ({ id: tid, [key]: value }))); await load(); },
      );
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
      setPinnedOrder(null); // membership changed: re-sort normally
      const newId = (d as { item?: { id?: string } })?.item?.id;
      if (newId) {
        const payload = { ...v };
        const holder = { id: newId };
        recordHistory(
          "Add row",
          async () => { await deleteByIds([holder.id]); holder.id = ""; await load(); },
          async () => { holder.id = await postRow(payload); await load(); },
        );
      }
      await load();
      toast.success("Product added.");
    } catch {
      toast.error("Could not add that row.", "Could not reach the server while adding that row.");
    } finally {
      setAddBusy(false);
    }
  };

  const removeRow = async (row: Item) => {
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
      setPinnedOrder(null); // membership changed: re-sort normally
      const holder = { id: row.id };
      recordHistory(
        `Delete ${row.cleanedSku || row.rawVendorSku || "row"}`,
        async () => { holder.id = await postRow(restorePayload(row)); await load(); },
        async () => { await deleteByIds([holder.id]); await load(); },
      );
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
    const snaps = items.filter((x) => selected.has(x.id));
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
      setPinnedOrder(null); // membership changed: re-sort normally
      const holder = { ids: snaps.map((s) => s.id) };
      recordHistory(
        `Delete ${n} row${n === 1 ? "" : "s"}`,
        async () => { holder.ids = await restoreRows(snaps); await load(); },
        async () => { await deleteByIds(holder.ids); await load(); },
      );
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
        <button
          type="button"
          onClick={() => void runHistory("undo")}
          disabled={!canUndo(history) || histBusy}
          title={canUndo(history) ? `Undo ${undoLabel(history)} (Ctrl/Cmd+Z)` : "Nothing to undo"}
          className="rounded border px-3 py-1.5 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ↶ Undo
        </button>
        <button
          type="button"
          onClick={() => void runHistory("redo")}
          disabled={!canRedo(history) || histBusy}
          title={canRedo(history) ? `Redo ${redoLabel(history)} (Ctrl/Cmd+Shift+Z)` : "Nothing to redo"}
          className="rounded border px-3 py-1.5 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ↷ Redo
        </button>
        <input className="min-w-60 flex-1 rounded border px-3 py-1.5" placeholder="Search..." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); setPinnedOrder(null); }} />
        <select className="rounded border px-2 py-1.5" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); setPinnedOrder(null); }}>
          <option value="all">All rows</option>
          <option value="unmatched">Unmatched</option>
          <option value="notfound">Not Found</option>
          <option value="changed">Price Changed</option>
          <option value="inactive">Inactive</option>
          <option value="missing">Vendor price missing</option>
          <option value="custom">Custom</option>
        </select>
        <LoadingButton
          busy={lowerBusy}
          busyLabel="Applying..."
          disabled={selected.size === 0}
          onClick={() => setConfirmLower(true)}
          title={
            selected.size === 0
              ? "Select rows with the checkboxes first"
              : lowerCount === 0
                ? "None of the selected products have a lower Nearest 9 price."
                : `Set Old Retail Price as the Custom Nearest 9 for ${lowerCount} selected product${lowerCount === 1 ? "" : "s"}`
          }
          className="rounded border border-violet-300 bg-violet-50 px-3 py-1.5 font-semibold text-violet-800 disabled:opacity-50"
        >
          {selected.size > 0 && lowerCount > 0
            ? `Set Lower Prices to Old Retail (${lowerCount} of ${selected.size} selected)`
            : selected.size > 0
              ? `Set Lower Prices to Old Retail (${selected.size} selected)`
              : "Set Lower Prices to Old Retail"}
        </LoadingButton>
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
        onOpenNotes={(item) => setNoteRow(item)}
        layoutKey={id}
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
      {confirmLower && selected.size > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Confirm set lower prices to old retail">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-bold">Set Lower Prices to Old Retail?</h2>
            {lowerCount > 0 ? (
              <>
                <p className="mt-2 text-sm text-slate-600">
                  Set Old Retail Price as the Custom Nearest 9 for {lowerCount} selected product{lowerCount === 1 ? "" : "s"}?
                </p>
                {selected.size !== lowerCount && (
                  <p className="mt-2 text-sm text-slate-600">
                    Only the selected rows where the automatic Nearest 9 is lower than Old Retail Price will change. The other {selected.size - lowerCount} selected row{selected.size - lowerCount === 1 ? "" : "s"} will stay unchanged.
                  </p>
                )}
                <p className="mt-2 text-sm text-slate-600">
                  Each changed row keeps a real custom Nearest 9 override (shown with the existing Custom label), and this can be undone with Undo.
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-600">
                None of the selected products have a lower Nearest 9 price.
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded border px-3 py-1.5 text-sm disabled:opacity-60" disabled={lowerBusy} onClick={() => setConfirmLower(false)}>
                Cancel
              </button>
              {lowerCount > 0 && (
                <LoadingButton busy={lowerBusy} busyLabel="Applying..." onClick={applyLowerToOld} className="rounded bg-violet-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
                  Apply
                </LoadingButton>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 text-sm">
        <button disabled={page <= 1} className="rounded border px-3 py-1 disabled:opacity-40" onClick={() => setPage(page - 1)}>Prev</button>
        <span>Page {page} ({filtered.length} rows)</span>
        <button className="rounded border px-3 py-1" onClick={() => setPage(page + 1)}>Next</button>
      </div>
      {noteRow && (
        <NotesModal
          title={`Notes — ${noteRow.productName || noteRow.cleanedSku || noteRow.rawVendorSku || "product"}`}
          subtitle="Markdown supported: bold, italic, headings, lists, links, tables."
          initial={noteRow.notes ?? ""}
          busy={noteBusy}
          saveLabel="Save"
          onSave={(v) => void saveNoteRow(v)}
          onClose={() => { if (!noteBusy) setNoteRow(null); }}
        />
      )}
      <section aria-label="Price Sheet Notes" className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">Price Sheet Notes</h2>
          {!sheetNotesEditing && (
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-sm font-semibold text-slate-700"
              onClick={() => { setSheetNotesDraft(sheetNotes); setSheetNotesEditing(true); }}
            >
              {sheetNotes ? "Edit" : "Add notes"}
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-600">
          General notes for this entire price update (e.g. vendor comparisons). Markdown supported — including tables — with no changes to the table structure.
        </p>
        {sheetNotesEditing ? (
          <div className="mt-3">
            <MarkdownEditor value={sheetNotesDraft} onChange={setSheetNotesDraft} />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border px-3 py-1.5 text-sm disabled:opacity-60"
                disabled={sheetNotesBusy}
                onClick={() => setSheetNotesEditing(false)}
              >
                Cancel
              </button>
              <LoadingButton
                busy={sheetNotesBusy}
                busyLabel="Saving..."
                onClick={saveSheetNotes}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                Save Notes
              </LoadingButton>
            </div>
          </div>
        ) : sheetNotes ? (
          <div className="mt-3 rounded border bg-slate-50 px-3 py-2">
            <MarkdownDoc source={sheetNotes} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-400">No price sheet notes yet. Use “Add notes” to record vendor comparisons or general remarks.</p>
        )}
      </section>
    </div>
  );
}
