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

/** Freezable headers in display order: every data column, then Flags. */
export const FREEZE_KEYS: string[] = [...COLS.map((c) => c.key), FLAGS_COL_KEY];

/** Fixed widths of the always-sticky row-number / checkbox gutter columns. */
const ROW_NUM_W = 48;
const CHECK_W = 36;
/** headRefs keys for the two gutter columns. */
const ROW_NUM_KEY = "__rownum";
const CHECK_KEY = "__checkbox";
/** Right-edge shadow marking the last sticky column. */
const EDGE_SHADOW = "4px 0 6px -5px rgba(15,23,42,0.65)";
const HEADER_BG = "#f1f5f9"; // matches <thead className="bg-slate-100">
const WHITE_BG = "#ffffff";
const UNMATCHED_BG = "#fef2f2"; // matches bg-red-50 on unmatched rows
const SELECTED_BG = "#e0f2fe"; // sky-100, matches the selected-row highlight

/** useLayoutEffect that is safe in client components rendered by the server. */
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function sameWidths(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}

export function Flags({ r }: { r: Item }) {
  return (
    <span className="whitespace-nowrap">
      {!r.matched && <span className="mr-1 rounded bg-red-600 px-1.5 py-0.5 text-white">Not Found</span>}
      {r.isInactive && <span className="mr-1 rounded bg-amber-200 px-1.5 py-0.5">Inactive</span>}
      {r.cleanedOverridden && <span className="mr-1 rounded bg-blue-100 px-1.5 py-0.5">Manual SKU</span>}
      {!!r.nearest9Custom && String(r.nearest9Custom).trim() !== "" && (
        <span className="mr-1 rounded bg-violet-100 px-1.5 py-0.5">Custom</span>
      )}
      {r.matched && r.nearest9 && r.oldRetailPrice && r.nearest9 !== r.oldRetailPrice && <span className="rounded bg-emerald-100 px-1.5 py-0.5">Changed</span>}
      {r.matched && r.nearest9 && r.oldRetailPrice && r.nearest9 === r.oldRetailPrice && <span className="text-slate-400">No change</span>}
    </span>
  );
}

