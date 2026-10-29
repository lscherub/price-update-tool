"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COLS, PriceGrid, type Item } from "@/components/PriceGrid";
import { AddItemDialog, type NewItemInput } from "@/components/AddItemDialog";
import { BulkAddDialog } from "@/components/BulkAddDialog";
import { DigitalStoreCountExportDialog, type DigitalStoreCountExportOptions } from "@/components/DigitalStoreCountExportDialog";
import type { BulkAddInputRow } from "@/lib/bulkAdd";
import { MarkdownDoc, MarkdownEditor, NotesModal } from "@/components/MarkdownEditor";
import { applyPinnedOrder } from "@/lib/markdown";
import type { SortDir, SortableItemKey } from "@/lib/itemSort";
import { getItemFlags, parseSortParam, sortItems } from "@/lib/itemSort";
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
  const [vendor, setVendor] = useState("");
  const [sheetStatus, setSheetStatus] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
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
  const [isFullVendor, setIsFullVendor] = useState(false);
  // ---- Export-for-POS follow-up: optional inventory price sync ----
  type SyncResult = {
    updated: number;
    exportedRows: number;
    skippedUnmatched: string[];
    skippedUnmatchedCount: number;
    skippedAmbiguous: string[];
    skippedAmbiguousCount: number;
    skippedBlankPrice: string[];
    skippedBlankPriceCount: number;
    skippedInvalidPrice: { sku: string; price: string }[];
    skippedInvalidPriceCount: number;
    skippedDuplicate: string[];
    skippedDuplicateCount: number;
    failed: string[];
    failedCount: number;
    lastUpdatedAt: string | null;
  };
  const [askSync, setAskSync] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [savingCell, setSavingCell] = useState<string | null>(null);
  // Synchronous mirror of `savingCell` so async flows (fill-down) can poll the
  // current guard without stale state from their own render closure.
  const savingCellRef = useRef<string | null>(null);
  useEffect(() => { savingCellRef.current = savingCell; }, [savingCell]);
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
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulkAddBusy, setBulkAddBusy] = useState(false);
  const [showFvExportModal, setShowFvExportModal] = useState(false);
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

  const [selectedFlags, setSelectedFlags] = useState<Set<string>>(new Set());
  const [showFlagMenu, setShowFlagMenu] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const flagMenuRef = useRef<HTMLDivElement | null>(null);
  const gridContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showFlagMenu) return;
    const clickOutside = (e: MouseEvent) => {
      if (flagMenuRef.current && !flagMenuRef.current.contains(e.target as Node)) {
        setShowFlagMenu(false);
      }
    };
    window.addEventListener("mousedown", clickOutside);
    return () => window.removeEventListener("mousedown", clickOutside);
  }, [showFlagMenu]);

  const availableFlags = useMemo(() => {
    const present = new Set<string>();
    for (const it of items) {
      for (const f of getItemFlags(it)) present.add(f);
    }
    const order = ["Not Found", "Inactive", "Manual SKU", "Custom", "Changed", "No change"];
    return order.filter((f) => present.has(f));
  }, [items]);

  const flagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) {
      for (const f of getItemFlags(it)) {
        counts.set(f, (counts.get(f) ?? 0) + 1);
      }
    }
    return counts;
  }, [items]);

  const toggleFlagFilter = useCallback((flag: string) => {
    setSelectedFlags((prev) => {
      const next = new Set(prev);
      if (next.has(flag)) next.delete(flag);
      else next.add(flag);
      return next;
    });
    setPage(1);
    setPinnedOrder(null);
  }, []);

  const clearFlagFilter = useCallback(() => {
    setSelectedFlags(new Set());
    setPage(1);
    setPinnedOrder(null);
  }, []);

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
      setItems(next); setName(d.session?.name ?? ""); setVendor(d.session?.vendor ?? ""); setSheetNotes(String(d.session?.notes ?? "")); setSheetStatus(String(d.session?.status ?? ""));
      setIsFullVendor(!!d.session?.isFullVendor);
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
        setMsg(""); setItems(d.items ?? []); setName(d.session?.name ?? ""); setVendor(d.session?.vendor ?? ""); setSheetNotes(String(d.session?.notes ?? "")); setSheetStatus(String(d.session?.status ?? ""));
        setIsFullVendor(!!d.session?.isFullVendor);
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
    if (selectedFlags.size > 0) {
      rows = rows.filter((r) => {
        const flags = getItemFlags(r);
        return flags.some((f) => selectedFlags.has(f));
      });
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
  }, [items, q, selectedFlags, filter, sortKey, sortDir, pinnedOrder]);

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const visibleIds = useMemo(() => filtered.map((r) => r.id), [filtered]);

  // Auto-adjust to valid page when row count changes after filtering/deleting
  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const goToPage = useCallback((nextPage: number) => {
    const clamped = Math.max(1, Math.min(nextPage, totalPages));
    setPage(clamped);
    gridContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [totalPages]);

  const lowerCount = useMemo(
    () => lowerCandidates(items.filter((r) => selected.has(r.id))).length,
    [items, selected],
  );

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

  const sliceIds = useMemo(() => {
    return filtered.slice((page - 1) * pageSize, page * pageSize).map((r) => r.id);
  }, [filtered, page, pageSize]);

  // Maintain row selections across pages: toggling page visible operates on the current page slice
  const togglePageVisible = useCallback(() => {
    setSelected((prev) => {
      const sliceSet = new Set(sliceIds);
      const allOn = sliceIds.length > 0 && sliceIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allOn) {
        for (const id of sliceSet) next.delete(id);
      } else {
        for (const id of sliceSet) next.add(id);
      }
      return next;
    });
  }, [sliceIds]);
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

  /** Restore the configured Vendor/Brand default discount (clears a manual override). */
  const restoreDiscount = async (item: Item) => {
    if (savingCell) return;
    const before = item.discount ?? "";
    setSavingCell(`${item.id}:discount`);
    try {
      const r = await fetch(`/api/sessions/${id}/items`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, discount: "" }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, "Could not restore the default discount.");
        setMsg(t); toast.error("Could not restore the default discount.", t); return;
      }
      setMsg("");
      recordHistory(
        "Restore default discount",
        async () => { await patchCells([{ id: item.id, discount: before }]); await load(); },
        async () => { await patchCells([{ id: item.id, discount: "" }]); await load(); },
      );
      await load();
      toast.success("Default discount restored.");
    } catch {
      toast.error("Could not restore the default discount.", "Could not reach the server while saving.");
    } finally {
      setSavingCell(null);
    }
  };

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
    if (fillBusy) return;
    // A cell edit (e.g. the just-typed source value) may still be saving:
    // wait for it instead of silently dropping the fill. The guard is only
    // re-checked briefly so a stuck save can't hang the UI.
    for (let i = 0; i < 40 && savingCellRef.current; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (savingCellRef.current) {
      const t = "Another cell is still saving. Wait a moment and try the fill again.";
      setMsg(t); toast.error("Could not fill the selected cells.", t); return;
    }
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
        setMsg(t); toast.error("Could not fill the selected cells.", t);
        // The bulk PATCH may have failed after applying some writes — refetch
        // so the table always mirrors what is actually stored.
        await load();
        return;
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
      // Network/parse failure: resync so any server-side writes show up.
      await load();
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

  /**
   * Bulk Add Rows to this existing price update.
   * Reuses existing SKU matching and product lookup logic.
   * In Full Vendor sessions, works as an upsert (updates matched rows and adds new ones).
   * Reports added/updated and skipped rows, and records Undo/Redo history.
   */
  const bulkAddItems = async (
    v: BulkAddInputRow[],
    summary: { added: number; updated?: number; skipped: number }
  ) => {
    if (bulkAddBusy) return;
    setBulkAddBusy(true);
    try {
      const r = await fetch(`/api/sessions/${id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: v, isFullVendor }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, isFullVendor ? "Could not apply changes." : "Could not add rows.");
        setMsg(t);
        toast.error(isFullVendor ? "Could not apply changes." : "Could not add rows.", t);
        return;
      }
      setMsg("");
      setShowBulkAdd(false);
      setPinnedOrder(null); // membership changed: re-sort normally

      if (isFullVendor) {
        const updatedItems = (d as { updatedItems?: { id: string; previous: Record<string, unknown>; current: Record<string, unknown> }[] })?.updatedItems ?? [];
        const addedIds = (d as { addedIds?: string[] })?.addedIds ?? [];
        const updatedCount = (d as { updatedCount?: number })?.updatedCount ?? summary.updated ?? 0;
        const addedCount = (d as { addedCount?: number })?.addedCount ?? summary.added ?? 0;

        if (updatedItems.length > 0 || addedIds.length > 0) {
          const payloads = [...v];
          recordHistory(
            `Bulk update (${updatedCount} updated, ${addedCount} added)`,
            async () => {
              if (addedIds.length > 0) {
                await deleteByIds(addedIds);
              }
              if (updatedItems.length > 0) {
                const patchPayload = updatedItems.map((u) => ({
                  id: u.id,
                  rawVendorSku: u.previous.rawVendorSku,
                  cleanedSku: u.previous.cleanedSku,
                  discount: u.previous.discount,
                  vendorListPriceNew: u.previous.vendorListPriceNew,
                  marginDivisor: u.previous.marginDivisor,
                  notes: u.previous.notes,
                }));
                await fetch(`/api/sessions/${id}/items`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ items: patchPayload }),
                });
              }
              await load();
            },
            async () => {
              await fetch(`/api/sessions/${id}/items`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items: payloads, isFullVendor: true }),
              });
              await load();
            },
          );
        }

        await load();
        const skipMsg = summary.skipped > 0 ? ` (${summary.skipped} skipped)` : "";
        toast.success(`Updated ${updatedCount} row${updatedCount === 1 ? "" : "s"} and added ${addedCount} row${addedCount === 1 ? "" : "s"} to worksheet${skipMsg}.`);
      } else {
        const newItems = (d as { items?: { id?: string }[] })?.items;
        const newIds = Array.isArray(newItems)
          ? newItems.map((it) => it.id).filter((nid): nid is string => typeof nid === "string" && Boolean(nid))
          : [];

        if (newIds.length > 0) {
          const payloads = [...v];
          const holder = { ids: [...newIds] };
          recordHistory(
            `Bulk add ${newIds.length} row${newIds.length === 1 ? "" : "s"}`,
            async () => {
              await deleteByIds(holder.ids);
              holder.ids = [];
              await load();
            },
            async () => {
              const resp = await fetch(`/api/sessions/${id}/items`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items: payloads }),
              });
              const respData = await resp.json().catch(() => ({}));
              if (Array.isArray(respData.items)) {
                holder.ids = respData.items
                  .map((it: { id?: string }) => it.id)
                  .filter((nid: unknown): nid is string => typeof nid === "string" && Boolean(nid));
              }
              await load();
            },
          );
        }

        await load();
        const skipMsg = summary.skipped > 0 ? ` (${summary.skipped} skipped)` : "";
        toast.success(`Added ${summary.added} row${summary.added === 1 ? "" : "s"} to worksheet${skipMsg}.`);
      }
    } catch {
      toast.error(isFullVendor ? "Could not apply changes." : "Could not add rows.", "Could not reach the server while adding rows.");
    } finally {
      setBulkAddBusy(false);
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

  /** Manually update the review status using the existing status field. */
  const changeStatus = async (nextStatus: string) => {
    if (!nextStatus || nextStatus === sheetStatus || statusBusy) return;
    const prev = sheetStatus;
    setSheetStatus(nextStatus);
    setStatusBusy(true);
    try {
      const r = await fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setSheetStatus(prev);
        toast.error("Could not update status.", apiErrorText(d, "Could not update status."));
        return;
      }
      const saved = String(d.session?.status ?? nextStatus);
      setSheetStatus(saved);
      toast.success(`Status updated to ${saved}.`);
    } catch {
      setSheetStatus(prev);
      toast.error("Could not update status.", "Could not reach the server. Check your connection and try again.");
    } finally {
      setStatusBusy(false);
    }
  };

  /** Fetch the Digital Store Count Excel for Full Vendor workflows. */
  const downloadFullVendorExcel = async (options?: DigitalStoreCountExportOptions) => {
    if (exportBusy) return;
    setExportBusy("fv-storecount");
    try {
      const body = {
        ...(sortKey && sortDir ? { ids: filtered.map((r) => r.id), sortKey, sortDir } : {}),
        priceMode: options?.priceMode ?? "changed",
        productFilter: options?.productFilter ?? "all",
      };
      const r = await fetch(`/api/fullvendor/sessions/${id}/storecount/excel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        const t = apiErrorText(d, "export failed.");
        setMsg(t); toast.error("Export failed.", t); return;
      }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `digital-storecount-${id}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
      setShowFvExportModal(false);
      toast.success("Digital Store Count Excel downloaded.");
    } catch {
      toast.error("Export failed.", "Could not reach the server while exporting.");
    } finally {
      setExportBusy(null);
    }
  };

  /** Fetch the Store Count Excel workbook, save it to disk, and report success/failure. */
  const downloadExcel = async () => {
    if (exportBusy) return;
    setExportBusy("storecount");
    try {
      // Preserve the table's current order, same as the PDF.
      const body = sortKey && sortDir ? { ids: filtered.map((r) => r.id), sortKey, sortDir } : {};
      const r = await fetch(`/api/sessions/${id}/storecount/excel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        const t = apiErrorText(d, "export failed.");
        setMsg(t); toast.error("Export failed.", t); return;
      }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `storecount-${id}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Store Count Excel downloaded.");
    } catch {
      toast.error("Export failed.", "Could not reach the server while exporting.");
    } finally {
      setExportBusy(null);
    }
  };

  /** Fetch the POS CSV export, save it to disk, and report success/failure. */
  const download = async (kind: "pos") => {
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
      a.download = `pos-export-${id}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      setSheetStatus("Exported");
      toast.success("POS CSV downloaded.");
      // Preserve the existing export workflow, then offer the optional
      // inventory price sync (explicit confirm; Not Now leaves inventory alone).
      setSyncResult(null);
      setSyncError("");
      setAskSync(true);
    } catch {
      toast.error("Export failed.", "Could not reach the server while exporting.");
    } finally {
      setExportBusy(null);
    }
  };

  /** Confirmed follow-up: update inventory prices from this sheet. */
  const runInventorySync = async () => {
    if (syncBusy) return;
    setSyncBusy(true);
    setSyncError("");
    try {
      const r = await fetch(`/api/sessions/${id}/sync-inventory-prices`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, "Could not update inventory prices.");
        setSyncError(t);
        return;
      }
      setSyncResult({
        updated: Number(d.updated ?? 0),
        exportedRows: Number(d.exportedRows ?? 0),
        skippedUnmatched: Array.isArray(d.skippedUnmatched) ? d.skippedUnmatched.map(String) : [],
        skippedUnmatchedCount: Number(d.skippedUnmatchedCount ?? 0),
        skippedAmbiguous: Array.isArray(d.skippedAmbiguous) ? d.skippedAmbiguous.map(String) : [],
        skippedAmbiguousCount: Number(d.skippedAmbiguousCount ?? 0),
        skippedBlankPrice: Array.isArray(d.skippedBlankPrice) ? d.skippedBlankPrice.map(String) : [],
        skippedBlankPriceCount: Number(d.skippedBlankPriceCount ?? 0),
        skippedInvalidPrice: Array.isArray(d.skippedInvalidPrice) ? d.skippedInvalidPrice : [],
        skippedInvalidPriceCount: Number(d.skippedInvalidPriceCount ?? 0),
        skippedDuplicate: Array.isArray(d.skippedDuplicate) ? d.skippedDuplicate.map(String) : [],
        skippedDuplicateCount: Number(d.skippedDuplicateCount ?? 0),
        failed: Array.isArray(d.failed) ? d.failed.map(String) : [],
        failedCount: Number(d.failedCount ?? 0),
        lastUpdatedAt: typeof d.lastUpdatedAt === "string" ? d.lastUpdatedAt : null,
      });
    } catch {
      setSyncError("Could not reach the server while updating inventory prices.");
    } finally {
      setSyncBusy(false);
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
    <div className="flex flex-col gap-3.5">
      {/* 1. Header & Actions Toolbar */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-white px-4 py-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">{name || "Price Update"}</h1>
            {isFullVendor && (
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                Full Vendor
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
              {items.length.toLocaleString()} product{items.length === 1 ? "" : "s"}
            </span>
            {filtered.length !== items.length && (
              <span className="text-slate-500 font-medium">
                ({filtered.length.toLocaleString()} matching filter)
              </span>
            )}
            {vendor && (
              <span className="text-slate-500">
                • Vendor: <span className="font-semibold text-slate-700">{vendor}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Status selector */}
          <label className="flex items-center gap-1.5 text-xs">
            <span className="font-medium text-slate-500">Status:</span>
            <select
              aria-label="Review status"
              value={sheetStatus}
              disabled={statusBusy}
              onChange={(e) => void changeStatus(e.target.value)}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-xs focus:border-indigo-500 focus:outline-none disabled:opacity-60"
            >
              {sheetStatus && !["Ready", "Being Reviewed", "Reviewed"].includes(sheetStatus) && (
                <option value={sheetStatus}>{sheetStatus}</option>
              )}
              <option value="Ready">Ready</option>
              <option value="Being Reviewed">Being Reviewed</option>
              <option value="Reviewed">Reviewed</option>
            </select>
          </label>

          {/* Export Toolbar Group */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50/70 p-0.5 gap-0.5 shadow-xs text-xs">
            <LoadingButton
              busy={exportBusy === "pos"}
              busyLabel="Exporting..."
              onClick={() => download("pos")}
              className="rounded-md bg-white border border-slate-200/80 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 shadow-2xs transition-colors disabled:opacity-60"
              title="Export CSV for Point of Sale system"
            >
              Export for POS
            </LoadingButton>
            {isFullVendor ? (
              <LoadingButton
                busy={exportBusy === "fv-storecount"}
                busyLabel="Excel..."
                onClick={() => setShowFvExportModal(true)}
                className="rounded-md bg-white border border-slate-200/80 px-2.5 py-1 font-medium text-indigo-700 hover:bg-indigo-50 shadow-2xs transition-colors disabled:opacity-60"
                title="Export Digital Store Count spreadsheet in Excel format"
              >
                Digital Store Count Excel
              </LoadingButton>
            ) : (
              <LoadingButton
                busy={exportBusy === "storecount"}
                busyLabel="Excel..."
                onClick={() => downloadExcel()}
                className="rounded-md bg-white border border-slate-200/80 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors disabled:opacity-60"
                title="Export Store Count spreadsheet in Excel format"
              >
                Store Count Excel
              </LoadingButton>
            )}
            <LoadingButton
              busy={pdfBusy}
              busyLabel="PDF..."
              onClick={pdf}
              className="rounded-md bg-slate-900 px-2.5 py-1 font-medium text-white hover:bg-slate-800 shadow-2xs transition-colors disabled:opacity-60"
              title="Generate printable Store Count PDF"
            >
              Generate Store Count PDF
            </LoadingButton>
          </div>
        </div>
      </header>

      {/* 2. Compact Workspace Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-slate-200/90 bg-white p-2 shadow-xs">
        {/* Left: Row addition & History group */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="h-8 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 active:bg-emerald-800 transition-colors"
            >
              + Add Row
            </button>
            <button
              type="button"
              onClick={() => setShowBulkAdd(true)}
              className="h-8 rounded-lg border border-slate-200 bg-emerald-50/60 px-3 text-xs font-semibold text-emerald-800 shadow-2xs hover:bg-emerald-100 transition-colors"
            >
              Bulk Add Rows
            </button>
          </div>

          <div className="h-4 w-px bg-slate-200 mx-1" aria-hidden="true" />

          <div className="inline-flex rounded-lg border border-slate-200 bg-white shadow-2xs divide-x divide-slate-200">
            <button
              type="button"
              onClick={() => void runHistory("undo")}
              disabled={!canUndo(history) || histBusy}
              title={canUndo(history) ? `Undo ${undoLabel(history)} (Ctrl/Cmd+Z)` : "Nothing to undo"}
              className="h-8 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            >
              ↶ Undo
            </button>
            <button
              type="button"
              onClick={() => void runHistory("redo")}
              disabled={!canRedo(history) || histBusy}
              title={canRedo(history) ? `Redo ${redoLabel(history)} (Ctrl/Cmd+Shift+Z)` : "Nothing to redo"}
              className="h-8 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            >
              ↷ Redo
            </button>
          </div>
        </div>

        {/* Center: Search, Flags Filter, and Row Filter in a single compact toolbar */}
        <div className="flex flex-1 items-center gap-1.5 min-w-64 max-w-xl">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-slate-400">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50/50 pl-8 pr-2.5 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none transition-colors"
              placeholder="Search products..."
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); setPinnedOrder(null); }}
            />
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowFlagMenu((v) => !v)}
              className={`h-8 flex items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                selectedFlags.size > 0
                  ? "border-indigo-400 bg-indigo-50 text-indigo-900"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-2xs"
              }`}
              aria-expanded={showFlagMenu}
              aria-haspopup="dialog"
            >
              <span>Flags</span>
              {selectedFlags.size > 0 && (
                <span className="rounded-full bg-indigo-600 px-1.5 py-0.2 text-[10px] font-semibold text-white">
                  {selectedFlags.size}
                </span>
              )}
              <span className="text-[10px] text-slate-400">▾</span>
            </button>
            {showFlagMenu && (
              <div
                ref={flagMenuRef}
                className="absolute left-0 top-full z-40 mt-1 min-w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-xl text-xs"
              >
                <div className="flex items-center justify-between border-b pb-1.5 font-semibold text-slate-700">
                  <span>Filter by flag:</span>
                  {selectedFlags.size > 0 && (
                    <button
                      type="button"
                      className="text-xs text-blue-600 hover:underline"
                      onClick={clearFlagFilter}
                    >
                      Clear all
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-1 py-1.5 max-h-60 overflow-y-auto">
                  {availableFlags.length === 0 ? (
                    <span className="text-slate-400 px-1">No flags in worksheet</span>
                  ) : (
                    availableFlags.map((flag) => {
                      const count = flagCounts.get(flag) ?? 0;
                      const isChecked = selectedFlags.has(flag);
                      return (
                        <label
                          key={flag}
                          className="flex cursor-pointer items-center justify-between rounded px-2 py-1 hover:bg-slate-100"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleFlagFilter(flag)}
                              className="rounded border-slate-300 text-indigo-600"
                            />
                            <span>{flag}</span>
                          </div>
                          <span className="text-slate-400 font-mono">({count})</span>
                        </label>
                      );
                    })
                  )}
                </div>
                {availableFlags.length > 0 && (
                  <div className="flex justify-between border-t pt-1.5">
                    <button
                      type="button"
                      className="text-xs text-slate-600 hover:underline"
                      onClick={() => {
                        setSelectedFlags(new Set(availableFlags));
                        setPage(1);
                        setPinnedOrder(null);
                      }}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      className="text-xs text-slate-600 hover:underline"
                      onClick={() => setShowFlagMenu(false)}
                    >
                      Close
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <select
            className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-2xs focus:border-indigo-500 focus:outline-none"
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setPage(1); setPinnedOrder(null); }}
          >
            <option value="all">All rows</option>
            <option value="unmatched">Unmatched</option>
            <option value="notfound">Not Found</option>
            <option value="changed">Price Changed</option>
            <option value="inactive">Inactive</option>
            <option value="missing">Vendor price missing</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        {/* Right: Selection Actions (Set Lower & Destructive Delete visually separated) */}
        <div className="flex items-center gap-1.5 border-l border-slate-200 pl-2">
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
            className="h-8 rounded-lg border border-violet-200 bg-violet-50/70 px-2.5 text-xs font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {selected.size > 0 && lowerCount > 0
              ? `Set Lower (${lowerCount})`
              : selected.size > 0
                ? `Set Lower (${selected.size})`
                : "Set Lower Prices"}
          </LoadingButton>

          <LoadingButton
            busy={bulkBusy}
            busyLabel="Deleting..."
            disabled={selected.size === 0}
            onClick={() => setConfirmBulk(true)}
            className="h-8 rounded-lg border border-red-200 bg-red-50 px-2.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {selected.size > 0 ? `Delete (${selected.size})` : "Delete Selection"}
          </LoadingButton>
        </div>
      </div>

      {msg && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
          <span className="font-semibold text-slate-900">Notice:</span> {msg}
        </div>
      )}
      {fillBusy && (
        <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-700 animate-pulse">
          Copying value to selected rows...
        </div>
      )}

      {/* 3. Worksheet Table Area */}
      <div ref={gridContainerRef} className="rounded-xl border border-slate-200/90 bg-white overflow-hidden shadow-xs">
        <PriceGrid
          rows={filtered} page={page} pageSize={pageSize} onEdit={editCell} onDelete={removeRow}
          selected={selected} onToggle={toggleOne} onToggleAll={togglePageVisible}
          sortKey={sortKey} sortDir={sortDir} onSort={changeSort} onFillDown={fillDown}
          onOpenNotes={(item) => setNoteRow(item)}
          onRestoreDiscount={restoreDiscount}
          layoutKey={id}
          availableFlags={availableFlags}
          selectedFlags={selectedFlags}
          onToggleFlag={toggleFlagFilter}
          onClearFlags={clearFlagFilter}
        />
      </div>

      {/* 4. Compact Pagination Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white px-3.5 py-2 text-xs shadow-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            className="h-7 rounded-md border border-slate-200 bg-white px-2.5 font-medium text-slate-700 shadow-2xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            onClick={() => goToPage(page - 1)}
          >
            ← Prev
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            className="h-7 rounded-md border border-slate-200 bg-white px-2.5 font-medium text-slate-700 shadow-2xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            onClick={() => goToPage(page + 1)}
          >
            Next →
          </button>
        </div>
        <div className="font-medium text-slate-700">
          Page {page} of {totalPages} · {totalCount === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalCount)} of {totalCount} products
        </div>
        <div className="text-slate-400">
          {pageSize} products per page
        </div>
      </div>

      {showAdd && (
        <AddItemDialog
          busy={addBusy}
          onClose={() => { if (!addBusy) setShowAdd(false); }}
          onSubmit={addItem}
          existingSkus={items.flatMap((r) => [r.rawVendorSku, r.cleanedSku])}
        />
      )}
      {showBulkAdd && (
        <BulkAddDialog
          sessionId={id}
          busy={bulkAddBusy}
          onClose={() => { if (!bulkAddBusy) setShowBulkAdd(false); }}
          onSubmit={bulkAddItems}
          existingSkus={items.flatMap((r) => [r.rawVendorSku, r.cleanedSku])}
          isFullVendor={isFullVendor}
        />
      )}
      <DigitalStoreCountExportDialog
        isOpen={showFvExportModal}
        busy={exportBusy === "fv-storecount"}
        vendorName={vendor}
        onClose={() => { if (!exportBusy) setShowFvExportModal(false); }}
        onExport={(opts) => downloadFullVendorExcel(opts)}
      />
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

      {/* 5. Collapsible Price Sheet Notes (Collapsed by default) */}
      <section aria-label="Price Sheet Notes" className="rounded-xl border border-slate-200/90 bg-white shadow-xs overflow-hidden">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setNotesExpanded((v) => !v)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setNotesExpanded((v) => !v); } }}
          className="flex cursor-pointer items-center justify-between px-4 py-3 hover:bg-slate-50/70 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <span
              className="text-slate-400 text-xs transition-transform duration-200"
              style={{ display: "inline-block", transform: notesExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              ▶
            </span>
            <h2 className="text-sm font-semibold text-slate-800">Price Sheet Notes</h2>
            {sheetNotes ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                Notes attached
              </span>
            ) : (
              <span className="text-xs text-slate-400">
                (empty)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {!sheetNotesEditing && (
              <button
                type="button"
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
                onClick={() => {
                  setSheetNotesDraft(sheetNotes);
                  setSheetNotesEditing(true);
                  setNotesExpanded(true);
                }}
              >
                {sheetNotes ? "Edit Notes" : "+ Add Notes"}
              </button>
            )}
            <button
              type="button"
              className="text-xs font-medium text-slate-500 hover:text-slate-800"
              onClick={() => setNotesExpanded((v) => !v)}
              aria-expanded={notesExpanded}
            >
              {notesExpanded ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>

        {notesExpanded && (
          <div className="border-t border-slate-100 p-4">
            <p className="text-xs text-slate-500">
              General notes for this entire price update (e.g. vendor comparisons). Markdown supported — including tables — with no changes to the table structure.
            </p>
            {sheetNotesEditing ? (
              <div className="mt-3">
                <MarkdownEditor value={sheetNotesDraft} onChange={setSheetNotesDraft} />
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                    disabled={sheetNotesBusy}
                    onClick={() => setSheetNotesEditing(false)}
                  >
                    Cancel
                  </button>
                  <LoadingButton
                    busy={sheetNotesBusy}
                    busyLabel="Saving..."
                    onClick={saveSheetNotes}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    Save Notes
                  </LoadingButton>
                </div>
              </div>
            ) : sheetNotes ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-xs">
                <MarkdownDoc source={sheetNotes} />
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-400">
                No price sheet notes yet. Click “+ Add Notes” to record vendor comparisons or general remarks.
              </p>
            )}
          </div>
        )}
      </section>
      {askSync && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Update App Inventory Prices?">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
            {!syncResult ? (
              <>
                <h2 className="text-lg font-bold">Update App Inventory Prices?</h2>
                <p className="mt-2 text-sm text-slate-600">
                  The POS CSV has been generated. Would you also like to update the
                  corresponding product prices in the app&apos;s inventory using this price update sheet?
                </p>
                {syncError && (
                  <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{syncError}</p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded border px-3 py-1.5 text-sm disabled:opacity-60"
                    disabled={syncBusy}
                    onClick={() => { if (!syncBusy) { setAskSync(false); setSyncError(""); } }}
                  >
                    Not Now
                  </button>
                  <LoadingButton
                    busy={syncBusy}
                    busyLabel="Updating..."
                    onClick={runInventorySync}
                    className="rounded bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Update Inventory Prices
                  </LoadingButton>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold">Inventory Price Update</h2>
                <div className="mt-2 text-sm text-slate-700">
                  <p>Products successfully updated: <span className="font-semibold">{syncResult.updated}</span></p>
                  <p>Exported rows considered: <span className="font-semibold">{syncResult.exportedRows}</span></p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>Skipped (SKU not matched): {syncResult.skippedUnmatchedCount}{syncResult.skippedUnmatched.length ? ` — e.g. ${syncResult.skippedUnmatched.slice(0, 5).join(", ")}` : ""}</li>
                    <li>Skipped (ambiguous / duplicate SKU): {syncResult.skippedAmbiguousCount}{syncResult.skippedAmbiguous.length ? ` — e.g. ${syncResult.skippedAmbiguous.slice(0, 5).join(", ")}` : ""}</li>
                    <li>Skipped (blank price): {syncResult.skippedBlankPriceCount}{syncResult.skippedBlankPrice.length ? ` — e.g. ${syncResult.skippedBlankPrice.slice(0, 5).join(", ")}` : ""}</li>
                    <li>Skipped (invalid price): {syncResult.skippedInvalidPriceCount}{syncResult.skippedInvalidPrice.length ? ` — e.g. ${syncResult.skippedInvalidPrice.slice(0, 5).map((r) => `${r.sku} (${r.price})`).join(", ")}` : ""}</li>
                    <li>Skipped (duplicate row in sheet): {syncResult.skippedDuplicateCount}{syncResult.skippedDuplicate.length ? ` — e.g. ${syncResult.skippedDuplicate.slice(0, 5).join(", ")}` : ""}</li>
                    <li>Failed updates: {syncResult.failedCount}{syncResult.failed.length ? ` — e.g. ${syncResult.failed.slice(0, 5).join(", ")}` : ""}</li>
                  </ul>
                  {syncResult.updated > 0 ? (
                    <p className="mt-2 text-slate-600">
                      Inventory prices now match the POS CSV (Nearest 9 &#8594; Price, Our New List Price &#8594; list cost).
                      {syncResult.lastUpdatedAt ? ` Last updated: ${new Date(syncResult.lastUpdatedAt).toLocaleString()}.` : ""}
                    </p>
                  ) : (
                    <p className="mt-2 text-amber-700">No prices were updated, so Last updated was left unchanged.</p>
                  )}
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded border px-3 py-1.5 text-sm"
                    onClick={() => { setAskSync(false); setSyncResult(null); setSyncError(""); }}
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
