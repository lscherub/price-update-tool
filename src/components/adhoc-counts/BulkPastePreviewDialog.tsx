"use client";

import React, { useState } from "react";
import { parsePastedUpcs, type ParsedBulkItem } from "@/lib/adhocCount";
import { LoadingButton } from "@/components/LoadingButton";

interface BulkPastePreviewDialogProps {
  isOpen: boolean;
  sheetId: string;
  onClose: () => void;
  onConfirmAdd: (selectedItems: Array<{
    sku: string;
    brand: string;
    description: string;
    sizeDesc: string;
    matched: boolean;
  }>) => Promise<void>;
}

export function BulkPastePreviewDialog({
  isOpen,
  sheetId,
  onClose,
  onConfirmAdd,
}: BulkPastePreviewDialogProps) {
  const [inputText, setInputText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [previewItems, setPreviewItems] = useState<ParsedBulkItem[] | null>(null);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleAnalyze = async () => {
    setError("");
    const parsedSkus = parsePastedUpcs(inputText);
    if (!parsedSkus.length) {
      setError("Please paste or enter at least one SKU/UPC.");
      return;
    }

    setAnalyzing(true);
    try {
      const res = await fetch("/api/adhoc-counts/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus: parsedSkus, sheetId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to lookup products.");
      }

      setPreviewItems(data.items || []);
    } catch (err: any) {
      setError(err.message || "Error analyzing pasted UPCs.");
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleSelect = (index: number) => {
    if (!previewItems) return;
    setPreviewItems((prev) =>
      prev ? prev.map((item, i) => (i === index ? { ...item, selected: !item.selected } : item)) : null,
    );
  };

  const toggleSelectAll = (select: boolean) => {
    if (!previewItems) return;
    setPreviewItems((prev) =>
      prev ? prev.map((item) => ({ ...item, selected: select })) : null,
    );
  };

  const removeItem = (index: number) => {
    if (!previewItems) return;
    setPreviewItems((prev) => (prev ? prev.filter((_, i) => i !== index) : null));
  };

  const handleConfirm = async () => {
    if (!previewItems) return;
    const selected = previewItems.filter((it) => it.selected);
    if (!selected.length) {
      setError("Please select at least one product to add.");
      return;
    }

    setAdding(true);
    try {
      await onConfirmAdd(
        selected.map((it) => ({
          sku: it.sku,
          brand: it.brand,
          description: it.description,
          sizeDesc: it.sizeDesc,
          matched: it.matched,
        })),
      );
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to add products to sheet.");
    } finally {
      setAdding(false);
    }
  };

  const selectedCount = previewItems ? previewItems.filter((it) => it.selected).length : 0;
  const matchedCount = previewItems ? previewItems.filter((it) => it.matched).length : 0;
  const notFoundCount = previewItems ? previewItems.filter((it) => !it.matched).length : 0;
  const dupListCount = previewItems ? previewItems.filter((it) => it.isDuplicateInList).length : 0;
  const alreadyInSheetCount = previewItems ? previewItems.filter((it) => it.isAlreadyInSheet).length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-zinc-900">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-zinc-800">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Bulk Add Products by UPC/SKU
            </h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              Paste a list of UPCs or SKUs to preview and confirm before adding to the count sheet.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-300">
              {error}
            </div>
          )}

          {!previewItems ? (
            /* Input Step */
            <div className="flex flex-col gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                  Paste UPCs / SKUs (One per line or separated by tabs/commas)
                </label>
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={`62773300207\n62773300420\n62773301060\n62354374619\n03367414961`}
                  rows={10}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 p-3.5 font-mono text-sm text-slate-900 transition-colors focus:border-indigo-600 focus:bg-white focus:outline-hidden dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-indigo-400"
                />
                <p className="mt-1.5 text-xs text-slate-500 dark:text-zinc-400">
                  Leading zeros are strictly preserved. Whitespace and spreadsheet copy/paste formats are automatically handled.
                </p>
              </div>
            </div>
          ) : (
            /* Preview Step */
            <div className="flex flex-col gap-4">
              {/* Summary Stats */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/50">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-700 dark:text-zinc-300">
                    Total: {previewItems.length}
                  </span>
                  <span className="text-slate-300 dark:text-zinc-700">•</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    Matched: {matchedCount}
                  </span>
                  {notFoundCount > 0 && (
                    <>
                      <span className="text-slate-300 dark:text-zinc-700">•</span>
                      <span className="font-semibold text-amber-600 dark:text-amber-400">
                        Not Found: {notFoundCount}
                      </span>
                    </>
                  )}
                  {dupListCount > 0 && (
                    <>
                      <span className="text-slate-300 dark:text-zinc-700">•</span>
                      <span className="font-semibold text-orange-600 dark:text-orange-400">
                        Duplicate in list: {dupListCount}
                      </span>
                    </>
                  )}
                  {alreadyInSheetCount > 0 && (
                    <>
                      <span className="text-slate-300 dark:text-zinc-700">•</span>
                      <span className="font-semibold text-blue-600 dark:text-blue-400">
                        Already in sheet: {alreadyInSheetCount}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleSelectAll(true)}
                    className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    Select All
                  </button>
                  <span className="text-slate-300 dark:text-zinc-700">|</span>
                  <button
                    type="button"
                    onClick={() => toggleSelectAll(false)}
                    className="text-xs font-semibold text-slate-600 hover:underline dark:text-zinc-400"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              {/* Preview Table */}
              <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200 dark:border-zinc-800">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100/90 backdrop-blur-xs dark:border-zinc-800 dark:bg-zinc-800/90">
                    <tr>
                      <th className="w-10 px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={previewItems.length > 0 && previewItems.every((it) => it.selected)}
                          onChange={(e) => toggleSelectAll(e.target.checked)}
                          className="rounded text-indigo-600 focus:ring-indigo-500"
                        />
                      </th>
                      <th className="px-3 py-2.5 font-bold text-slate-700 dark:text-zinc-200">SKU/UPC</th>
                      <th className="px-3 py-2.5 font-bold text-slate-700 dark:text-zinc-200">Brand</th>
                      <th className="px-3 py-2.5 font-bold text-slate-700 dark:text-zinc-200">Description</th>
                      <th className="px-3 py-2.5 font-bold text-slate-700 dark:text-zinc-200">Size Desc.</th>
                      <th className="px-3 py-2.5 font-bold text-slate-700 dark:text-zinc-200">Status</th>
                      <th className="w-10 px-3 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                    {previewItems.map((item, idx) => (
                      <tr
                        key={`${item.sku}-${idx}`}
                        className={`transition-colors hover:bg-slate-50 dark:hover:bg-zinc-800/50 ${
                          !item.selected ? "opacity-60 bg-slate-50/40 dark:bg-zinc-900/40" : ""
                        }`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={item.selected}
                            onChange={() => toggleSelect(idx)}
                            className="rounded text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="font-mono font-medium text-slate-900 dark:text-white px-3 py-2">
                          {item.sku}
                        </td>
                        <td className="px-3 py-2 text-slate-700 dark:text-zinc-300">
                          {item.brand || "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-900 dark:text-zinc-100 max-w-xs truncate">
                          {item.description || (item.matched ? "—" : "Not Found")}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-zinc-400">
                          {item.sizeDesc || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {item.matched ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                                Matched
                              </span>
                            ) : (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/80 dark:text-amber-300">
                                Not Found
                              </span>
                            )}
                            {item.isDuplicateInList && (
                              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-800 dark:bg-orange-950/80 dark:text-orange-300">
                                Duplicate in list
                              </span>
                            )}
                            {item.isAlreadyInSheet && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950/80 dark:text-blue-300">
                                Already in sheet
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            title="Remove from preview"
                            className="text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/60">
          {!previewItems ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                Cancel
              </button>
              <LoadingButton
                type="button"
                busy={analyzing}
                onClick={handleAnalyze}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
              >
                Preview Products
              </LoadingButton>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setPreviewItems(null)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                ← Back to Edit
              </button>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  Cancel
                </button>
                <LoadingButton
                  type="button"
                  busy={adding}
                  disabled={selectedCount === 0}
                  onClick={handleConfirm}
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-600"
                >
                  Add {selectedCount} Product{selectedCount === 1 ? "" : "s"} to Sheet
                </LoadingButton>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