export function PriceGrid({ rows, page, pageSize, onEdit, onDelete, selected, onToggle, onToggleAll, sortKey, sortDir, onSort, onFillDown, onOpenNotes, layoutKey }: {
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
  /**
   * Session-only layout memory key (e.g. the price-update id). When provided,
   * column widths, row heights, Wrap Text, and frozen columns are remembered
   * in sessionStorage for the current session. Business data is untouched.
   */
  layoutKey?: string;
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

  /** Fixed-width style for a user-resized column (applied to <th> and <td>). */
  const colWidthStyle = (key: string): CSSProperties => {
    if (liveCol && liveCol.key === key) {
      return { width: liveCol.w, minWidth: liveCol.w, maxWidth: liveCol.w };
    }
    // Only pin columns the user actually resized; every other column keeps
    // its natural auto width, exactly as before.
    if (key in colWidths) {
      const w = colWidths[key];
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
    const cls = "block w-full px-3 py-1.5 text-left hover:bg-slate-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";
    return (
      <>
        <div className="my-1 border-t border-slate-200" />
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
        <div className="my-1 border-t border-slate-200" />
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
          {wrapOn ? "✓ Wrap Text" : "Wrap Text"}
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
    <div ref={listRef} className="overflow-auto rounded-xl border bg-white" style={{ maxHeight: "65vh" }}>
      <table className="w-full min-w-[1800px] border-collapse text-xs">
        <thead className="sticky top-0 bg-slate-100" style={{ zIndex: 20 }}>
          <tr>
            <th
              ref={(el) => { headRefs.current[ROW_NUM_KEY] = el; }}
              className="border px-1 py-2 text-center text-[10px] font-normal text-slate-400"
              style={{ width: ROW_NUM_W, ...gutterStyle("row", true, HEADER_BG) }}
              title="Row number — click a row number to select that row"
            >
              #
            </th>
            <th
              ref={(el) => { headRefs.current[CHECK_KEY] = el; }}
              className="border px-2 py-2"
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
              return (
                <th
                  key={c.label}
                  data-col={c.key}
                  ref={(el) => { headRefs.current[c.key] = el; }}
                  className={`relative border px-2 py-2 text-left font-semibold ${c.editable ? "bg-emerald-50" : ""}`}
                  style={{ ...stickyStyle(c.key, true, c.editable ? "#ecfdf5" : HEADER_BG), ...colWidthStyle(c.key) }}
                >
                  <span className="inline-flex items-center gap-1">
                    <span>{c.label}{c.editable ? " ✎" : ""}</span>
                    {active && sortDir && <span aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span>}
                    <button
                      type="button"
                      aria-label={`Sort ${c.label}`}
                      aria-haspopup="menu"
                      aria-expanded={openMenu === c.key}
                      className="rounded px-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                      onClick={() => setOpenMenu(openMenu === c.key ? null : c.key)}
                    >
                      ▾
                    </button>
                  </span>
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
                    <div ref={menuRef} role="menu" aria-label={`Sort ${c.label}`} className="absolute left-0 top-full z-30 min-w-44 rounded-lg border bg-white py-1 text-xs font-normal shadow-lg">
                      {menuFor(c.kind, c.key).map((o) => (
                        <button
                          key={o.dir}
                          type="button"
                          role="menuitemradio"
                          aria-checked={active && sortDir === o.dir}
                          className={`block w-full px-3 py-1.5 text-left hover:bg-slate-100 ${active && sortDir === o.dir ? "font-bold" : ""}`}
                          onClick={() => { onSort(c.key as SortableItemKey, o.dir); setOpenMenu(null); }}
                        >
                          {o.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={!active || !sortDir}
                        className="block w-full px-3 py-1.5 text-left text-slate-500 hover:bg-slate-100"
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
              className="relative border px-2 py-2 text-left font-semibold"
              style={{ ...stickyStyle(FLAGS_COL_KEY, true, HEADER_BG), ...colWidthStyle(FLAGS_COL_KEY) }}
            >
              <span className="inline-flex items-center gap-1">
                <span>Flags</span>
                {sortKey === FLAGS_COL_KEY && sortDir && <span aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span>}
                <button
                  type="button"
                  aria-label="Sort Flags"
                  aria-haspopup="menu"
                  aria-expanded={openMenu === FLAGS_COL_KEY}
                  className="rounded px-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                  onClick={() => setOpenMenu(openMenu === FLAGS_COL_KEY ? null : FLAGS_COL_KEY)}
                >
                  ▾
                </button>
              </span>
              {openMenu === FLAGS_COL_KEY && (
                <div ref={menuRef} role="menu" aria-label="Sort Flags" className="absolute left-0 top-full z-30 min-w-44 rounded-lg border bg-white py-1 text-xs font-normal shadow-lg">
                  {menuFor("flags", FLAGS_COL_KEY).map((o) => (
                    <button
                      key={o.dir}
                      type="button"
                      role="menuitemradio"
                      aria-checked={sortKey === FLAGS_COL_KEY && sortDir === o.dir}
                      className={`block w-full px-3 py-1.5 text-left hover:bg-slate-100 ${sortKey === FLAGS_COL_KEY && sortDir === o.dir ? "font-bold" : ""}`}
                      onClick={() => { onSort(FLAGS_COL_KEY, o.dir); setOpenMenu(null); }}
                    >
                      {o.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={sortKey !== FLAGS_COL_KEY || !sortDir}
                    className="block w-full px-3 py-1.5 text-left text-slate-500 hover:bg-slate-100"
                    onClick={() => { onSort(FLAGS_COL_KEY, null); setOpenMenu(null); }}
                  >
                    Clear sort
                  </button>
                  {freezeMenu(FLAGS_COL_KEY)}
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
            <th className="border px-2 py-2"></th>
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
              className={`border-t ${!r.matched ? "bg-red-50" : ""}`}
              style={{ background: rowBgOf(r), ...(rowH ? { height: rowH } : {}) }}
            >
              <td
                className="relative border px-1 py-1 text-center"
                style={{ width: ROW_NUM_W, ...gutterStyle("row", false, rowBgOf(r)) }}
              >
                <button
                  type="button"
                  className="w-full cursor-pointer select-none rounded px-1 py-0.5 text-[11px] text-slate-500 hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
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
                className="border px-2 py-1 text-center"
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
                if (c.editable) {
                  // Notes open the Markdown editor popup instead of an inline
                  // input; everything else keeps its existing inline editor.
                  if (c.key === "notes") {
                    const wrap = wrappedNow(c.key);
                    return (
                      <td
                        key={c.label}
                        data-col={c.key}
                        className={`relative border bg-emerald-50/40 px-1 py-0.5 ${wrap ? "" : "max-w-56"}`}
                        style={{ ...stickyStyle(c.key, false, "#ecfdf5"), ...colWidthStyle(c.key) }}
                      >
                        <button
                          type="button"
                          className="block w-full px-1 py-1 text-left outline-none hover:bg-white focus:bg-white"
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
                            <span className="text-slate-300">＋ note</span>
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
                  return (
                    <td
                      key={c.label}
                      data-col={c.key}
                      className={`relative border px-1 py-0.5${wrapClassOf(c.key)} ${inFill ? "bg-blue-100" : customN9 ? "bg-amber-50" : "bg-emerald-50/40"}`}
                      style={{ ...stickyStyle(c.key, false, inFill ? "#dbeafe" : customN9 ? "#fffbeb" : "#ecfdf5"), ...colWidthStyle(c.key) }}
                    >
                      {wrap ? (
                        // Wrapped: multi-line editor that grows with the row.
                        // Same commit path as before (blur saves; Enter adds a
                        // newline, blur/Tab commits) — only presentation changes.
                        <textarea
                          className="w-full min-w-24 bg-transparent px-1 py-1 pr-4 outline-none focus:bg-white"
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
                        className="w-full min-w-24 bg-transparent px-1 py-1 pr-4 outline-none focus:bg-white"
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
                          className="pointer-events-none absolute right-0.5 top-0.5 rounded bg-amber-400 px-1 text-[9px] font-bold leading-tight text-amber-950"
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
                          setFill({ rowId: r.id, key: c.key, value: v ?? "", endId: r.id });
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
                            if (targets.length) onFillDown(r, f.key, f.value, targets);
                            return null;
                          });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            const idx = slice.findIndex((x) => x.id === r.id);
                            const targets = slice.slice(idx + 1, idx + 6).map((x) => x.id);
                            if (targets.length) onFillDown(r, c.key, v ?? "", targets);
                            else onFillDown(r, c.key, v ?? "", []);
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
                    className={`border px-2 py-1${wrapClassOf(c.key)}`}
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
                className={`border px-2 py-1${wrapClassOf(FLAGS_COL_KEY)}`}
                style={{ ...stickyStyle(FLAGS_COL_KEY, false, rowBgOf(r)), ...colWidthStyle(FLAGS_COL_KEY) }}
              >
                <Flags r={r} />
              </td>
              <td className="border px-2 py-1"><button className="text-red-600" onClick={() => onDelete(r)}>✕</button></td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
