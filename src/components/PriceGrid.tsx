"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { SortDir, SortableItemKey } from "@/lib/itemSort";
import { freezeColumn, frozenLeft, isFrozen, unfreezeColumn } from "@/lib/tableUi";
import {
  clampColWidth, clampRowHeight, isWrapped, loadTableLayout, saveTableLayout, toggleWrapped,
} from "@/lib/tableLayout";
import { markdownExcerpt } from "@/lib/markdown";
import { MarkdownDoc } from "./MarkdownEditor";

export type Item = {
  id: string; rawVendorSku: string; cleanedSku: string; cleanedOverridden: boolean;
  productNumber: string; productName: string; brand: string; vendor: string;
  discount: string; currentListPrice: string | null; vendorListPriceNew: string | null;
  ourNewListPrice: string | null; marginDivisor: string; ourNewRetailPrice: string | null;
  oldRetailPrice: string | null; nearest9: string | null; notes: string;
  /** User's custom (manually entered) Nearest 9; null/undefined = automatic. */
  nearest9Custom?: string | null;
  isInactive: boolean; matched: boolean;
};

export const COLS: { key: string; label: string; editable?: boolean; kind: "text" | "number" | "flags" }[] = [
  { key: "rawVendorSku", label: "Raw Vendor SKU/Code", editable: true, kind: "text" },
  { key: "cleanedSku", label: "Cleaned SKU", editable: true, kind: "text" },
  { key: "productNumber", label: "Product Number", kind: "text" },
  { key: "productName", label: "Product Name", kind: "text" },
  { key: "brand", label: "Brand", kind: "text" },
  { key: "vendor", label: "Vendor", kind: "text" },
  { key: "discount", label: "Discount (%) Vendor/Brand", editable: true, kind: "number" },
  { key: "currentListPrice", label: "Current List Price", kind: "number" },
  { key: "vendorListPriceNew", label: "Vendor List Price (New)", editable: true, kind: "number" },
  { key: "ourNewListPrice", label: "Our New List Price", kind: "number" },
  { key: "marginDivisor", label: "Margin/Divisor", editable: true, kind: "number" },
  { key: "ourNewRetailPrice", label: "Our New Retail Price", kind: "number" },
  { key: "oldRetailPrice", label: "Old Retail Price", kind: "number" },
  { key: "nearest9", label: "Nearest 9", editable: true, kind: "number" },
  { key: "notes", label: "Notes", editable: true, kind: "text" },
];

export const FLAGS_COL_KEY = "flags";

/** Sensible default column widths (px) ensuring predictable table proportions. */
export const DEFAULT_COL_WIDTHS: Record<string, number> = {
  rawVendorSku: 145,
  cleanedSku: 145,
  productNumber: 120,
  productName: 280,
  brand: 125,
  vendor: 125,
  discount: 105,
  currentListPrice: 115,
  vendorListPriceNew: 125,
  ourNewListPrice: 115,
  marginDivisor: 105,
  ourNewRetailPrice: 120,
  oldRetailPrice: 115,
  nearest9: 110,
  notes: 190,
  flags: 145,
};

/** Freezable headers in display order: every data column, then Flags. */
export const FREEZE_KEYS: string[] = [...COLS.map((c) => c.key), FLAGS_COL_KEY];

/** Fixed widths of the always-sticky row-number / checkbox gutter columns. */
const ROW_NUM_W = 48;
const CHECK_W = 36;
/** headRefs keys for the two gutter columns. */
const ROW_NUM_KEY = "__rownum";
const CHECK_KEY = "__checkbox";
/** Right-edge shadow marking the last sticky column. */
const EDGE_SHADOW = "4px 0 6px -5px rgba(15,23,42,0.45)";
const HEADER_BG = "var(--grid-header-bg, #f1f5f9)";
const WHITE_BG = "var(--grid-bg, #ffffff)";
const UNMATCHED_BG = "var(--grid-unmatched-bg, #fef2f2)";
const SELECTED_BG = "var(--grid-selected-bg, #e0f2fe)";
const EDITABLE_BG = "var(--grid-editable-bg, #ecfdf5)";
const CUSTOM_BG = "var(--grid-custom-bg, #fffbeb)";
const FILL_BG = "var(--grid-selected-bg, #dbeafe)";

/** useLayoutEffect that is safe in client components rendered by the server. */
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function sameWidths(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}

export function Flags({ r }: { r: Item }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {!r.matched && (
        <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:border-red-900/50 dark:bg-red-950/60 dark:text-red-300">
          Not Found
        </span>
      )}
      {r.isInactive && (
        <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/60 dark:text-amber-300">
          Inactive
        </span>
      )}
      {r.cleanedOverridden && (
        <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/60 dark:text-blue-300">
          Manual SKU
        </span>
      )}
      {!!r.nearest9Custom && String(r.nearest9Custom).trim() !== "" && (
        <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/60 dark:text-violet-300">
          Custom
        </span>
      )}
      {r.matched && r.nearest9 && r.oldRetailPrice && r.nearest9 !== r.oldRetailPrice && (
        <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/60 dark:text-emerald-300">
          Changed
        </span>
      )}
      {r.matched && r.nearest9 && r.oldRetailPrice && r.nearest9 === r.oldRetailPrice && (
        <span className="text-[11px] text-slate-400 dark:text-zinc-500">No change</span>
      )}
    </span>
  );
}

