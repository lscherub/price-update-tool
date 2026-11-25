"use client";

import { useState } from "react";
import { validateCellEdit } from "@/lib/spreadsheet/engine";

export type BulkEditAction =
  | { kind: "setField"; field: "discount" | "vendorListPriceNew" | "marginDivisor" | "nearest9"; value: string; label: string }
  | { kind: "clearCustomNearest9"; label: string }
  | { kind: "restoreDefaultDiscount"; label: string };

export function BulkEditModal({
  targetRowCount,
  scopeLabel,
  onApply,
  onClose,
}: {
  targetRowCount: number;
  scopeLabel: string;
  onApply: (action: BulkEditAction) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<
    "discount" | "vendorListPriceNew" | "marginDivisor" | "nearest9" | "clearCustom" | "restoreDiscount"
  >("discount");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    setError("");
    if (mode === "clearCustom") {
      onApply({ kind: "clearCustomNearest9", label: `Clear Custom Nearest 9 (${targetRowCount} rows)` });
      onClose();
      return;
    }
    if (mode === "restoreDiscount") {
      onApply({ kind: "restoreDefaultDiscount", label: `Restore Default Discount (${targetRowCount} rows)` });
      onClose();
      return;
    }
    const check = validateCellEdit(mode, value);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    const labels: Record<typeof mode, string> = {
      discount: `Set Discount to ${check.normalized || "default"}`,
      vendorListPriceNew: `Set Vendor List Price to ${check.normalized || "(blank)"}`,
      marginDivisor: `Set Margin/Divisor to ${check.normalized || "0.605"}`,
      nearest9: `Set Custom Nearest 9 to ${check.normalized || "(auto)"}`,
    };
    onApply({
      kind: "setField",
      field: mode,
      value: check.normalized,
      label: `${labels[mode]} (${targetRowCount} rows)`,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Bulk Edit Selected Products"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 shadow-2xl text-slate-900 dark:text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold">Bulk Edit Products</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
              Applying to <span className="font-semibold text-slate-800 dark:text-zinc-200">{targetRowCount.toLocaleString()}</span> {scopeLabel}. Changes are validated, saved in batches, and can be undone.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-slate-700 dark:text-zinc-300">Action</span>
            <select
              value={mode}
              onChange={(e) => { setMode(e.target.value as typeof mode); setValue(""); setError(""); }}
              className="h-9 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 text-xs font-medium focus:border-indigo-500 focus:outline-none"
            >
              <option value="discount">Set Discount (%)</option>
              <option value="marginDivisor">Set Margin / Divisor</option>
              <option value="vendorListPriceNew">Set Vendor List Price (New)</option>
              <option value="nearest9">Set Custom Nearest 9 Override</option>
              <option value="clearCustom">Clear Custom Nearest 9 Overrides (Restore Auto)</option>
              <option value="restoreDiscount">Restore Vendor/Brand Default Discount</option>
            </select>
          </label>

          {mode !== "clearCustom" && mode !== "restoreDiscount" && (
            <label className="flex flex-col gap-1">
              <span className="font-semibold text-slate-700 dark:text-zinc-300">
                {mode === "discount" && "Discount % (0–100)"}
                {mode === "marginDivisor" && "Margin / Divisor (leave blank for 0.605)"}
                {mode === "vendorListPriceNew" && "Vendor List Price (leave blank to clear)"}
                {mode === "nearest9" && "Custom Nearest 9 Price"}
              </span>
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                value={value}
                onChange={(e) => { setValue(e.target.value); setError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                placeholder={
                  mode === "discount" ? "e.g. 15" :
                  mode === "marginDivisor" ? "e.g. 0.605" :
                  mode === "vendorListPriceNew" ? "e.g. 24.50" :
                  "e.g. 39.99"
                }
                className="h-9 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 font-mono text-xs focus:border-indigo-500 focus:outline-none"
              />
            </label>
          )}

          {mode === "clearCustom" && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 p-3 text-amber-900 dark:text-amber-200">
              Clears manual Custom Nearest 9 overrides on all targeted rows and restores the automatically calculated Nearest 9 price.
            </div>
          )}

          {mode === "restoreDiscount" && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/70 dark:bg-emerald-950/30 p-3 text-emerald-900 dark:text-emerald-200">
              Clears manual discount overrides on all targeted rows so the server restores each product&apos;s configured Vendor/Brand default discount.
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-red-700 dark:text-red-300 font-medium">
              {error}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-lg border border-slate-200 dark:border-zinc-700 px-3 text-xs font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="h-8 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            Apply to {targetRowCount.toLocaleString()} Row{targetRowCount === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
