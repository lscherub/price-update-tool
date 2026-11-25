"use client";

import { useEffect, useRef, useState } from "react";
import type { SortableItemKey } from "@/lib/itemSort";
import type {
  ColumnFilterSpec,
  NumberFilterOp,
  SortRule,
  SpreadsheetColDef,
  TextFilterOp,
} from "@/lib/spreadsheet/types";

const TEXT_OPS: { value: TextFilterOp; label: string }[] = [
  { value: "contains", label: "Contains" },
  { value: "notContains", label: "Does not contain" },
  { value: "equals", label: "Equals" },
  { value: "notEquals", label: "Does not equal" },
  { value: "beginsWith", label: "Begins with" },
  { value: "endsWith", label: "Ends with" },
  { value: "blank", label: "Blank" },
  { value: "nonBlank", label: "Nonblank" },
];

const NUMBER_OPS: { value: NumberFilterOp; label: string }[] = [
  { value: "gt", label: "Greater than (>)" },
  { value: "gte", label: "Greater than or equal (>=)" },
  { value: "lt", label: "Less than (<)" },
  { value: "lte", label: "Less than or equal (<=)" },
  { value: "eq", label: "Equals (=)" },
  { value: "between", label: "Between" },
  { value: "blank", label: "Blank" },
  { value: "nonBlank", label: "Nonblank" },
];

export type ColumnHeaderMenuProps = {
  col: SpreadsheetColDef;
  anchorRect: DOMRect;
  sortRules: readonly SortRule[];
  currentFilter?: ColumnFilterSpec;
  isPinned: boolean;
  isWrapped: boolean;
  availableFlags: string[];
  flagCounts: Map<string, number>;
  onClose: () => void;
  onSetPrimarySort: (key: SortableItemKey, desc: boolean) => void;
  onAddSecondarySort: (key: SortableItemKey, desc: boolean) => void;
  onRemoveSort: (key: SortableItemKey) => void;
  onSetFilter: (key: SortableItemKey, spec: ColumnFilterSpec | null) => void;
  onTogglePin: (key: SortableItemKey) => void;
  onFreezeUpTo: (key: SortableItemKey) => void;
  onAutoFit: (key: SortableItemKey) => void;
  onToggleWrap: (key: SortableItemKey) => void;
  onHideColumn: (key: SortableItemKey) => void;
};

