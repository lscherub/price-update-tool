"use client";

import { useEffect, useRef, useState } from "react";
import type { SortableItemKey } from "@/lib/itemSort";
import { SPREADSHEET_COL_MAP, SPREADSHEET_COLS } from "@/lib/spreadsheet/engine";
import type {
  ColumnFilterSpec,
  ExpandedQuickFilters,
  RowDensity,
  SaveQueueSnapshot,
  SortRule,
  TriStateFilter,
} from "@/lib/spreadsheet/types";

type PopoverKind = "filters" | "sort" | "columns" | "freeze" | null;

function describeColumnFilter(key: SortableItemKey, spec: ColumnFilterSpec): string {
  const label = SPREADSHEET_COL_MAP.get(key)?.shortLabel ?? key;
  if (spec.kind === "flags") return `${label}: ${spec.values.join(", ")}`;
  if (spec.op === "blank") return `${label}: Blank`;
  if (spec.op === "nonBlank") return `${label}: Nonblank`;
  if (spec.kind === "number" && spec.op === "between") {
    return `${label}: ${spec.value || "…"}–${spec.valueTo || "…"}`;
  }
  const opMap: Record<string, string> = {
    contains: "contains",
    notContains: "not contains",
    equals: "=",
    notEquals: "≠",
    beginsWith: "starts with",
    endsWith: "ends with",
    gt: ">",
    gte: "≥",
    lt: "<",
    lte: "≤",
    eq: "=",
  };
  return `${label} ${opMap[spec.op] ?? spec.op} ${spec.value}`;
}

