"use client";

import { useState } from "react";
import { LoadingButton } from "@/components/LoadingButton";

export type DigitalStoreCountExportOptions = {
  priceMode: "changed" | "all";
  productFilter: "all" | "active" | "inactive";
};

interface Props {
  isOpen: boolean;
  busy: boolean;
  vendorName?: string;
  onClose: () => void;
  onExport: (options: DigitalStoreCountExportOptions) => void;
}

export function DigitalStoreCountExportDialog({
  isOpen,
  busy,
  vendorName,
  onClose,
  onExport,
}: Props) {
  const [priceMode, setPriceMode] = useState<"changed" | "all">("changed");
  const [productFilter, setProductFilter] = useState<"all" | "active" | "inactive">("all");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onExport({ priceMode, productFilter });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-dialog-title"
    >
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-6 shadow-2xl text-slate-900 dark:text-zinc-100">
        <div className="flex items-start justify-between border-b border-slate-200 dark:border-zinc-800 pb-3">
          <div>
            <h2 id="export-dialog-title" className="text-lg font-bold text-slate-900 dark:text-white">
              Digital Store Count Excel Export
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
              {vendorName ? `Vendor: ${vendorName} • ` : ""}Configure export options for store count
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

        <form onSubmit={handleSubmit} className="mt-4 space-y-5">
          {/* Section 1: New Price Column Option */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300">
              New Price Column
            </label>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
              Choose how the New Price column should be populated in the counting worksheet:
            </p>
            <div className="mt-2 space-y-2">
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  priceMode === "changed"
                    ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30 text-slate-900 dark:text-zinc-100"
                    : "border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/60 text-slate-700 dark:text-zinc-300"
                }`}
              >
                <input
                  type="radio"
                  name="priceMode"
                  value="changed"
                  checked={priceMode === "changed"}
                  onChange={() => setPriceMode("changed")}
                  className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="text-xs">
                  <span className="font-semibold text-slate-900 dark:text-zinc-100">Changed prices only</span>
                  <span className="ml-1.5 rounded bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:text-emerald-300">
                    Recommended
                  </span>
                  <p className="mt-0.5 text-slate-500 dark:text-zinc-400">
                    Populate New Price only when the final effective retail price differs from the old retail price. Left blank when unchanged.
                  </p>
                </div>
              </label>

              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  priceMode === "all"
                    ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30 text-slate-900 dark:text-zinc-100"
                    : "border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/60 text-slate-700 dark:text-zinc-300"
                }`}
              >
                <input
                  type="radio"
                  name="priceMode"
                  value="all"
                  checked={priceMode === "all"}
                  onChange={() => setPriceMode("all")}
                  className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="text-xs">
                  <span className="font-semibold text-slate-900 dark:text-zinc-100">All prices</span>
                  <p className="mt-0.5 text-slate-500 dark:text-zinc-400">
                    Populate New Price with the final effective retail price (including Nearest 9/custom pricing) for every product, even if unchanged.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Section 2: Products to Include Option */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300">
              Products to Include
            </label>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
              Select which product records should appear in the exported spreadsheet:
            </p>
            <div className="mt-2 space-y-2">
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  productFilter === "all"
                    ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30 text-slate-900 dark:text-zinc-100"
                    : "border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/60 text-slate-700 dark:text-zinc-300"
                }`}
              >
                <input
                  type="radio"
                  name="productFilter"
                  value="all"
                  checked={productFilter === "all"}
                  onChange={() => setProductFilter("all")}
                  className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="text-xs">
                  <span className="font-semibold text-slate-900 dark:text-zinc-100">All products (active and inactive)</span>
                  <p className="mt-0.5 text-slate-500 dark:text-zinc-400">
                    Export all products. Inactive products are shaded in light grey with grey text, and a legend explains the highlighting.
                  </p>
                </div>
              </label>

              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  productFilter === "active"
                    ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30 text-slate-900 dark:text-zinc-100"
                    : "border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/60 text-slate-700 dark:text-zinc-300"
                }`}
              >
                <input
                  type="radio"
                  name="productFilter"
                  value="active"
                  checked={productFilter === "active"}
                  onChange={() => setProductFilter("active")}
                  className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="text-xs">
                  <span className="font-semibold text-slate-900 dark:text-zinc-100">Active products only</span>
                  <p className="mt-0.5 text-slate-500 dark:text-zinc-400">
                    Export only active products currently in inventory.
                  </p>
                </div>
              </label>

              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  productFilter === "inactive"
                    ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30 text-slate-900 dark:text-zinc-100"
                    : "border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/60 text-slate-700 dark:text-zinc-300"
                }`}
              >
                <input
                  type="radio"
                  name="productFilter"
                  value="inactive"
                  checked={productFilter === "inactive"}
                  onChange={() => setProductFilter("inactive")}
                  className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="text-xs">
                  <span className="font-semibold text-slate-900 dark:text-zinc-100">Inactive products only</span>
                  <p className="mt-0.5 text-slate-500 dark:text-zinc-400">
                    Export only inactive or discontinued products.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-zinc-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-slate-300 dark:border-zinc-700 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <LoadingButton
              type="submit"
              busy={busy}
              busyLabel="Generating Excel..."
              className="rounded-lg bg-indigo-600 dark:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:opacity-50 shadow-xs transition-colors"
            >
              Export Excel
            </LoadingButton>
          </div>
        </form>
      </div>
    </div>
  );
}

