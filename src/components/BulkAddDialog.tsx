"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoadingButton } from "./LoadingButton";
import {
  applyColumnMapping,
  generateTemplateCsv,
  generateTemplateXlsx,
  guessColumnMapping,
  parsePastedText,
  parseSpreadsheetBuffer,
  TARGET_COLUMNS,
  type BulkAddInputRow,
  type BulkAddParsedItem,
  type TargetColumnKey,
} from "@/lib/bulkAdd";

export function BulkAddDialog({
  sessionId,
  busy,
  onClose,
  onSubmit,
  existingSkus,
}: {
  sessionId: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (items: BulkAddInputRow[], summary: { added: number; skipped: number }) => Promise<void>;
  existingSkus?: string[];
}) {
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [pastedText, setPastedText] = useState("");
  const [headerCheckbox, setHeaderCheckbox] = useState<boolean | null>(null);

  const [fileName, setFileName] = useState("");
  const [fileBuf, setFileBuf] = useState<ArrayBuffer | null>(null);

  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);

  const [mapping, setMapping] = useState<Record<TargetColumnKey, string>>({
    rawVendorSku: "",
    cleanedSku: "",
    discount: "",
    vendorListPriceNew: "",
    marginDivisor: "",
    notes: "",
  });

  const [previewItems, setPreviewItems] = useState<BulkAddParsedItem[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Download template helpers
  const downloadTemplate = (format: "csv" | "xlsx") => {
    if (format === "csv") {
      const csv = generateTemplateCsv();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bulk_add_rows_template.csv";
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const xlsxBytes = generateTemplateXlsx();
      const blob = new Blob([xlsxBytes.buffer as ArrayBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bulk_add_rows_template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // Parse input data whenever text or file changes
  useEffect(() => {
    if (mode === "paste") {
      if (!pastedText.trim()) {
        setDetectedColumns([]);
        setRawRows([]);
        setPreviewItems([]);
        setSelectedIndices(new Set());
        setPreviewError("");
        return;
      }
      const override = headerCheckbox !== null ? headerCheckbox : undefined;
      const parsed = parsePastedText(pastedText, override);
      setDetectedColumns(parsed.headers);
      setRawRows(parsed.rows);
      setHasHeader(parsed.hasHeaderRow);
      setMapping(guessColumnMapping(parsed.headers));
    } else {
      if (!fileBuf) {
        setDetectedColumns([]);
        setRawRows([]);
        setPreviewItems([]);
        setSelectedIndices(new Set());
        setPreviewError("");
        return;
      }
      const override = headerCheckbox !== null ? headerCheckbox : undefined;
      const parsed = parseSpreadsheetBuffer(fileBuf, override);
      setDetectedColumns(parsed.headers);
      setRawRows(parsed.rows);
      setHasHeader(parsed.hasHeaderRow);
      setMapping(guessColumnMapping(parsed.headers));
    }
  }, [mode, pastedText, fileBuf, headerCheckbox]);

  // Request preview from server whenever rawRows or mapping changes
  const runPreview = useCallback(async () => {
    if (!rawRows.length || !detectedColumns.length) {
      setPreviewItems([]);
      setSelectedIndices(new Set());
      setPreviewError("");
      return;
    }

    const inputRows = applyColumnMapping(detectedColumns, rawRows, mapping);
    setPreviewLoading(true);
    setPreviewError("");

    try {
      const res = await fetch(`/api/sessions/${sessionId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: true, items: inputRows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPreviewError(data?.error || "Could not generate preview.");
        setPreviewItems([]);
        return;
      }

      const items = (Array.isArray(data.preview) ? data.preview : []) as BulkAddParsedItem[];
      setPreviewItems(items);

      // Auto-select valid items (excluding duplicates if skipDuplicates is on)
      const newSelected = new Set<number>();
      items.forEach((item, idx) => {
        if (!item.isValid) return;
        if (skipDuplicates && (item.isDuplicateInBatch || item.isDuplicateInWorksheet)) return;
        newSelected.add(idx);
      });
      setSelectedIndices(newSelected);
    } catch {
      setPreviewError("Network error while generating preview. Please check connection.");
      setPreviewItems([]);
    } finally {
      setPreviewLoading(false);
    }
  }, [sessionId, detectedColumns, rawRows, mapping, skipDuplicates]);

  // Automatically update preview when mapping or rows change
  useEffect(() => {
    if (rawRows.length > 0 && detectedColumns.length > 0) {
      void runPreview();
    }
  }, [runPreview]);

  // Handle file selection
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const buf = await f.arrayBuffer();
    setFileBuf(buf);
  };

  // Toggle skip duplicates setting
  const onToggleSkipDuplicates = (checked: boolean) => {
    setSkipDuplicates(checked);
    const next = new Set<number>();
    previewItems.forEach((item, idx) => {
      if (!item.isValid) return;
      if (checked && (item.isDuplicateInBatch || item.isDuplicateInWorksheet)) return;
      next.add(idx);
    });
    setSelectedIndices(next);
  };

  // Select all / deselect all
  const onToggleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIndices(new Set());
    } else {
      const next = new Set<number>();
      previewItems.forEach((item, idx) => {
        if (item.isValid) next.add(idx);
      });
      setSelectedIndices(next);
    }
  };

  const toggleRow = (idx: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Summary counts
  const totalCount = previewItems.length;
  const selectedCount = selectedIndices.size;
  const skippedCount = totalCount - selectedCount;

  const validCount = previewItems.filter((i) => i.isValid).length;
  const invalidCount = previewItems.filter((i) => !i.isValid).length;
  const duplicateCount = previewItems.filter((i) => i.isDuplicateInBatch || i.isDuplicateInWorksheet).length;
  const unmatchedCount = previewItems.filter((i) => i.isValid && !i.matched).length;

  // Confirm and submit
  const handleConfirm = async () => {
    if (selectedCount === 0 || busy) return;
    const allInputRows = applyColumnMapping(detectedColumns, rawRows, mapping);
    const selectedRows = Array.from(selectedIndices)
      .sort((a, b) => a - b)
      .map((idx) => allInputRows[idx])
      .filter(Boolean);

    await onSubmit(selectedRows, { added: selectedCount, skipped: skippedCount });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Bulk Add Rows Dialog"
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Bulk Add Rows</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Add multiple products at once by pasting from Excel or importing a file.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-xs text-slate-600">
              <span>Template:</span>
              <button
                type="button"
                onClick={() => downloadTemplate("xlsx")}
                className="font-medium text-emerald-700 hover:underline"
              >
                Excel (.xlsx)
              </button>
              <span>|</span>
              <button
                type="button"
                onClick={() => downloadTemplate("csv")}
                className="font-medium text-emerald-700 hover:underline"
              >
                CSV
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Input Mode Selector */}
          <div className="flex items-center gap-4 border-b pb-3">
            <label className="flex items-center gap-2 cursor-pointer font-medium text-sm text-slate-800">
              <input
                type="radio"
                name="bulkMode"
                value="paste"
                checked={mode === "paste"}
                onChange={() => setMode("paste")}
                className="text-emerald-600 focus:ring-emerald-500"
              />
              Paste from Excel
            </label>
            <label className="flex items-center gap-2 cursor-pointer font-medium text-sm text-slate-800">
              <input
                type="radio"
                name="bulkMode"
                value="file"
                checked={mode === "file"}
                onChange={() => setMode("file")}
                className="text-emerald-600 focus:ring-emerald-500"
              />
              Import File (.xlsx, .csv)
            </label>
          </div>

          {/* Paste Area */}
          {mode === "paste" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Copy rows from Excel and paste here (tab-separated or comma-separated):</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={headerCheckbox !== null ? headerCheckbox : hasHeader}
                    onChange={(e) => setHeaderCheckbox(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>First row contains column headers</span>
                </label>
              </div>
              <textarea
                rows={4}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder={"Cleaned SKU\tVendor List Price (New)\n06895801011\t9.49\n62776501032\t13.54"}
                className="w-full rounded border border-slate-300 p-2.5 font-mono text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          )}

          {/* File Upload Area */}
          {mode === "file" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Select an Excel (.xlsx, .xls) or CSV file:</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={headerCheckbox !== null ? headerCheckbox : hasHeader}
                    onChange={(e) => setHeaderCheckbox(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>First row contains column headers</span>
                </label>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".xlsx,.xls,.csv"
                  onChange={onFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Choose File...
                </button>
                <span className="text-xs text-slate-600">{fileName || "No file chosen"}</span>
                {fileName && (
                  <button
                    type="button"
                    onClick={() => {
                      setFileName("");
                      setFileBuf(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Column Mapping Section */}
          {detectedColumns.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Match Columns from Import
                </span>
                <span className="text-xs text-slate-500">
                  {rawRows.length} data row{rawRows.length === 1 ? "" : "s"} detected
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 text-xs">
                {TARGET_COLUMNS.map((target) => (
                  <label key={target.key} className="flex flex-col gap-1">
                    <span className="font-medium text-slate-700 truncate" title={target.label}>
                      {target.label}
                    </span>
                    <select
                      value={mapping[target.key]}
                      onChange={(e) =>
                        setMapping((prev) => ({ ...prev, [target.key]: e.target.value }))
                      }
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-emerald-500 focus:outline-hidden"
                    >
                      <option value="">(None / Blank)</option>
                      {detectedColumns.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Preview & Validation Status Bar */}
          {detectedColumns.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold text-slate-800">Preview &amp; Validation:</span>
                  {validCount > 0 && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                      ✓ {validCount} Valid
                    </span>
                  )}
                  {unmatchedCount > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800" title="SKU not found in inventory">
                      ! {unmatchedCount} Unmatched
                    </span>
                  )}
                  {duplicateCount > 0 && (
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 font-medium text-purple-800">
                      ⧉ {duplicateCount} Duplicate
                    </span>
                  )}
                  {invalidCount > 0 && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800">
                      ✕ {invalidCount} Invalid
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                    <input
                      type="checkbox"
                      checked={skipDuplicates}
                      onChange={(e) => onToggleSkipDuplicates(e.target.checked)}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>Skip duplicate products</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onToggleSelectAll(selectedCount < validCount)}
                    className="font-medium text-emerald-700 hover:underline"
                  >
                    {selectedCount === validCount ? "Deselect All" : "Select All Valid"}
                  </button>
                </div>
              </div>

              {previewError && (
                <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">
                  {previewError}
                </div>
              )}

              {/* Preview Table */}
              <div className="max-h-64 overflow-x-auto overflow-y-auto rounded border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100 font-semibold text-slate-700 shadow-xs">
                    <tr>
                      <th className="w-8 px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={validCount > 0 && selectedCount === validCount}
                          onChange={(e) => onToggleSelectAll(e.target.checked)}
                          aria-label="Select all valid rows"
                          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                      </th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">Cleaned SKU</th>
                      <th className="px-2 py-2">Raw Vendor SKU</th>
                      <th className="px-2 py-2">Product Description</th>
                      <th className="px-2 py-2">Vendor / Brand</th>
                      <th className="px-2 py-2 text-right">Vendor Price (New)</th>
                      <th className="px-2 py-2 text-right">Discount</th>
                      <th className="px-2 py-2 text-right">New List Price</th>
                      <th className="px-2 py-2 text-right">Divisor</th>
                      <th className="px-2 py-2 text-right">New Retail</th>
                      <th className="px-2 py-2 text-right font-bold text-slate-900">Nearest 9</th>
                      <th className="px-2 py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                    {previewLoading ? (
                      <tr>
                        <td colSpan={13} className="py-8 text-center text-slate-500">
                          Calculating prices and looking up products...
                        </td>
                      </tr>
                    ) : previewItems.length === 0 ? (
                      <tr>
                        <td colSpan={13} className="py-6 text-center text-slate-400">
                          No rows to preview yet.
                        </td>
                      </tr>
                    ) : (
                      previewItems.map((item, idx) => {
                        const isSelected = selectedIndices.has(idx);
                        return (
                          <tr
                            key={idx}
                            className={`hover:bg-slate-50/80 ${
                              !item.isValid
                                ? "bg-red-50/40 text-slate-500"
                                : item.isDuplicateInBatch || item.isDuplicateInWorksheet
                                ? "bg-purple-50/30"
                                : !item.matched
                                ? "bg-amber-50/30"
                                : ""
                            }`}
                          >
                            <td className="px-2 py-1.5 text-center">
                              <input
                                type="checkbox"
                                disabled={!item.isValid}
                                checked={isSelected}
                                onChange={() => toggleRow(idx)}
                                aria-label={`Select row ${idx + 1}`}
                                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-30"
                              />
                            </td>
                            <td className="px-2 py-1.5 whitespace-nowrap">
                              {!item.isValid ? (
                                <span
                                  className="inline-flex items-center rounded-sm bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800"
                                  title={item.validationError}
                                >
                                  Invalid: {item.validationError}
                                </span>
                              ) : item.isDuplicateInWorksheet ? (
                                <span className="inline-flex items-center rounded-sm bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800" title="This SKU already exists in this price update worksheet">
                                  Duplicate (Worksheet)
                                </span>
                              ) : item.isDuplicateInBatch ? (
                                <span className="inline-flex items-center rounded-sm bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800" title="This SKU appears multiple times in your import list">
                                  Duplicate (Batch)
                                </span>
                              ) : !item.matched ? (
                                <span className="inline-flex items-center rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800" title="Not found in inventory">
                                  Unmatched
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-sm bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                                  Valid
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 font-mono">{item.cleanedSku || "—"}</td>
                            <td className="px-2 py-1.5 font-mono text-slate-500">{item.rawVendorSku || "—"}</td>
                            <td className="px-2 py-1.5 max-w-44 truncate" title={item.productName}>
                              {item.productName || (item.matched ? "—" : <span className="text-red-600 font-semibold">Not Found</span>)}
                            </td>
                            <td className="px-2 py-1.5 text-slate-500 truncate max-w-28" title={`${item.vendor} ${item.brand}`}>
                              {[item.vendor, item.brand].filter(Boolean).join(" / ") || "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono">
                              {item.vendorListPriceNew ? `$${item.vendorListPriceNew}` : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono">
                              {item.discount ? `${item.discount}%` : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono">
                              {item.ourNewListPrice ? `$${item.ourNewListPrice}` : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono text-slate-500">
                              {item.marginDivisor || "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono">
                              {item.ourNewRetailPrice ? `$${item.ourNewRetailPrice}` : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono font-bold text-slate-900">
                              {item.nearest9 ? `$${item.nearest9}` : "—"}
                            </td>
                            <td className="px-2 py-1.5 max-w-28 truncate text-slate-500" title={item.notes}>
                              {item.notes || "—"}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t bg-slate-50 px-6 py-3">
          <div className="text-xs text-slate-600">
            {previewItems.length > 0 ? (
              <span>
                <strong className="text-slate-900">{selectedCount}</strong> rows ready to add
                {skippedCount > 0 && (
                  <span className="text-slate-500"> ({skippedCount} will be skipped)</span>
                )}
              </span>
            ) : (
              <span>Enter or paste rows above to preview before adding.</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <LoadingButton
              busy={busy}
              busyLabel="Adding rows..."
              disabled={selectedCount === 0 || busy}
              onClick={handleConfirm}
              className="rounded bg-emerald-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add {selectedCount > 0 ? `${selectedCount} Valid Row${selectedCount === 1 ? "" : "s"}` : "Rows"} to Worksheet
            </LoadingButton>
          </div>
        </div>
      </div>
    </div>
  );
}