export function PriceGrid({ rows, page, pageSize, onEdit, onDelete, selected, onToggle, onToggleAll, sortKey, sortDir, onSort, onFillDown, onOpenNotes, layoutKey, onRestoreDiscount, availableFlags, selectedFlags, onToggleFlag, onClearFlags }: {
  rows: Item[]; page: number; pageSize: number;
  onEdit: (item: Item, key: string, value: string) => void;
  onDelete: (item: Item) => void;
  selected: Set<string>;
  onToggle: (item: Item) => void;
  onToggleAll: () => void;
  sortKey: SortableItemKey | null;
  sortDir: SortDir | null;
  onSort: (key: SortableItemKey, dir: SortDir | null) => void;
  onFillDown: (item: Item, key: string, value: string, afterIds: string[]) => void;
  /** Open the Markdown Notes popup for a row (Notes cells only). */
  onOpenNotes?: (item: Item) => void;
  /** Restore the configured Vendor/Brand default discount (discount cells only). */
  onRestoreDiscount?: (item: Item) => void;
  /** Session-only layout memory key */
  layoutKey?: string;
  availableFlags?: string[];
  selectedFlags?: Set<string>;
  onToggleFlag?: (flag: string) => void;
  onClearFlags?: () => void;
}) {
  const slice = rows.slice((page - 1) * pageSize, page * pageSize);
  const sliceSelected = slice.filter((r) => selected.has(r.id)).length;
  const allChecked = slice.length > 0 && sliceSelected === slice.length;
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [fill, setFill] = useState<{ rowId: string; key: string; value: string; endId: string | null } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ rowId: string; key: string; startY: number; currentY: number } | null>(null);
  const [, forceTick] = useState(0);

  // ---- Column freezing: always a contiguous prefix of the column order ----
  // Presentation-only layout (widths/heights/wrap/frozen) is remembered for
  // the current session via sessionStorage. Row data is never touched.
  const [frozenCount, setFrozenCount] = useState(() => loadTableLayout(layoutKey)?.frozen ?? 0);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => loadTableLayout(layoutKey)?.widths ?? {});
  const [rowHeights, setRowHeights] = useState<Record<string, number>>(() => loadTableLayout(layoutKey)?.heights ?? {});
  const [wrappedCols, setWrappedCols] = useState<string[]>(() => loadTableLayout(layoutKey)?.wrapped ?? []);
  const [gutter, setGutter] = useState({ rowNumbers: ROW_NUM_W, checkboxes: CHECK_W });
  const headRefs = useRef<Record<string, HTMLTableCellElement | null>>({});
  const lastStickyKey = frozenCount > 0 ? FREEZE_KEYS[frozenCount - 1] : CHECK_KEY;

  // Remember display-only layout for the current session. Business data,
  // sorting, filters, and selection are untouched.
  useEffect(() => {
    if (!layoutKey) return;
    saveTableLayout(layoutKey, { widths: colWidths, heights: rowHeights, wrapped: wrappedCols, frozen: frozenCount });
  }, [layoutKey, colWidths, rowHeights, wrappedCols, frozenCount]);

  // Reload saved layout when switching to a different price update (the grid
  // instance is reused across sessions; each sheet keeps its own layout).
  const appliedLayoutKey = useRef(layoutKey);
  useEffect(() => {
    if (appliedLayoutKey.current === layoutKey) return;
    appliedLayoutKey.current = layoutKey;
    const saved = loadTableLayout(layoutKey);
    setColWidths(saved?.widths ?? {});
    setRowHeights(saved?.heights ?? {});
    setWrappedCols(saved?.wrapped ?? []);
    setFrozenCount(saved?.frozen ?? 0);
  }, [layoutKey]);

  // ---- Row-number selection: click, drag over, or Shift+click a range ----
  const anchorIdRef = useRef<string | null>(null);
  const dragSelectRef = useRef(false);
  const dragPickedRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const end = () => { dragSelectRef.current = false; dragPickedRef.current = null; };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => { window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
  }, []);

  // Measure real header widths so frozen columns pin next to each other with
  // exact offsets. Only reads the DOM and only stores changed values, so it
  // can never loop; ResizeObserver keeps the offsets correct when content,
  // page, filter, or window size changes.
  const sliceIds = slice.map((r) => r.id).join(",");
  useIsoLayoutEffect(() => {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const measure = () => {
      const next: Record<string, number> = {};
      for (const k of FREEZE_KEYS) {
        const el = headRefs.current[k];
        if (el) next[k] = round2(el.getBoundingClientRect().width);
      }
      const rn = headRefs.current[ROW_NUM_KEY];
      const cb = headRefs.current[CHECK_KEY];
      const g = {
        rowNumbers: rn ? round2(rn.getBoundingClientRect().width) : ROW_NUM_W,
        checkboxes: cb ? round2(cb.getBoundingClientRect().width) : CHECK_W,
      };
      setWidths((prev) => (sameWidths(prev, next) ? prev : next));
      setGutter((prev) => (prev.rowNumbers === g.rowNumbers && prev.checkboxes === g.checkboxes ? prev : g));
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const k of [...FREEZE_KEYS, ROW_NUM_KEY, CHECK_KEY]) {
      const el = headRefs.current[k];
      if (el) ro.observe(el);
    }
    return () => ro.disconnect();
  }, [sliceIds, frozenCount]);

  /** Sticky style for a data column, or undefined when the column is not frozen. */
  const stickyStyle = (key: string, header: boolean, bg: string): CSSProperties | undefined => {
    const eff: Record<string, number> = { ...widths, ...colWidths };
    if (liveCol && liveCol.key === key) eff[key] = liveCol.w;
    const left = frozenLeft(FREEZE_KEYS, frozenCount, key, eff, gutter);
    if (left === null) return undefined;
    return {
      position: "sticky",
      left,
      zIndex: header ? 2 : 10,
      background: bg,
      boxShadow: key === lastStickyKey ? EDGE_SHADOW : undefined,
    };
  };

  /** Sticky style for the always-fixed row-number / checkbox gutter columns. */
  const gutterStyle = (which: "row" | "check", header: boolean, bg: string): CSSProperties => (
    which === "row"
      ? { position: "sticky", left: 0, zIndex: header ? 3 : 11, background: bg }
      : {
          position: "sticky",
          left: gutter.rowNumbers,
          zIndex: header ? 3 : 11,
          background: bg,
          boxShadow: lastStickyKey === CHECK_KEY ? EDGE_SHADOW : undefined,
        }
  );

  // ---- Excel-style resizing + Wrap Text (presentation only; data untouched) --
  // Live drag sizes render through state (snapshots below) so frozen
  // `sticky` offsets and width styles stay exact mid-drag; pointermove is
  // rAF-throttled and the measured-width cache is patched directly, so no
  // ResizeObserver loop or re-render churn happens while dragging.
  const [liveCol, setLiveCol] = useState<{ key: string; w: number } | null>(null);
  const colDragRef = useRef<{ key: string; startX: number; startW: number; liveW: number } | null>(null);
  const [liveRow, setLiveRow] = useState<{ id: string; h: number } | null>(null);
  const rowDragRef = useRef<{ id: string; startY: number; startH: number; liveH: number } | null>(null);
  const rafRef = useRef(0);

  /** Fixed-width style for a column (with stable defaults, applied to <th> and <td>). */
  const colWidthStyle = (key: string): CSSProperties => {
    if (liveCol && liveCol.key === key) {
      return { width: liveCol.w, minWidth: liveCol.w, maxWidth: liveCol.w };
    }
    const w = colWidths[key] ?? DEFAULT_COL_WIDTHS[key];
    if (w !== undefined) {
      return { width: w, minWidth: w, maxWidth: w };
    }
    return {};
  };

  /** Wrapped columns allow long strings to break; untouched columns keep original styling. */
  const wrapClassOf = (key: string): string =>
    isWrapped(wrappedCols, key) ? " break-words" : "";
  const wrappedNow = (key: string): boolean => isWrapped(wrappedCols, key);
  const setWrap = (key: string, on: boolean) => {
    setWrappedCols((prev) => {
      const has = isWrapped(prev, key);
      if (has === on) return prev;
      return toggleWrapped(prev, key);
    });
    setOpenMenu(null);
  };

  const commitColDrag = () => {
    const d = colDragRef.current;
    colDragRef.current = null;
    setLiveCol(null);
    if (!d) return;
    setColWidths((prev) => ({ ...prev, [d.key]: d.liveW }));
  };
  const commitRowDrag = () => {
    const d = rowDragRef.current;
    rowDragRef.current = null;
    setLiveRow(null);
    if (!d) return;
    setRowHeights((prev) => ({ ...prev, [d.id]: d.liveH }));
  };
  useEffect(() => {
    const up = () => {
      cancelAnimationFrame(rafRef.current);
      commitColDrag();
      commitRowDrag();
    };
    const cancel = () => {
      cancelAnimationFrame(rafRef.current);
      colDragRef.current = null;
      rowDragRef.current = null;
      setLiveCol(null);
      setLiveRow(null);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, []);

  const startColResize = (e: ReactPointerEvent<HTMLSpanElement>, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startW = colWidths[key] ?? widths[key] ?? headRefs.current[key]?.getBoundingClientRect().width ?? 120;
    colDragRef.current = { key, startX: e.clientX, startW, liveW: clampColWidth(startW) };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const moveColResize = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const d = colDragRef.current;
    if (!d) return;
    const target = clampColWidth(d.startW + (e.clientX - d.startX));
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      // One throttled snapshot per frame: header + every cell in the column
      // render at the new width, and frozen `left` offsets (derived from
      // state) stay exact. The measured-width cache is patched too, but only
      // for this key and only while dragging, so ResizeObserver never loops.
      d.liveW = target;
      setWidths((prev) => (prev[d.key] === target ? prev : { ...prev, [d.key]: target }));
      setLiveCol({ key: d.key, w: target });
    });
    e.preventDefault();
    e.stopPropagation();
  };
  const startRowResize = (e: ReactPointerEvent<HTMLSpanElement>, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const tr = (e.target as HTMLElement).closest("tr");
    const startH = rowHeights[id] ?? tr?.getBoundingClientRect().height ?? 33;
    rowDragRef.current = { id, startY: e.clientY, startH, liveH: clampRowHeight(startH) };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const moveRowResize = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const d = rowDragRef.current;
    if (!d) return;
    const target = clampRowHeight(d.startH + (e.clientY - d.startY));
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      d.liveH = target;
      setLiveRow({ id: d.id, h: target });
    });
    e.preventDefault();
    e.stopPropagation();
  };
  /** Double-click a row handle to clear the manual height (back to auto fit). */
  const autoRowHeight = (id: string) => {
    setLiveRow((prev) => (prev && prev.id === id ? null : prev));
    setRowHeights((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const selectRow = (r: Item) => {
    if (selected.has(r.id) || dragPickedRef.current?.has(r.id)) return;
    dragPickedRef.current?.add(r.id);
    onToggle(r);
  };

  /** Keep selecting rows while the pointer is dragged over the row numbers. */
  const onRowNumEnter = (r: Item) => {
    if (dragSelectRef.current) selectRow(r);
  };

  /** Background of a body row (selection wins, then the unmatched tint). */
  const rowBgOf = (r: Item) => (selected.has(r.id) ? SELECTED_BG : !r.matched ? UNMATCHED_BG : WHITE_BG);

  const onRowNumPointerDown = (r: Item, e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.shiftKey && anchorIdRef.current) {
      const ids = slice.map((x) => x.id);
      const from = ids.indexOf(anchorIdRef.current);
      const to = ids.indexOf(r.id);
      if (from >= 0 && to >= 0) {
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        for (const row of slice.slice(lo, hi + 1)) selectRow(row);
      }
      return;
    }
    anchorIdRef.current = r.id;
    dragSelectRef.current = true;
    dragPickedRef.current = new Set<string>();
    selectRow(r);
  };

  /** Freeze/Unfreeze + Wrap Text entries, appended after the existing sort actions. */
  const freezeMenu = (key: string) => {
    const frozen = isFrozen(FREEZE_KEYS, frozenCount, key);
    const wrapOn = wrappedNow(key);
    const cls = "block w-full px-3 py-1.5 text-left text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";
    return (
      <>
        <div className="my-1 border-t border-slate-200 dark:border-zinc-700" />
        <button
          type="button"
          className={cls}
          disabled={frozen}
          title={frozen ? "This column is already frozen." : "Freeze this column and every column to its left, so they stay in view while you scroll sideways."}
          onClick={() => { setFrozenCount(freezeColumn(FREEZE_KEYS, frozenCount, key)); setOpenMenu(null); }}
        >
          Freeze Column
        </button>
        <button
          type="button"
          className={cls}
          disabled={!frozen}
          title={frozen ? "Unfreeze this column (any frozen columns to its right are unfrozen too)." : "This column is not frozen."}
          onClick={() => { setFrozenCount(unfreezeColumn(FREEZE_KEYS, frozenCount, key)); setOpenMenu(null); }}
        >
          Unfreeze Column
        </button>
        <div className="my-1 border-t border-slate-200 dark:border-zinc-700" />
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={wrapOn}
          className={cls}
          title={wrapOn
            ? "Show each cell on a single line again (long text is cut off)."
            : "Wrap long text onto multiple lines so you can read more without opening the editor."}
          onClick={() => setWrap(key, !wrapOn)}
        >
          <span className="flex items-center gap-1.5">
            {wrapOn && (
              <svg className="h-3 w-3 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
            <span>Wrap Text</span>
          </span>
        </button>
        {wrapOn && (
          <button
            type="button"
            className={cls}
            title="Show each cell on a single line again (long text is cut off)."
            onClick={() => setWrap(key, false)}
          >
            Unwrap Text
          </button>
        )}
      </>
    );
  };
  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [openMenu]);
  const menuFor = (kind: "text" | "number" | "flags", key: string): { label: string; dir: SortDir }[] => {
    if (kind === "number") return [
      { label: "Sort Smallest → Largest", dir: "asc" },
      { label: "Sort Largest → Smallest", dir: "desc" },
    ];
    if (kind === "flags") return [
      { label: "Sort A → Z", dir: "asc" },
      { label: "Sort Z → A", dir: "desc" },
    ];
    void key;
    return [
      { label: "Sort A → Z", dir: "asc" },
      { label: "Sort Z → A", dir: "desc" },
    ];
  };
  return (
    <div ref={listRef} className="overflow-auto rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" style={{ maxHeight: "65vh" }}>
      <table className="w-full min-w-[1800px] border-collapse text-xs">
        <thead className="sticky top-0 bg-slate-50 dark:bg-zinc-900 text-slate-700 dark:text-zinc-200" style={{ zIndex: 20 }}>
          <tr>
            <th
              ref={(el) => { headRefs.current[ROW_NUM_KEY] = el; }}
              className="border border-slate-200 dark:border-zinc-800 px-1 py-2 text-center text-[10px] font-normal text-slate-400 dark:text-zinc-500"
              style={{ width: ROW_NUM_W, ...gutterStyle("row", true, HEADER_BG) }}
              title="Row number — click a row number to select that row"
            >
              #
            </th>
            <th
              ref={(el) => { headRefs.current[CHECK_KEY] = el; }}
              className="border border-slate-200 dark:border-zinc-800 px-2 py-2"
              style={{ width: CHECK_W, ...gutterStyle("check", true, HEADER_BG) }}
            >
              <input
                type="checkbox"
                aria-label="Select all visible rows"
                checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = !allChecked && sliceSelected > 0; }}
                onChange={onToggleAll}
              />
            </th>
            {COLS.map((c) => {
              const active = sortKey === c.key;
              const isNum = c.kind === "number";
              return (
                <th
                  key={c.label}
                  data-col={c.key}
                  ref={(el) => { headRefs.current[c.key] = el; }}
                  className={`relative border border-slate-200 dark:border-zinc-800 px-2 py-2 font-semibold ${
                    c.editable
                      ? "bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-950 dark:text-emerald-300"
                      : "text-slate-700 dark:text-zinc-200"
                  }`}
                  style={{ ...stickyStyle(c.key, true, c.editable ? EDITABLE_BG : HEADER_BG), ...colWidthStyle(c.key) }}
                >
                  <div className={`flex items-center gap-1.5 ${isNum ? "justify-end text-right" : "justify-between text-left"}`}>
                    <span className="truncate">{c.label}</span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {c.editable && (
                        <span title="Editable column" className="text-emerald-600 dark:text-emerald-400 opacity-60">
                          <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                          </svg>
                        </span>
                      )}
                      {active && sortDir && (
                        <svg className="h-3 w-3 text-slate-700 dark:text-zinc-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          {sortDir === "asc" ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /> : <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />}
                        </svg>
                      )}
                      <button
                        type="button"
                        aria-label={`Sort ${c.label}`}
                        aria-haspopup="menu"
                        aria-expanded={openMenu === c.key}
                        className="rounded p-0.5 text-slate-400 hover:bg-slate-200 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 hover:text-slate-900"
                        onClick={() => setOpenMenu(openMenu === c.key ? null : c.key)}
                      >
                        <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {/* Excel-style column resize handle: drag the divider. */}
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${c.label} column`}
                    title={`Drag to resize ${c.label} (width is remembered for this session)`}
                    className="absolute top-0 right-0 h-full w-3 cursor-col-resize touch-none select-none"
                    style={{ zIndex: 5 }}
                    onPointerDown={(e) => startColResize(e, c.key)}
                    onPointerMove={moveColResize}
                    onDoubleClick={() => {
                      setColWidths((prev) => {
                        if (!(c.key in prev)) return prev;
                        const next = { ...prev };
                        delete next[c.key];
                        return next;
                      });
                    }}
                  >
                    <span className="absolute top-0 right-0 h-full w-[3px] bg-transparent hover:bg-sky-500" />
                  </span>
                  {openMenu === c.key && (
                    <div ref={menuRef} role="menu" aria-label={`Sort ${c.label}`} className="absolute left-0 top-full z-30 min-w-44 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 py-1 text-xs font-normal shadow-lg dark:text-zinc-200">
                      {menuFor(c.kind, c.key).map((o) => (
                        <button
                          key={o.dir}
                          type="button"
                          role="menuitemradio"
                          aria-checked={active && sortDir === o.dir}
                          className={`block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-700 ${active && sortDir === o.dir ? "font-bold text-slate-900 dark:text-white" : ""}`}
                          onClick={() => { onSort(c.key as SortableItemKey, o.dir); setOpenMenu(null); }}
                        >
                          {o.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={!active || !sortDir}
                        className="block w-full px-3 py-1.5 text-left text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700"
                        onClick={() => { onSort(c.key as SortableItemKey, null); setOpenMenu(null); }}
                      >
                        Clear sort
                      </button>
                      {freezeMenu(c.key)}
                    </div>
                  )}
                </th>
              );
            })}
            <th
              data-col={FLAGS_COL_KEY}
              ref={(el) => { headRefs.current[FLAGS_COL_KEY] = el; }}
              className="relative border border-slate-200 dark:border-zinc-800 px-2 py-2 text-left font-semibold text-slate-700 dark:text-zinc-200"
              style={{ ...stickyStyle(FLAGS_COL_KEY, true, HEADER_BG), ...colWidthStyle(FLAGS_COL_KEY) }}
            >
              <div className="flex items-center justify-between gap-1.5">
                <span>Flags</span>
                <div className="flex items-center gap-0.5 shrink-0">
                  {sortKey === FLAGS_COL_KEY && sortDir && (
                    <svg className="h-3 w-3 text-slate-700 dark:text-zinc-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      {sortDir === "asc" ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /> : <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />}
                    </svg>
                  )}
                  <button
                    type="button"
                    aria-label="Sort Flags"
                    aria-haspopup="menu"
                    aria-expanded={openMenu === FLAGS_COL_KEY}
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-200 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 hover:text-slate-900"
                    onClick={() => setOpenMenu(openMenu === FLAGS_COL_KEY ? null : FLAGS_COL_KEY)}
                  >
                    <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              </div>
              {openMenu === FLAGS_COL_KEY && (
                <div ref={menuRef} role="menu" aria-label="Sort Flags" className="absolute left-0 top-full z-30 min-w-44 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 py-1 text-xs font-normal shadow-lg dark:text-zinc-200">
                  {menuFor("flags", FLAGS_COL_KEY).map((o) => (
                    <button
                      key={o.dir}
                      type="button"
                      role="menuitemradio"
                      aria-checked={sortKey === FLAGS_COL_KEY && sortDir === o.dir}
                      className={`block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-700 ${sortKey === FLAGS_COL_KEY && sortDir === o.dir ? "font-bold text-slate-900 dark:text-white" : ""}`}
                      onClick={() => { onSort(FLAGS_COL_KEY, o.dir); setOpenMenu(null); }}
                    >
                      {o.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={sortKey !== FLAGS_COL_KEY || !sortDir}
                    className="block w-full px-3 py-1.5 text-left text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700"
                    onClick={() => { onSort(FLAGS_COL_KEY, null); setOpenMenu(null); }}
                  >
                    Clear sort
                  </button>
                  {freezeMenu(FLAGS_COL_KEY)}
                  {availableFlags && availableFlags.length > 0 && (
                    <div className="border-t border-slate-200 dark:border-zinc-700 pt-1 mt-1">
                      <div className="px-3 py-1 font-semibold text-slate-700 dark:text-zinc-200">Filter by Flag:</div>
                      {availableFlags.map((flag) => {
                        const checked = selectedFlags?.has(flag) ?? false;
                        return (
                          <label
                            key={flag}
                            className="flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-slate-100 dark:hover:bg-zinc-700"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => onToggleFlag?.(flag)}
                              className="rounded border-slate-300 text-indigo-600"
                            />
                            <span>{flag}</span>
                          </label>
                        );
                      })}
                      {selectedFlags && selectedFlags.size > 0 && (
                        <button
                          type="button"
                          className="block w-full px-3 py-1 text-left text-blue-600 dark:text-blue-400 hover:bg-slate-100 dark:hover:bg-zinc-700"
                          onClick={() => onClearFlags?.()}
                        >
                          Clear flag filter
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {/* Excel-style column resize handle: drag the divider. */}
              <span
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize Flags column"
                title="Drag to resize Flags (width is remembered for this session)"
                className="absolute top-0 right-0 h-full w-3 cursor-col-resize touch-none select-none"
                style={{ zIndex: 5 }}
                onPointerDown={(e) => startColResize(e, FLAGS_COL_KEY)}
                onPointerMove={moveColResize}
                onDoubleClick={() => {
                  setColWidths((prev) => {
                    if (!(FLAGS_COL_KEY in prev)) return prev;
                    const next = { ...prev };
                    delete next[FLAGS_COL_KEY];
                    return next;
                  });
                }}
              >
                <span className="absolute top-0 right-0 h-full w-[3px] bg-transparent hover:bg-sky-500" />
              </span>
            </th>
            <th className="border border-slate-200 dark:border-zinc-800 px-2 py-2 w-10"></th>
          </tr>
        </thead>
        <tbody>
          {slice.map((r, i) => {
            const manualH = rowHeights[r.id];
            const liveH = liveRow && liveRow.id === r.id ? liveRow.h : undefined;
            const rowH = liveH ?? manualH;
            return (
            <tr
              key={r.id}
              data-fill-row={r.id}
              data-row={r.id}
              className={`border-t border-slate-200 dark:border-zinc-800/80 ${!r.matched ? "bg-red-50/70 dark:bg-red-950/20" : ""}`}
              style={{ background: rowBgOf(r), ...(rowH ? { height: rowH } : {}) }}
            >
              <td
                className="relative border border-slate-200 dark:border-zinc-800 px-1 py-1 text-center"
                style={{ width: ROW_NUM_W, ...gutterStyle("row", false, rowBgOf(r)) }}
              >
                <button
                  type="button"
                  className="w-full cursor-pointer select-none rounded px-1 py-0.5 text-[11px] text-slate-500 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  aria-label={`Select row ${r.cleanedSku || r.rawVendorSku}`}
                  title="Click to select this row — drag or Shift+click to select several"
                  onPointerDown={(e) => onRowNumPointerDown(r, e)}
                  onPointerEnter={() => onRowNumEnter(r)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      anchorIdRef.current = r.id;
                      selectRow(r);
                    }
                  }}
                >
                  {(page - 1) * pageSize + i + 1}
                </button>
                {/* Excel-style row resize handle: drag the line under the row. */}
                <span
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label={`Resize row ${(page - 1) * pageSize + i + 1}`}
                  title="Drag up/down to resize this row (double-click resets; remembered for this session)"
                  className="absolute right-0 bottom-0 left-0 h-2.5 cursor-row-resize touch-none select-none"
                  onPointerDown={(e) => startRowResize(e, r.id)}
                  onPointerMove={moveRowResize}
                  onDoubleClick={() => autoRowHeight(r.id)}
                >
                  <span className="absolute right-0 bottom-0 left-0 h-[3px] bg-transparent hover:bg-sky-500" />
                </span>
              </td>
              <td
                className="border border-slate-200 dark:border-zinc-800 px-2 py-1 text-center"
                style={{ width: CHECK_W, ...gutterStyle("check", false, rowBgOf(r)) }}
              >
                <input
                  type="checkbox"
                  aria-label={`Select row ${r.cleanedSku || r.rawVendorSku}`}
                  checked={selected.has(r.id)}
                  onChange={() => onToggle(r)}
                />
              </td>
              {COLS.map((c) => {
                const v = ((r as unknown as Record<string, string | null>)[c.key] ?? "") as string;
                const isNum = c.kind === "number";
                const isSku = c.key === "rawVendorSku" || c.key === "cleanedSku" || c.key === "productNumber";
                if (c.editable) {
                  // Notes open the Markdown editor popup instead of an inline
                  // input; everything else keeps its existing inline editor.
                  if (c.key === "notes") {
                    const wrap = wrappedNow(c.key);
                    return (
                      <td
                        key={c.label}
                        data-col={c.key}
                        className={`relative border border-slate-200 dark:border-zinc-800 bg-emerald-50/30 dark:bg-emerald-950/20 px-1 py-0.5 ${wrap ? "" : "max-w-56"}`}
                        style={{ ...stickyStyle(c.key, false, EDITABLE_BG), ...colWidthStyle(c.key) }}
                      >
                        <button
                          type="button"
                          className="block w-full px-1 py-1 text-left outline-none rounded hover:bg-white dark:hover:bg-zinc-800 focus:bg-white dark:focus:bg-zinc-800 transition-colors"
                          title={v ? "Open note (Markdown) — Wrap Text shows more inline; widen/resize for a bigger preview" : "Add note (Markdown)"}
                          aria-label={`Notes for ${r.cleanedSku || r.rawVendorSku}${v ? `: ${markdownExcerpt(v, 80)}` : " (empty)"}`}
                          onClick={() => onOpenNotes?.(r)}
                        >
                          {v ? (
                            wrap ? (
                              // Wrapped: full rendered Markdown (headings, lists,
                              // tables) grows with column width + row height.
                              <MarkdownDoc source={v} />
                            ) : (
                              <MarkdownDoc source={v} compact />
                            )
                          ) : (
                            <span className="text-[11px] font-medium text-slate-400 dark:text-zinc-500 hover:text-slate-600 dark:hover:text-zinc-300">
                              + Note
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  }
                  const rowIdx = slice.findIndex((x) => x.id === r.id);
                  const inFill = fill && fill.key === c.key && (() => {
                    const from = slice.findIndex((x) => x.id === fill.rowId);
                    const to = fill.endId ? slice.findIndex((x) => x.id === fill.endId) : from;
                    if (from < 0) return false;
                    const lo = Math.min(from, to < 0 ? from : to);
                    const hi = Math.max(from, to < 0 ? from : to);
                    return rowIdx >= lo && rowIdx <= hi && rowIdx !== from;
                  })();
                  const customN9 = c.key === "nearest9" && !!r.nearest9Custom;
                  const wrap = wrappedNow(c.key);
                  // Discount cells offer "restore default" (clearing the cell
                  // also restores it — same pattern as clearing Custom Nearest 9).
                  const canRestore = c.key === "discount" && !!onRestoreDiscount;
                  return (
                    <td
                      key={c.label}
                      data-col={c.key}
                      className={`relative border border-slate-200 dark:border-zinc-800 px-1 py-0.5${wrapClassOf(c.key)} ${
                        inFill
                          ? "bg-sky-100 dark:bg-sky-950/40"
                          : customN9
                            ? "bg-amber-50 dark:bg-amber-950/30"
                            : "bg-emerald-50/30 dark:bg-emerald-950/20"
                      }`}
                      style={{ ...stickyStyle(c.key, false, inFill ? FILL_BG : customN9 ? CUSTOM_BG : EDITABLE_BG), ...colWidthStyle(c.key) }}
                      onContextMenu={canRestore ? (e) => { e.preventDefault(); onRestoreDiscount?.(r); } : undefined}
                      title={canRestore ? "Edit the discount, clear it to restore the configured Vendor/Brand default, or right-click to restore the default" : undefined}
                    >
                      {wrap ? (
                        <textarea
                          className={`w-full min-w-24 bg-transparent px-1.5 py-1 text-slate-900 dark:text-zinc-100 outline-none focus:bg-white dark:focus:bg-zinc-800 rounded ${
                            isNum ? "text-right font-mono tabular-nums" : isSku ? "font-mono text-[11px]" : ""
                          }`}
                          style={{ fieldSizing: "content" } as CSSProperties}
                          rows={1}
                          defaultValue={v ?? ""}
                          key={`${r.id}-${c.key}-${v}`}
                          onBlur={(e) => { if (e.target.value !== (v ?? "")) onEdit(r, c.key, e.target.value); }}
                          title={c.key === "nearest9"
                            ? (customN9
                              ? "Custom Nearest 9 — clear this cell to go back to the calculated value"
                              : "Nearest 9 is calculated automatically — type a price to override it")
                            : undefined}
                          aria-label={`${c.label} for ${r.cleanedSku || r.rawVendorSku}`}
                        />
                      ) : (
                        <input
                          className={`w-full min-w-24 bg-transparent px-1.5 py-1 text-slate-900 dark:text-zinc-100 outline-none focus:bg-white dark:focus:bg-zinc-800 rounded ${
                            isNum ? "text-right font-mono tabular-nums" : isSku ? "font-mono text-[11px]" : ""
                          }`}
                          defaultValue={v ?? ""}
                          key={`${r.id}-${c.key}-${v}`}
                          onBlur={(e) => { if (e.target.value !== (v ?? "")) onEdit(r, c.key, e.target.value); }}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          title={c.key === "nearest9"
                            ? (customN9
                              ? "Custom Nearest 9 — clear this cell to go back to the calculated value"
                              : "Nearest 9 is calculated automatically — type a price to override it")
                            : undefined}
                          aria-label={`${c.label} for ${r.cleanedSku || r.rawVendorSku}`}
                        />
                      )}
                      {customN9 && (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute right-0.5 top-0.5 rounded bg-amber-400/90 dark:bg-amber-500/80 px-1 text-[9px] font-bold leading-tight text-amber-950"
                        >
                          custom
                        </span>
                      )}
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Fill ${c.label} down from ${r.cleanedSku || r.rawVendorSku}`}
                        title="Drag down to copy this value to rows below"
                        className="absolute right-0.5 bottom-0.5 h-2.5 w-2.5 cursor-ns-resize rounded-[2px] border border-emerald-700 bg-emerald-500"
                        onPointerDown={(e) => {
                          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                          dragRef.current = { rowId: r.id, key: c.key, startY: e.clientY, currentY: e.clientY };
                          // Read the LIVE editor value (uncontrolled input):
                          // the rendered `v` is stale when the user just typed
                          // without blurring first. Same for wrapped textareas.
                          const cell = (e.target as HTMLElement).closest("td");
                          const live = cell?.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null;
                          setFill({ rowId: r.id, key: c.key, value: live?.value ?? v ?? "", endId: r.id });
                          e.preventDefault();
                        }}
                        onPointerMove={(e) => {
                          const d = dragRef.current;
                          if (!d || d.rowId !== r.id || d.key !== c.key || !listRef.current) return;
                          d.currentY = e.clientY;
                          const els = [...listRef.current.querySelectorAll<HTMLElement>("[data-fill-row]")];
                          let best: string | null = d.rowId;
                          for (const el of els) {
                            const rect = el.getBoundingClientRect();
                            if (e.clientY >= rect.top - 4) best = el.dataset.fillRow ?? null;
                          }
                          setFill((f) => (f ? { ...f, endId: best } : f));
                          forceTick((t) => t + 1);
                        }}
                        onPointerUp={() => {
                          dragRef.current = null;
                          setFill((f) => {
                            if (!f || !listRef.current) return null;
                            const from = slice.findIndex((x) => x.id === f.rowId);
                            const to = f.endId ? slice.findIndex((x) => x.id === f.endId) : from;
                            if (from < 0 || to < 0) return null;
                            const lo = Math.min(from, to);
                            const hi = Math.max(from, to);
                            const targets = slice.slice(lo, hi + 1).filter((x) => x.id !== f.rowId).map((x) => x.id);
                            // Re-read the source editor at drop time: the drag
                            // starts with pointerdown (no blur), so the typed
                            // value may still live only in the DOM input. Scope
                            // to this column's cell — a row-level query would
                            // hit the selection checkbox first.
                            const srcCell = listRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(f.rowId)}"] td[data-col="${CSS.escape(f.key)}"]`);
                            const srcInput = srcCell?.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null;
                            const liveValue = srcInput?.value ?? f.value;
                            if (targets.length) onFillDown(r, f.key, liveValue, targets);
                            return null;
                          });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            const idx = slice.findIndex((x) => x.id === r.id);
                            const targets = slice.slice(idx + 1, idx + 6).map((x) => x.id);
                            // Keyboard fill: same live-value re-read (focus is
                            // on the handle, so the input never blurred).
                            const cell = (e.target as HTMLElement).closest("td");
                            const live = cell?.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null;
                            const liveValue = live?.value ?? v ?? "";
                            if (targets.length) onFillDown(r, c.key, liveValue, targets);
                            else onFillDown(r, c.key, liveValue, []);
                          }
                        }}
                      />
                    </td>
                  );
                }
                const wrap = wrappedNow(c.key);
                return (
                  <td
                    key={c.label}
                    data-col={c.key}
                    className={`border border-slate-200 dark:border-zinc-800 px-2 py-1 text-slate-800 dark:text-zinc-200 ${
                      isNum ? "text-right font-mono tabular-nums" : isSku ? "font-mono text-[11px]" : ""
                    }${wrapClassOf(c.key)}`}
                    style={{
                      ...stickyStyle(c.key, false, rowBgOf(r)),
                      ...colWidthStyle(c.key),
                      ...(wrap ? { whiteSpace: "normal", overflowWrap: "anywhere" } as CSSProperties : {}),
                    }}
                  >
                    {v ?? ""}
                  </td>
                );
              })}
              <td
                data-col={FLAGS_COL_KEY}
                className={`border border-slate-200 dark:border-zinc-800 px-2 py-1${wrapClassOf(FLAGS_COL_KEY)}`}
                style={{ ...stickyStyle(FLAGS_COL_KEY, false, rowBgOf(r)), ...colWidthStyle(FLAGS_COL_KEY) }}
              >
                <Flags r={r} />
              </td>
              <td className="border border-slate-200 dark:border-zinc-800 px-1.5 py-1 text-center">
                <button
                  type="button"
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:text-zinc-500 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors"
                  onClick={() => onDelete(r)}
                  aria-label={`Delete row ${r.cleanedSku || r.rawVendorSku}`}
                  title="Delete row"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