export function ColumnHeaderMenu({
  col,
  anchorRect,
  sortRules,
  currentFilter,
  isPinned,
  isWrapped,
  availableFlags,
  flagCounts,
  onClose,
  onSetPrimarySort,
  onAddSecondarySort,
  onRemoveSort,
  onSetFilter,
  onTogglePin,
  onFreezeUpTo,
  onAutoFit,
  onToggleWrap,
  onHideColumn,
}: ColumnHeaderMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const existingSortIdx = sortRules.findIndex((r) => r.id === col.key);
  const existingSort = existingSortIdx >= 0 ? sortRules[existingSortIdx] : null;

  const [textOp, setTextOp] = useState<TextFilterOp>(
    currentFilter?.kind === "text" ? currentFilter.op : "contains",
  );
  const [textVal, setTextVal] = useState<string>(
    currentFilter?.kind === "text" ? currentFilter.value : "",
  );

  const [numOp, setNumOp] = useState<NumberFilterOp>(
    currentFilter?.kind === "number" ? currentFilter.op : "gt",
  );
  const [numVal, setNumVal] = useState<string>(
    currentFilter?.kind === "number" ? currentFilter.value : "",
  );
  const [numValTo, setNumValTo] = useState<string>(
    currentFilter?.kind === "number" ? (currentFilter.valueTo ?? "") : "",
  );

  const [flagSet, setFlagSet] = useState<Set<string>>(
    () => new Set(currentFilter?.kind === "flags" ? currentFilter.values : []),
  );

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Clamp popup within viewport
  const menuW = 280;
  const left = typeof window !== "undefined"
    ? Math.max(8, Math.min(anchorRect.left, window.innerWidth - menuW - 12))
    : anchorRect.left;
  const top = typeof window !== "undefined"
    ? Math.min(anchorRect.bottom + 4, window.innerHeight - 420)
    : anchorRect.bottom + 4;

  const applyFilter = () => {
    if (col.kind === "text") {
      if (textOp !== "blank" && textOp !== "nonBlank" && !textVal.trim()) {
        onSetFilter(col.key, null);
      } else {
        onSetFilter(col.key, { kind: "text", op: textOp, value: textVal });
      }
    } else if (col.kind === "number") {
      if (numOp !== "blank" && numOp !== "nonBlank" && !numVal.trim() && !numValTo.trim()) {
        onSetFilter(col.key, null);
      } else {
        onSetFilter(col.key, { kind: "number", op: numOp, value: numVal, valueTo: numValTo });
      }
    } else {
      const vals = [...flagSet];
      onSetFilter(col.key, vals.length ? { kind: "flags", values: vals } : null);
    }
    onClose();
  };

  const isNum = col.kind === "number";
  const ascLabel = isNum ? "Sort Smallest → Largest" : "Sort A → Z";
  const descLabel = isNum ? "Sort Largest → Smallest" : "Sort Z → A";

  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-label={`${col.label} column options`}
      className="fixed z-50 w-[280px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl text-xs text-slate-800 dark:text-zinc-200 overflow-hidden"
      style={{ left, top: Math.max(8, top) }}
    >
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-800/70 px-3 py-2">
        <span className="font-bold truncate">{col.label}</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-200 dark:hover:bg-zinc-700 hover:text-slate-700"
          aria-label="Close column menu"
        >
          ✕
        </button>
      </div>

      <div className="max-h-[72vh] overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800">
        {/* Sorting section */}
        <div className="p-1.5">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
            Sort {existingSort ? `(Priority #${existingSortIdx + 1})` : ""}
          </div>
          <button
            type="button"
            onClick={() => { onSetPrimarySort(col.key, false); onClose(); }}
            className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 ${
              existingSort && !existingSort.desc && existingSortIdx === 0 ? "font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50/60 dark:bg-indigo-950/40" : ""
            }`}
          >
            <span>↑ {ascLabel}</span>
            <span className="text-[10px] text-slate-400">Primary</span>
          </button>
          <button
            type="button"
            onClick={() => { onSetPrimarySort(col.key, true); onClose(); }}
            className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 ${
              existingSort && existingSort.desc && existingSortIdx === 0 ? "font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50/60 dark:bg-indigo-950/40" : ""
            }`}
          >
            <span>↓ {descLabel}</span>
            <span className="text-[10px] text-slate-400">Primary</span>
          </button>
          {sortRules.length > 0 && (
            <div className="mt-0.5 grid grid-cols-2 gap-1 px-1">
              <button
                type="button"
                onClick={() => { onAddSecondarySort(col.key, false); onClose(); }}
                className="rounded-md border border-slate-200 dark:border-zinc-700 px-2 py-1 text-[11px] font-medium hover:bg-slate-100 dark:hover:bg-zinc-800"
                title="Add as next sort level (preserves existing sort rules)"
              >
                + Then Asc ↑
              </button>
              <button
                type="button"
                onClick={() => { onAddSecondarySort(col.key, true); onClose(); }}
                className="rounded-md border border-slate-200 dark:border-zinc-700 px-2 py-1 text-[11px] font-medium hover:bg-slate-100 dark:hover:bg-zinc-800"
                title="Add as next sort level (preserves existing sort rules)"
              >
                + Then Desc ↓
              </button>
            </div>
          )}
          {existingSort && (
            <button
              type="button"
              onClick={() => { onRemoveSort(col.key); onClose(); }}
              className="mt-0.5 block w-full rounded-md px-2 py-1.5 text-left text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              Remove sort on this column
            </button>
          )}
        </div>

        {/* Column Filter section */}
        <div className="p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
              Filter Column
            </span>
            {currentFilter && (
              <button
                type="button"
                onClick={() => { onSetFilter(col.key, null); onClose(); }}
                className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Clear filter
              </button>
            )}
          </div>

          {col.kind === "text" && (
            <div className="flex flex-col gap-2">
              <select
                value={textOp}
                onChange={(e) => setTextOp(e.target.value as TextFilterOp)}
                className="h-8 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 text-xs focus:border-indigo-500 focus:outline-none"
              >
                {TEXT_OPS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {textOp !== "blank" && textOp !== "nonBlank" && (
                <input
                  type="text"
                  value={textVal}
                  onChange={(e) => setTextVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") applyFilter(); }}
                  placeholder="Enter text..."
                  autoFocus
                  className="h-8 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 text-xs focus:border-indigo-500 focus:outline-none"
                />
              )}
              <button
                type="button"
                onClick={applyFilter}
                className="h-7 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                Apply Filter
              </button>
            </div>
          )}

          {col.kind === "number" && (
            <div className="flex flex-col gap-2">
              <select
                value={numOp}
                onChange={(e) => setNumOp(e.target.value as NumberFilterOp)}
                className="h-8 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 text-xs focus:border-indigo-500 focus:outline-none"
              >
                {NUMBER_OPS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {numOp !== "blank" && numOp !== "nonBlank" && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={numVal}
                    onChange={(e) => setNumVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") applyFilter(); }}
                    placeholder={numOp === "between" ? "Min" : "Value"}
                    autoFocus
                    className="h-8 w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 text-xs font-mono focus:border-indigo-500 focus:outline-none"
                  />
                  {numOp === "between" && (
                    <>
                      <span className="text-slate-400">to</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={numValTo}
                        onChange={(e) => setNumValTo(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") applyFilter(); }}
                        placeholder="Max"
                        className="h-8 w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 text-xs font-mono focus:border-indigo-500 focus:outline-none"
                      />
                    </>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={applyFilter}
                className="h-7 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                Apply Filter
              </button>
            </div>
          )}

          {col.kind === "flags" && (
            <div className="flex flex-col gap-1.5">
              {availableFlags.length === 0 ? (
                <div className="text-slate-400 py-1">No flags in worksheet</div>
              ) : (
                availableFlags.map((flag) => {
                  const checked = flagSet.has(flag);
                  return (
                    <label
                      key={flag}
                      className="flex cursor-pointer items-center justify-between rounded px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-zinc-800"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setFlagSet((prev) => {
                              const next = new Set(prev);
                              if (next.has(flag)) next.delete(flag);
                              else next.add(flag);
                              return next;
                            });
                          }}
                          className="rounded border-slate-300 text-indigo-600"
                        />
                        <span>{flag}</span>
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">({flagCounts.get(flag) ?? 0})</span>
                    </label>
                  );
                })
              )}
              <button
                type="button"
                onClick={applyFilter}
                className="mt-1 h-7 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                Apply Filter
              </button>
            </div>
          )}
        </div>

        {/* Column Management section */}
        <div className="p-1.5">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
            Column
          </div>
          <button
            type="button"
            onClick={() => { onTogglePin(col.key); onClose(); }}
            className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            {isPinned ? "Unfreeze this column" : "Freeze this column"}
          </button>
          {!isPinned && (
            <button
              type="button"
              onClick={() => { onFreezeUpTo(col.key); onClose(); }}
              className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              Freeze up to this column
            </button>
          )}
          <button
            type="button"
            onClick={() => { onAutoFit(col.key); onClose(); }}
            className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            Auto-fit column width
          </button>
          <button
            type="button"
            onClick={() => { onToggleWrap(col.key); onClose(); }}
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <span>Wrap text</span>
            {isWrapped && <span className="font-bold text-emerald-600 dark:text-emerald-400">✓</span>}
          </button>
          <button
            type="button"
            onClick={() => { onHideColumn(col.key); onClose(); }}
            className="block w-full rounded-md px-2 py-1.5 text-left text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            Hide column
          </button>
        </div>
      </div>
    </div>
  );
}