export function SpreadsheetToolbar({
  globalQuery,
  onGlobalQueryChange,
  quickFilters,
  onQuickFiltersChange,
  columnFilters,
  onClearColumnFilter,
  onClearAllFilters,
  sortRules,
  onSortRulesChange,
  columnVisibility,
  onToggleColumnVisibility,
  onShowAllColumns,
  onAutoFitAllColumns,
  onResetLayout,
  pinnedColumns,
  pinnedRowCount,
  onUnfreezeAll,
  onFreezeTopN,
  onPinSelectedRows,
  selectedRowCount,
  selectedCellCount,
  selectionStats,
  onOpenBulkEdit,
  density,
  onDensityChange,
  isFullscreen,
  onToggleFullscreen,
  saveStatus,
  onFlushNow,
  onRetryFailed,
  visibleRowCount,
  totalRowCount,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  undoTooltip,
  redoTooltip,
  onAddRow,
  onBulkAdd,
  onOpenSetLower,
  lowerCount,
  onOpenDeleteSelected,
}: {
  globalQuery: string;
  onGlobalQueryChange: (q: string) => void;
  quickFilters: ExpandedQuickFilters;
  onQuickFiltersChange: (next: ExpandedQuickFilters) => void;
  columnFilters: Record<string, ColumnFilterSpec>;
  onClearColumnFilter: (key: SortableItemKey) => void;
  onClearAllFilters: () => void;
  sortRules: SortRule[];
  onSortRulesChange: (next: SortRule[]) => void;
  columnVisibility: Record<string, boolean>;
  onToggleColumnVisibility: (key: SortableItemKey) => void;
  onShowAllColumns: () => void;
  onAutoFitAllColumns: () => void;
  onResetLayout: () => void;
  pinnedColumns: SortableItemKey[];
  pinnedRowCount: number;
  onUnfreezeAll: () => void;
  onFreezeTopN: (n: number) => void;
  onPinSelectedRows: () => void;
  selectedRowCount: number;
  selectedCellCount: number;
  selectionStats: { count: number; numericCount: number; sum: number; avg: number } | null;
  onOpenBulkEdit: () => void;
  density: RowDensity;
  onDensityChange: (d: RowDensity) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  saveStatus: SaveQueueSnapshot;
  onFlushNow: () => void;
  onRetryFailed: () => void;
  visibleRowCount: number;
  totalRowCount: number;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  undoTooltip?: string;
  redoTooltip?: string;
  onAddRow?: () => void;
  onBulkAdd?: () => void;
  onOpenSetLower?: () => void;
  lowerCount?: number;
  onOpenDeleteSelected?: () => void;
}) {
  const [openPop, setOpenPop] = useState<PopoverKind>(null);
  const popAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openPop) return;
    const onDown = (e: MouseEvent) => {
      if (popAreaRef.current && !popAreaRef.current.contains(e.target as Node)) setOpenPop(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenPop(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openPop]);

  const activeQuickCount =
    (quickFilters.vendorPrice !== "all" ? 1 : 0) +
    (quickFilters.discount !== "all" ? 1 : 0) +
    (quickFilters.newRetail !== "all" ? 1 : 0) +
    (quickFilters.customOverride !== "all" ? 1 : 0) +
    (quickFilters.priceChanged !== "all" ? 1 : 0);

  const colFilterEntries = Object.entries(columnFilters) as [SortableItemKey, ColumnFilterSpec][];
  const hiddenColCount = SPREADSHEET_COLS.filter((c) => columnVisibility[c.key] === false).length;
  const totalFrozen = pinnedColumns.length + pinnedRowCount;

  const setTri = (field: keyof Omit<ExpandedQuickFilters, "legacyFilter">, val: TriStateFilter) => {
    onQuickFiltersChange({ ...quickFilters, [field]: val });
  };

  const quickChips: { label: string; clear: () => void }[] = [];
  if (quickFilters.vendorPrice !== "all") {
    quickChips.push({
      label: quickFilters.vendorPrice === "yes" ? "Vendor Price: Present" : "Vendor Price: Missing",
      clear: () => setTri("vendorPrice", "all"),
    });
  }
  if (quickFilters.discount !== "all") {
    quickChips.push({
      label: quickFilters.discount === "yes" ? "Discount: Present (>0%)" : "Discount: Missing (0%)",
      clear: () => setTri("discount", "all"),
    });
  }
  if (quickFilters.newRetail !== "all") {
    quickChips.push({
      label: quickFilters.newRetail === "yes" ? "New Retail: Present" : "New Retail: Missing",
      clear: () => setTri("newRetail", "all"),
    });
  }
  if (quickFilters.customOverride !== "all") {
    quickChips.push({
      label: quickFilters.customOverride === "yes" ? "Custom Override: Yes" : "Custom Override: No",
      clear: () => setTri("customOverride", "all"),
    });
  }
  if (quickFilters.priceChanged !== "all") {
    quickChips.push({
      label: quickFilters.priceChanged === "yes" ? "Price Changed: Yes" : "Price Changed: No",
      clear: () => setTri("priceChanged", "all"),
    });
  }

  const hasChipsRow = sortRules.length > 0 || colFilterEntries.length > 0 || quickChips.length > 0;
  const bulkTargetCount = selectedRowCount > 0 ? selectedRowCount : selectedCellCount;

  const btnCls =
    "h-8 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-700 transition-colors";
  const activeBtnCls =
    "h-8 inline-flex items-center gap-1.5 rounded-lg border border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 px-2.5 text-xs font-semibold text-indigo-800 dark:text-indigo-200 transition-colors";

  return (
    <div ref={popAreaRef} className="flex flex-col border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      {/* Row 1: Primary Compact Spreadsheet Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        {/* Left: Add / History / Search / Filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          {isFullscreen && onAddRow && (
            <>
              <button
                type="button"
                onClick={onAddRow}
                className="h-8 rounded-lg bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                + Row
              </button>
              {onBulkAdd && (
                <button
                  type="button"
                  onClick={onBulkAdd}
                  className="h-8 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 px-2.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100"
                >
                  Bulk Add
                </button>
              )}
              {onUndo && onRedo && (
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 divide-x divide-slate-200 dark:divide-zinc-700">
                  <button
                    type="button"
                    disabled={!canUndo}
                    onClick={onUndo}
                    title={undoTooltip || "Undo (Ctrl/Cmd+Z)"}
                    className="h-8 px-2 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-700 disabled:opacity-40"
                  >
                    ↶
                  </button>
                  <button
                    type="button"
                    disabled={!canRedo}
                    onClick={onRedo}
                    title={redoTooltip || "Redo (Ctrl/Cmd+Shift+Z)"}
                    className="h-8 px-2 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-700 disabled:opacity-40"
                  >
                    ↷
                  </button>
                </div>
              )}
            </>
          )}

          {/* Global Search */}
          <div className="relative w-52 sm:w-64">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-slate-400">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              type="text"
              value={globalQuery}
              onChange={(e) => onGlobalQueryChange(e.target.value)}
              placeholder="Global search (SKU, name, brand...)"
              className="h-8 w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50/60 dark:bg-zinc-800/60 pl-8 pr-7 text-xs text-slate-800 dark:text-zinc-100 placeholder-slate-400 focus:border-indigo-500 focus:bg-white dark:focus:bg-zinc-800 focus:outline-none"
            />
            {globalQuery && (
              <button
                type="button"
                onClick={() => onGlobalQueryChange("")}
                aria-label="Clear global search"
                className="absolute inset-y-0 right-1.5 flex items-center text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            )}
          </div>

          {/* Existing Legacy Status Filter Dropdown */}
          <select
            aria-label="Status filter"
            value={quickFilters.legacyFilter}
            onChange={(e) => onQuickFiltersChange({ ...quickFilters, legacyFilter: e.target.value })}
            className="h-8 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 text-xs font-medium text-slate-700 dark:text-zinc-200 focus:border-indigo-500 focus:outline-none"
          >
            <option value="all">All rows</option>
            <option value="unmatched">Unmatched</option>
            <option value="notfound">Not Found</option>
            <option value="changed">Price Changed</option>
            <option value="inactive">Inactive</option>
            <option value="missing">Vendor price missing</option>
            <option value="custom">Custom</option>
          </select>

          {/* Expanded Quick Filters Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenPop(openPop === "filters" ? null : "filters")}
              className={activeQuickCount > 0 ? activeBtnCls : btnCls}
            >
              <span>Filters</span>
              {activeQuickCount > 0 && (
                <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white">
                  {activeQuickCount}
                </span>
              )}
            </button>
            {openPop === "filters" && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 shadow-2xl text-xs">
                <div className="mb-2 flex items-center justify-between border-b border-slate-100 dark:border-zinc-800 pb-2">
                  <span className="font-bold text-slate-900 dark:text-white">Quick Data Filters</span>
                  <button
                    type="button"
                    onClick={() => { onClearAllFilters(); setOpenPop(null); }}
                    className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Clear all
                  </button>
                </div>
                <div className="flex flex-col gap-2.5">
                  {(
                    [
                      { key: "vendorPrice", label: "Vendor List Price", yes: "Present", no: "Missing" },
                      { key: "discount", label: "Discount (%)", yes: "Present (>0%)", no: "Missing (0%)" },
                      { key: "newRetail", label: "New Retail Price", yes: "Present", no: "Missing" },
                      { key: "customOverride", label: "Custom Nearest 9", yes: "With Custom", no: "Without Custom" },
                      { key: "priceChanged", label: "Price Changed", yes: "Changed", no: "Unchanged" },
                    ] as const
                  ).map((row) => {
                    const cur = quickFilters[row.key];
                    return (
                      <div key={row.key} className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-700 dark:text-zinc-300">{row.label}</span>
                        <div className="inline-flex rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 p-0.5 text-[11px]">
                          {(
                            [
                              { v: "all", l: "All" },
                              { v: "yes", l: row.yes },
                              { v: "no", l: row.no },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.v}
                              type="button"
                              onClick={() => setTri(row.key, opt.v)}
                              className={`rounded-md px-2 py-0.5 font-medium transition-colors ${
                                cur === opt.v
                                  ? "bg-indigo-600 text-white shadow-2xs"
                                  : "text-slate-600 dark:text-zinc-300 hover:text-slate-900"
                              }`}
                            >
                              {opt.l}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Multi-Column Sort Builder Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenPop(openPop === "sort" ? null : "sort")}
              className={sortRules.length > 0 ? activeBtnCls : btnCls}
              title="Multi-column sort (you can also Shift+Click column headers)"
            >
              <span>Sort</span>
              {sortRules.length > 0 && (
                <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white">
                  {sortRules.length}
                </span>
              )}
            </button>
            {openPop === "sort" && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-[360px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 shadow-2xl text-xs">
                <div className="mb-2 flex items-center justify-between border-b border-slate-100 dark:border-zinc-800 pb-2">
                  <div>
                    <span className="font-bold text-slate-900 dark:text-white">Multi-Column Sort</span>
                    <p className="text-[11px] text-slate-400">Tip: Shift+Click headers to add sort levels.</p>
                  </div>
                  {sortRules.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onSortRulesChange([])}
                      className="text-[11px] font-semibold text-red-600 dark:text-red-400 hover:underline"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  {sortRules.length === 0 ? (
                    <p className="py-2 text-slate-400">No sort levels active. Add one below.</p>
                  ) : (
                    sortRules.map((rule, idx) => (
                      <div key={`${rule.id}-${idx}`} className="flex items-center gap-1.5">
                        <span className="w-5 text-center font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                          {idx + 1}.
                        </span>
                        <select
                          value={rule.id}
                          onChange={(e) => {
                            const next = [...sortRules];
                            next[idx] = { ...rule, id: e.target.value as SortableItemKey };
                            onSortRulesChange(next);
                          }}
                          className="h-7 flex-1 rounded-md border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1.5 text-xs"
                        >
                          {SPREADSHEET_COLS.map((c) => (
                            <option key={c.key} value={c.key}>{c.label}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const next = [...sortRules];
                            next[idx] = { ...rule, desc: !rule.desc };
                            onSortRulesChange(next);
                          }}
                          className="h-7 rounded-md border border-slate-200 dark:border-zinc-700 px-2 font-medium hover:bg-slate-50 dark:hover:bg-zinc-800"
                        >
                          {rule.desc ? "Desc ↓" : "Asc ↑"}
                        </button>
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => {
                            const next = [...sortRules];
                            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                            onSortRulesChange(next);
                          }}
                          className="h-7 px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                          title="Move priority up"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          onClick={() => onSortRulesChange(sortRules.filter((_, i) => i !== idx))}
                          className="h-7 px-1 text-slate-400 hover:text-red-600"
                          title="Remove sort level"
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const unused = SPREADSHEET_COLS.find((c) => !sortRules.some((r) => r.id === c.key));
                    if (unused) onSortRulesChange([...sortRules, { id: unused.key, desc: false }]);
                  }}
                  disabled={sortRules.length >= SPREADSHEET_COLS.length}
                  className="mt-2.5 h-7 w-full rounded-lg border border-dashed border-slate-300 dark:border-zinc-700 font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/30 disabled:opacity-40"
                >
                  + Add Sort Level
                </button>
              </div>
            )}
          </div>

          {/* Column Visibility & Layout Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenPop(openPop === "columns" ? null : "columns")}
              className={hiddenColCount > 0 ? activeBtnCls : btnCls}
            >
              <span>Columns</span>
              {hiddenColCount > 0 && (
                <span className="rounded-full bg-slate-200 dark:bg-zinc-700 px-1.5 text-[10px] font-bold">
                  -{hiddenColCount}
                </span>
              )}
            </button>
            {openPop === "columns" && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2.5 shadow-2xl text-xs">
                <div className="mb-1.5 flex items-center justify-between border-b border-slate-100 dark:border-zinc-800 pb-1.5">
                  <span className="font-bold">Show / Hide Columns</span>
                  <button
                    type="button"
                    onClick={onShowAllColumns}
                    className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Show all
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto flex flex-col gap-0.5 py-1">
                  {SPREADSHEET_COLS.map((c) => {
                    const visible = columnVisibility[c.key] !== false;
                    return (
                      <label
                        key={c.key}
                        className="flex cursor-pointer items-center justify-between rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-zinc-800"
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={visible}
                            onChange={() => onToggleColumnVisibility(c.key)}
                            className="rounded border-slate-300 text-indigo-600"
                          />
                          <span className="truncate">{c.label}</span>
                        </span>
                        {c.editable && (
                          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">edit</span>
                        )}
                      </label>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-slate-100 dark:border-zinc-800 pt-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => { onAutoFitAllColumns(); setOpenPop(null); }}
                    className="flex-1 rounded-md border border-slate-200 dark:border-zinc-700 py-1 font-medium hover:bg-slate-50 dark:hover:bg-zinc-800"
                  >
                    Auto-fit widths
                  </button>
                  <button
                    type="button"
                    onClick={() => { onResetLayout(); setOpenPop(null); }}
                    className="rounded-md border border-slate-200 dark:border-zinc-700 px-2 py-1 text-slate-500 hover:bg-slate-50 dark:hover:bg-zinc-800"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Freeze Panes (Columns + Top Rows Simultaneously) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenPop(openPop === "freeze" ? null : "freeze")}
              className={totalFrozen > 0 ? activeBtnCls : btnCls}
            >
              <span>Freeze</span>
              {totalFrozen > 0 && (
                <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white">
                  {pinnedRowCount}R/{pinnedColumns.length}C
                </span>
              )}
            </button>
            {openPop === "freeze" && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2.5 shadow-2xl text-xs">
                <div className="mb-1.5 flex items-center justify-between border-b border-slate-100 dark:border-zinc-800 pb-1.5">
                  <span className="font-bold">Freeze Panes</span>
                  {totalFrozen > 0 && (
                    <button
                      type="button"
                      onClick={() => { onUnfreezeAll(); setOpenPop(null); }}
                      className="text-[11px] font-semibold text-red-600 dark:text-red-400 hover:underline"
                    >
                      Unfreeze all
                    </button>
                  )}
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1 mb-1">
                  Freeze Top Rows (Header Always Frozen)
                </div>
                <div className="grid grid-cols-4 gap-1 mb-2">
                  {[0, 1, 2, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => { onFreezeTopN(n); setOpenPop(null); }}
                      className={`rounded-md border py-1 font-medium ${
                        pinnedRowCount === n
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300"
                          : "border-slate-200 dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {n === 0 ? "None" : `Top ${n}`}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={selectedRowCount === 0}
                  onClick={() => { onPinSelectedRows(); setOpenPop(null); }}
                  className="mb-2 w-full rounded-md border border-slate-200 dark:border-zinc-700 py-1 font-medium hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-40"
                >
                  Freeze checked rows at top ({selectedRowCount})
                </button>
                <div className="text-[11px] text-slate-500 dark:text-zinc-400 border-t border-slate-100 dark:border-zinc-800 pt-2">
                  Frozen columns: <span className="font-semibold text-slate-800 dark:text-zinc-200">{pinnedColumns.length}</span>.
                  Use any column header menu (▾) to freeze individual or multiple columns.
                </div>
              </div>
            )}
          </div>

          {/* Bulk Edit Button */}
          <button
            type="button"
            disabled={bulkTargetCount === 0}
            onClick={onOpenBulkEdit}
            title={
              selectedRowCount > 0
                ? `Bulk edit ${selectedRowCount} checked rows`
                : selectedCellCount > 0
                  ? `Bulk edit rows in current cell selection`
                  : "Select cells or check rows to bulk edit"
            }
            className="h-8 inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/40 px-2.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <span>Bulk Edit</span>
            {bulkTargetCount > 0 && (
              <span className="rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold text-white">
                {selectedRowCount > 0 ? `${selectedRowCount}R` : `${selectedCellCount}C`}
              </span>
            )}
          </button>

          {isFullscreen && onOpenSetLower && onOpenDeleteSelected && (
            <>
              <button
                type="button"
                disabled={selectedRowCount === 0}
                onClick={onOpenSetLower}
                className="h-8 rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50/70 dark:bg-violet-950/40 px-2.5 text-xs font-medium text-violet-800 dark:text-violet-300 disabled:opacity-40"
              >
                Set Lower ({lowerCount ?? 0})
              </button>
              <button
                type="button"
                disabled={selectedRowCount === 0}
                onClick={onOpenDeleteSelected}
                className="h-8 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-2.5 text-xs font-semibold text-red-700 dark:text-red-300 disabled:opacity-40"
              >
                Delete ({selectedRowCount})
              </button>
            </>
          )}
        </div>

        {/* Right: Save Status Indicator + Density + Full-Screen */}
        <div className="flex items-center gap-2">
          {/* Live Persistence Status */}
          <div className="flex items-center gap-1.5">
            {saveStatus.state === "saved" && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                title={saveStatus.lastSavedAt ? `Last saved at ${new Date(saveStatus.lastSavedAt).toLocaleTimeString()}` : "All changes saved"}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Saved
              </span>
            )}
            {(saveStatus.state === "dirty" || saveStatus.state === "saving") && (
              <button
                type="button"
                onClick={onFlushNow}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300"
                title="Click to flush pending edits immediately"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                {saveStatus.state === "saving"
                  ? `Saving ${saveStatus.inFlightCount + saveStatus.pendingCount}...`
                  : `${saveStatus.pendingCount} unsaved`}
              </button>
            )}
            {saveStatus.state === "error" && (
              <button
                type="button"
                onClick={onRetryFailed}
                title={saveStatus.lastError || "Save failed — click to retry"}
                className="inline-flex items-center gap-1.5 rounded-full border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-2.5 py-1 text-[11px] font-bold text-red-700 dark:text-red-300 hover:bg-red-100"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-red-600" />
                {saveStatus.failedCount} failed · Retry
              </button>
            )}
          </div>

          {/* Row Density */}
          <select
            aria-label="Row density"
            value={density}
            onChange={(e) => onDensityChange(e.target.value as RowDensity)}
            className="h-8 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 text-xs text-slate-700 dark:text-zinc-200 focus:outline-none"
            title="Row height density"
          >
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
            <option value="spacious">Spacious</option>
          </select>

          {/* Expand / Full-Screen Workspace */}
          <button
            type="button"
            onClick={onToggleFullscreen}
            className={isFullscreen ? activeBtnCls : btnCls}
            title={isFullscreen ? "Exit full-screen workspace (Esc)" : "Expand to full-screen workspace"}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              {isFullscreen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M15 9h4.5M15 9V4.5M15 9l5.25-5.25M9 15H4.5M9 15v4.5M9 15l-5.25 5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              )}
            </svg>
            <span className="hidden sm:inline">{isFullscreen ? "Exit Full Screen" : "Full Screen"}</span>
          </button>
        </div>
      </div>

      {/* Row 2: Active Sort Priority & Filter Pills + Live Row / Selection Stats */}
      {(hasChipsRow || selectionStats) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-zinc-800/80 bg-slate-50/70 dark:bg-zinc-900/60 px-3 py-1.5 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            {sortRules.map((rule, idx) => (
              <span
                key={`sort-${rule.id}`}
                className="inline-flex items-center gap-1 rounded-full border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 font-medium text-indigo-800 dark:text-indigo-200"
              >
                <span className="font-mono text-[10px] font-bold">{idx + 1}</span>
                <button
                  type="button"
                  onClick={() => {
                    const next = [...sortRules];
                    next[idx] = { ...rule, desc: !rule.desc };
                    onSortRulesChange(next);
                  }}
                  title="Click to toggle ascending/descending"
                  className="hover:underline"
                >
                  {SPREADSHEET_COL_MAP.get(rule.id)?.shortLabel ?? rule.id} {rule.desc ? "↓" : "↑"}
                </button>
                <button
                  type="button"
                  onClick={() => onSortRulesChange(sortRules.filter((_, i) => i !== idx))}
                  aria-label={`Remove sort on ${rule.id}`}
                  className="ml-0.5 text-indigo-400 hover:text-indigo-900 dark:hover:text-white"
                >
                  ×
                </button>
              </span>
            ))}

            {quickChips.map((chip) => (
              <span
                key={chip.label}
                className="inline-flex items-center gap-1 rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 font-medium text-emerald-800 dark:text-emerald-200"
              >
                <span>{chip.label}</span>
                <button type="button" onClick={chip.clear} className="text-emerald-500 hover:text-emerald-900">×</button>
              </span>
            ))}

            {colFilterEntries.map(([key, spec]) => (
              <span
                key={`cf-${key}`}
                className="inline-flex items-center gap-1 rounded-full border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 px-2 py-0.5 font-medium text-sky-800 dark:text-sky-200"
              >
                <span>{describeColumnFilter(key, spec)}</span>
                <button
                  type="button"
                  onClick={() => onClearColumnFilter(key)}
                  aria-label={`Clear filter on ${key}`}
                  className="text-sky-500 hover:text-sky-900"
                >
                  ×
                </button>
              </span>
            ))}

            {(colFilterEntries.length > 0 || quickChips.length > 0 || quickFilters.legacyFilter !== "all") && (
              <button
                type="button"
                onClick={onClearAllFilters}
                className="ml-1 font-semibold text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white underline"
              >
                Clear filters
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px] text-slate-500 dark:text-zinc-400 ml-auto">
            <span>
              Showing <strong className="text-slate-800 dark:text-zinc-200">{visibleRowCount.toLocaleString()}</strong> / {totalRowCount.toLocaleString()}
            </span>
            {selectionStats && selectionStats.count > 1 && (
              <>
                <span>Cells: <strong className="text-slate-800 dark:text-zinc-200">{selectionStats.count}</strong></span>
                {selectionStats.numericCount > 0 && (
                  <>
                    <span>Sum: <strong className="text-slate-800 dark:text-zinc-200">{selectionStats.sum.toFixed(2)}</strong></span>
                    <span>Avg: <strong className="text-slate-800 dark:text-zinc-200">{selectionStats.avg.toFixed(2)}</strong></span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
