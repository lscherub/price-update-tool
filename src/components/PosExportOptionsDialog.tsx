"use client";

import { useMemo, useState } from "react";
import { LoadingButton } from "@/components/LoadingButton";
import {
  computePosExportSummary,
  type PosExportInputRow,
  type PosExportMode,
} from "@/lib/fullVendorPosExport";

export type PosExportOptions = {
  mode: PosExportMode;
  selectedIds?: string[];
};

interface Props {
  isOpen: boolean;
  busy: boolean;
  vendorName?: string;
  rows: PosExportInputRow[];
  selected: Set<string>;
  onClose: () => void;
  onExport: (options: PosExportOptions) => void;
}

const MODE_TITLES: Record<PosExportMode, string> = {
  all: "Export All Products",
  "all-populate": "Export All Products — Populate All Prices",
  changed: "Export Products with Price Changes Only",
  selected: "Export Selected Products",
};

export function PosExportOptionsDialog({
  isOpen,
  busy,
  vendorName,
  rows,
  selected,
  onClose,
  onExport,
}: Props) {
  const [mode, setMode] = useState<PosExportMode>("all");

  const summary = useMemo(
    () => computePosExportSummary(rows, mode, selected),
    [rows, mode, selected],
  );

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "selected" && summary.includedCount === 0) return;
    if (mode === "changed" && summary.includedCount === 0) return;

    onExport({
      mode,
      selectedIds: mode === "selected" ? Array.from(selected) : undefined,
    });
  };

  const isSelectionEmpty = mode === "selected" && summary.includedCount === 0;
  const isChangedEmpty = mode === "changed" && summary.includedCount === 0;
  const canExport = !busy && !isSelectionEmpty && !isChangedEmpty;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pos-export-dialog-title"
    >
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-6 shadow-2xl text-slate-900 dark:text-zinc-100">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 dark:border-zinc-800 pb-3">
          <div>
            <h2 id="pos-export-dialog-title" className="text-lg font-bold text-slate-900 dark:text-white">
              Export for POS
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
              {vendorName ? `Vendor: ${vendorName} • ` : ""}Choose which products to include in the POS CSV
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-slate-400 dark:text-zinc-500 hover:bg-slate-100 dark:hover:bg-zinc-800 hover:text-slate-600 dark:hover:text-zinc-300 disabled:opacity-50 transition-colors"
            aria-label="Close export dialog"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Options List */}
          <div className="space-y-2">
            {/* Option 1: Export All Products */}
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                mode === "all"
                  ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30 text-slate-900 dark:text-zinc-100"
                  : "border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/60 text-slate-700 dark:text-zinc-300"
              }`}
            >
              <input
                type="radio"
                name="posExportMode"
                value="all"
                checked={mode === "all"}
                onChange={() => setMode("all")}
                className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-900 dark:text-zinc-100">Export All Products</span>
                <p className="mt-0.5 text-slate-500 dark:text-zinc-400">
                  Export every product in the worksheet, including products with an empty New Price. Preserves existing empty price formatting.
                </p>
              </div>
            </label>

            {/* Option 2: Export All Products — Populate All Prices */}
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                mode === "all-populate"
                  ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30 text-slate-900 dark:text-zinc-100"
                  : "border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/60 text-slate-700 dark:text-zinc-300"
              }`}
            >
              <input
                type="radio"
                name="posExportMode"
                value="all-populate"
                checked={mode === "all-populate"}
                onChange={() => setMode("all-populate")}
                className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-900 dark:text-zinc-100">
                  Export All Products — Populate All Prices
                </span>
                <p className="mt-0.5 text-slate-500 dark:text-zinc-400">
                  Export every product. Uses the final effective retail price for every product, populating unchanged prices with the original retail price.
                </p>
              </div>
            </label>

            {/* Option 3: Export Products with Price Changes Only */}
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                mode === "changed"
                  ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30 text-slate-900 dark:text-zinc-100"
                  : "border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/60 text-slate-700 dark:text-zinc-300"
              }`}
            >
              <input
                type="radio"
                name="posExportMode"
                value="changed"
                checked={mode === "changed"}
                onChange={() => setMode("changed")}
                className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-900 dark:text-zinc-100">
                  Export Products with Price Changes Only
                </span>
                <p className="mt-0.5 text-slate-500 dark:text-zinc-400">
                  Export only products where the final effective retail price differs from the original Old Retail Price. Excludes products without a price change.
                </p>
              </div>
            </label>

            {/* Option 4: Export Selected Products */}
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                mode === "selected"
                  ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30 text-slate-900 dark:text-zinc-100"
                  : "border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/60 text-slate-700 dark:text-zinc-300"
              }`}
            >
              <input
                type="radio"
                name="posExportMode"
                value="selected"
                checked={mode === "selected"}
                onChange={() => setMode("selected")}
                className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-900 dark:text-zinc-100">Export Selected Products</span>
                <p className="mt-0.5 text-slate-500 dark:text-zinc-400">
                  Export only products manually selected using the worksheet row checkboxes across pages.
                </p>
              </div>
            </label>
          </div>

          {/* Warning for empty selection */}
          {isSelectionEmpty && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-300">
              <div className="flex items-center gap-2 font-semibold">
                <svg className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>No Products Selected</span>
              </div>
              <p className="mt-1 pl-6">
                No products are currently selected. Select rows using the checkboxes in the worksheet before exporting selected products.
              </p>
            </div>
          )}

          {/* Notice for no price changes */}
          {isChangedEmpty && (
            <div className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800/40 p-3 text-xs text-slate-600 dark:text-zinc-400">
              <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-zinc-200">
                <span>No Price Changes</span>
              </div>
              <p className="mt-1">
                No products in this worksheet have price changes to export.
              </p>
            </div>
          )}

          {/* Section 3: Export Summary */}
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/50 p-3.5 text-xs">
            <div className="font-semibold text-slate-800 dark:text-zinc-200">
              {MODE_TITLES[mode]}
            </div>
            <ul className="mt-1.5 space-y-1 text-slate-600 dark:text-zinc-400">
              <li className="flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span>
                  <strong>{summary.includedCount}</strong> product{summary.includedCount === 1 ? "" : "s"} included
                </span>
              </li>
              <li className="flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-zinc-500" />
                <span>
                  <strong>{summary.excludedCount}</strong> product{summary.excludedCount === 1 ? "" : "s"} excluded
                </span>
              </li>
            </ul>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-slate-200 dark:border-zinc-700 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-60 transition-colors"
            >
              Cancel
            </button>
            <LoadingButton
              type="submit"
              busy={busy}
              disabled={!canExport}
              busyLabel="Generating CSV..."
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 transition-colors"
            >
              Download POS CSV
            </LoadingButton>
          </div>
        </form>
      </div>
    </div>
  );
}
