"use client";

import React, { useMemo, useRef, useState } from "react";
import { LoadingButton, Spinner } from "./LoadingButton";
import { useToast } from "./Toast";
import { apiErrorText } from "@/lib/apiError";
import { chunk } from "@/lib/inventoryImport";
import {
  parseAndCleanUnifiedPosFile,
  type UnifiedPosCleaningResult,
  type UnifiedProductRecord,
} from "@/lib/unifiedPosCleaner";

const BATCH_SIZE = 1000;
const MAX_ATTEMPTS = 3;
const PREVIEW_PAGE_SIZE = 50;

type Step = "upload" | "preview" | "confirm" | "importing" | "complete";

type ImportProgress = {
  total: number;
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: { row: number; sku: string; reason: string }[];
  batchIndex: number;
  batchCount: number;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
};

export function UnifiedPosImporterDialog({ isOpen, onClose, onSuccess }: Props) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<Step>("upload");
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [cleaningResult, setCleaningResult] = useState<UnifiedPosCleaningResult | null>(null);

  // Row selection: Set of SKUs currently selected for import
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());

  // Preview filtering & pagination
  const [previewSearch, setPreviewSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [selectionFilter, setSelectionFilter] = useState<"all" | "selected" | "deselected">("all");
  const [previewPage, setPreviewPage] = useState(1);

  // Import execution state
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [importReport, setImportReport] = useState<{
    status: "complete" | "failed";
    totalInFile: number;
    selectedCount: number;
    deselectedCount: number;
    inserted: number;
    updated: number;
    skipped: number;
    failed: { row: number; sku: string; reason: string }[];
    seconds: string;
    error?: string;
  } | null>(null);
  const [showFailedRows, setShowFailedRows] = useState(false);

  const handleReset = () => {
    setStep("upload");
    setFileName("");
    setCleaningResult(null);
    setSelectedSkus(new Set());
    setPreviewSearch("");
    setStatusFilter("all");
    setSelectionFilter("all");
    setPreviewPage(1);
    setProgress(null);
    setImportReport(null);
    setShowFailedRows(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const processFile = async (file: File) => {
    setFileName(file.name);
    setParsing(true);
    setCleaningResult(null);

    try {
      const buffer = await file.arrayBuffer();
      const result = parseAndCleanUnifiedPosFile(buffer);
      setCleaningResult(result);

      if (!result.success) {
        toast.error("POS file validation failed", result.error || "Please check the file format.");
        return;
      }

      // Default: select all valid records
      const allSkus = new Set(result.records.map((r) => r.sku));
      setSelectedSkus(allSkus);
      setPreviewPage(1);
      setStep("preview");
      toast.success(
        "File cleaned successfully",
        `Prepared ${result.totalRecords.toLocaleString()} inventory products with Active/Inactive status.`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to parse file.";
      toast.error("Could not process spreadsheet", msg);
    } finally {
      setParsing(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void processFile(file);
  };

  // Preview data filtering
  const allRecords = cleaningResult?.records ?? [];

  const filteredRecords = useMemo(() => {
    const q = previewSearch.trim().toLowerCase();
    return allRecords.filter((r) => {
      // Status filter
      if (statusFilter === "active" && r.isInactive) return false;
      if (statusFilter === "inactive" && !r.isInactive) return false;

      // Selection filter
      const isSelected = selectedSkus.has(r.sku);
      if (selectionFilter === "selected" && !isSelected) return false;
      if (selectionFilter === "deselected" && isSelected) return false;

      // Text search
      if (!q) return true;
      return (
        r.sku.toLowerCase().includes(q) ||
        r.productNumber.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.vendor.toLowerCase().includes(q) ||
        r.brand.toLowerCase().includes(q)
      );
    });
  }, [allRecords, previewSearch, statusFilter, selectionFilter, selectedSkus]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PREVIEW_PAGE_SIZE));
  const currentPageRecords = useMemo(() => {
    const start = (previewPage - 1) * PREVIEW_PAGE_SIZE;
    return filteredRecords.slice(start, start + PREVIEW_PAGE_SIZE);
  }, [filteredRecords, previewPage]);

  // Selection actions
  const toggleRow = (sku: string) => {
    setSelectedSkus((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedSkus(new Set(allRecords.map((r) => r.sku)));
  };

  const deselectAll = () => {
    setSelectedSkus(new Set());
  };

  const selectAllMatching = () => {
    setSelectedSkus((prev) => {
      const next = new Set(prev);
      filteredRecords.forEach((r) => next.add(r.sku));
      return next;
    });
  };

  const deselectAllMatching = () => {
    setSelectedSkus((prev) => {
      const next = new Set(prev);
      filteredRecords.forEach((r) => next.delete(r.sku));
      return next;
    });
  };

  // Metrics for Confirmation & Summary
  const selectedRecords = useMemo(() => {
    return allRecords.filter((r) => selectedSkus.has(r.sku));
  }, [allRecords, selectedSkus]);

  const activeSelectedCount = useMemo(() => {
    return selectedRecords.filter((r) => !r.isInactive).length;
  }, [selectedRecords]);

  const inactiveSelectedCount = useMemo(() => {
    return selectedRecords.filter((r) => r.isInactive).length;
  }, [selectedRecords]);

  const deselectedCount = allRecords.length - selectedRecords.length;

  // Batch network sender with retries
  const sendBatch = async (rows: UnifiedProductRecord[], startRow: number) => {
    let lastError = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const r = await fetch("/api/inventory/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: rows.map((p) => ({
              sku: p.sku,
              productNumber: p.productNumber,
              description: p.description,
              vendor: p.vendor,
              brand: p.brand,
              listCost: p.listCost,
              price: p.price,
              sizeDesc: p.sizeDesc,
              isInactive: p.isInactive,
            })),
            unified: true,
            startRow,
          }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          lastError = apiErrorText(d, "The server rejected this import batch.");
          if (r.status >= 400 && r.status < 500) break;
        } else {
          return d as {
            processed?: number;
            inserted: number;
            updated: number;
            skipped: number;
            failed: { row: number; sku: string; reason: string }[];
          };
        }
      } catch {
        lastError = "Could not reach the server.";
      }
      if (attempt < MAX_ATTEMPTS) await new Promise((res) => setTimeout(res, 800 * attempt));
    }
    throw new Error(lastError || "Import batch failed.");
  };

  // Execution
  const executeImport = async () => {
    if (!selectedRecords.length) {
      toast.warning("No products selected", "Select at least one product to import.");
      return;
    }

    setStep("importing");
    const batches = chunk(selectedRecords, BATCH_SIZE);
    const acc: ImportProgress = {
      total: selectedRecords.length,
      processed: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: [],
      batchIndex: 0,
      batchCount: batches.length,
    };
    setProgress(acc);
    const startedAt = Date.now();

    try {
      for (let i = 0; i < batches.length; i++) {
        setProgress({ ...acc, batchIndex: i + 1 });
        const startRow = 2 + i * BATCH_SIZE;
        try {
          const d = await sendBatch(batches[i], startRow);
          acc.processed += d.processed ?? batches[i].length;
          acc.inserted += d.inserted ?? 0;
          acc.updated += d.updated ?? 0;
          acc.skipped += d.skipped ?? 0;
          acc.failed.push(...(d.failed ?? []));
        } catch (e) {
          const reason = e instanceof Error ? e.message : "Batch failed.";
          acc.processed += batches[i].length;
          acc.failed.push(
            ...batches[i].map((r, j) => ({
              row: startRow + j,
              sku: r.sku,
              reason,
            }))
          );
        }
        setProgress({ ...acc });
      }

      // Record full import timestamp if zero failures
      if (!acc.failed.length) {
        try {
          await fetch("/api/inventory/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ completeFullImport: true }),
          });
        } catch {
          // Non-blocking
        }
      }

      const finishedAt = Date.now();
      const seconds = ((finishedAt - startedAt) / 1000).toFixed(1);

      setImportReport({
        status: "complete",
        totalInFile: allRecords.length,
        selectedCount: selectedRecords.length,
        deselectedCount,
        inserted: acc.inserted,
        updated: acc.updated,
        skipped: acc.skipped,
        failed: acc.failed,
        seconds,
      });
      setStep("complete");

      if (acc.failed.length) {
        toast.warning(
          "Import finished with some errors",
          `${acc.inserted} inserted, ${acc.updated} updated, ${acc.failed.length} failed.`
        );
      } else {
        toast.success(
          "Unified POS Import completed successfully",
          `${acc.inserted.toLocaleString()} new products added, ${acc.updated.toLocaleString()} updated.`
        );
      }

      // Notify parent to refresh catalog
      void onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Import failed.";
      setImportReport({
        status: "failed",
        totalInFile: allRecords.length,
        selectedCount: selectedRecords.length,
        deselectedCount,
        inserted: acc.inserted,
        updated: acc.updated,
        skipped: acc.skipped,
        failed: acc.failed,
        seconds: "0",
        error: msg,
      });
      setStep("complete");
      toast.error("Import execution stopped", msg);
    }
  };

  const importPct = progress && progress.total ? Math.floor((progress.processed / progress.total) * 100) : 0;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-2xs p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unified-import-title"
    >
      <div className="flex h-full max-h-[92vh] w-full max-w-6xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
        {/* Modal Header & Stepper */}
        <div className="flex flex-wrap items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white shadow-xs">
                POS
              </span>
              <h2 id="unified-import-title" className="text-base font-black tracking-tight text-slate-900 dark:text-white">
                Import POS Inventory (New)
              </h2>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                Unified Cleaner &amp; Importer
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
              Upload raw POS Excel export. Cleans, translates Active/Inactive, previews, and imports in one workflow.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Step Indicators */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-semibold">
              <span className={`px-2 py-1 rounded-md ${step === "upload" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                1. Upload
              </span>
              <span className="text-slate-300 dark:text-zinc-600">→</span>
              <span className={`px-2 py-1 rounded-md ${step === "preview" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                2. Preview &amp; Select
              </span>
              <span className="text-slate-300 dark:text-zinc-600">→</span>
              <span className={`px-2 py-1 rounded-md ${step === "confirm" || step === "importing" || step === "complete" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                3. Confirm &amp; Import
              </span>
            </div>

            <button
              type="button"
              disabled={step === "importing"}
              onClick={() => {
                handleReset();
                onClose();
              }}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 disabled:opacity-40"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* ============================================================ */}
          {/* STEP 1: UPLOAD & AUTOMATIC CLEANING */}
          {/* ============================================================ */}
          {step === "upload" && (
            <div className="flex flex-col items-center justify-center max-w-2xl mx-auto py-8">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={onFileChange}
              />

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragActive(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragActive(false);
                }}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`w-full group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition-all ${
                  dragActive
                    ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/20"
                    : "border-slate-300 bg-slate-50/50 hover:border-indigo-500 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/50 dark:hover:border-indigo-500"
                }`}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400 group-hover:scale-105 transition-transform">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>

                <h3 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
                  Drop your raw POS Excel file here
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                  Direct export from POS (Amber/Cybex). Supports .xlsx, .xls, and .csv
                </p>

                <button
                  type="button"
                  disabled={parsing}
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-60"
                >
                  {parsing ? (
                    <>
                      <Spinner />
                      <span>Reading &amp; Cleaning POS File...</span>
                    </>
                  ) : (
                    <span>Browse POS File</span>
                  )}
                </button>
              </div>

              {/* Error card if cleaning failed */}
              {cleaningResult && !cleaningResult.success && (
                <div className="mt-5 w-full rounded-xl border border-red-200 bg-red-50/80 p-4 dark:border-red-900/50 dark:bg-red-950/30">
                  <div className="flex items-start gap-3">
                    <span className="text-red-600 dark:text-red-400 font-bold">✕</span>
                    <div>
                      <h4 className="text-xs font-bold text-red-900 dark:text-red-200">
                        Could not process this file
                      </h4>
                      <p className="mt-1 text-xs text-red-700 dark:text-red-300">
                        {cleaningResult.error}
                      </p>
                      {cleaningResult.missingColumns.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {cleaningResult.missingColumns.map((col) => (
                            <span
                              key={col}
                              className="rounded border border-red-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-800 dark:border-red-800 dark:bg-zinc-900 dark:text-red-300"
                            >
                              Missing: {col}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Automatic cleaning specifications checklist */}
              <div className="mt-6 w-full rounded-xl border border-slate-200/90 bg-white p-4 text-xs dark:border-zinc-800 dark:bg-zinc-900">
                <span className="font-bold text-slate-800 dark:text-zinc-200">
                  Automatic Pre-Cleaning Applied:
                </span>
                <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-600 dark:text-zinc-400 text-[11px]">
                  <li className="flex items-center gap-1.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>Removes empty column A and detects real header row</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>Removes empty second row &amp; blank spacers</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>Extracts exactly 9 fields (ignores 25+ extra POS columns)</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>Maps INACTIVE: Y → Inactive, Blank/N/0 → Active</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>Preserves text &amp; leading zeros in SKUs &amp; Product #</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>Preserves exact Size Desc. and formats cost &amp; retail</span>
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP 2: PREVIEW & SELECTION */}
          {/* ============================================================ */}
          {step === "preview" && cleaningResult && (
            <div className="flex flex-col gap-4">
              {/* Summary Metrics Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
                  <div className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">Total Valid in File</div>
                  <div className="mt-0.5 text-lg font-black text-slate-900 dark:text-white">
                    {cleaningResult.totalRecords.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-900/40 dark:bg-indigo-950/20">
                  <div className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">Selected for Import</div>
                  <div className="mt-0.5 text-lg font-black text-indigo-700 dark:text-indigo-300">
                    {selectedSkus.size.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                  <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Active Products</div>
                  <div className="mt-0.5 text-lg font-black text-emerald-700 dark:text-emerald-300">
                    {cleaningResult.activeCount.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
                  <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">Inactive Products</div>
                  <div className="mt-0.5 text-lg font-black text-amber-700 dark:text-amber-300">
                    {cleaningResult.inactiveCount.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
                  <div className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">Deselected (Skipped)</div>
                  <div className="mt-0.5 text-lg font-black text-slate-700 dark:text-zinc-300">
                    {deselectedCount.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Search, Filter & Bulk Selection Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-white p-3 shadow-2xs dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex min-w-60 flex-1 items-center gap-2 max-w-md">
                  <input
                    type="text"
                    className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50/60 px-3 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    placeholder="Search SKU, Product #, Description, Vendor, Brand..."
                    value={previewSearch}
                    onChange={(e) => {
                      setPreviewSearch(e.target.value);
                      setPreviewPage(1);
                    }}
                  />
                  {previewSearch && (
                    <button
                      type="button"
                      onClick={() => setPreviewSearch("")}
                      className="text-xs text-slate-400 hover:text-slate-600"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Filter Tabs */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-[11px] font-semibold text-slate-500">Status:</span>
                  {(
                    [
                      ["all", "All"],
                      ["active", `Active (${cleaningResult.activeCount})`],
                      ["inactive", `Inactive (${cleaningResult.inactiveCount})`],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setStatusFilter(key);
                        setPreviewPage(1);
                      }}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                        statusFilter === key
                          ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}
                    >
                      {label}
                    </button>
                  ))}

                  <span className="ml-2 text-[11px] font-semibold text-slate-500">Selection:</span>
                  {(
                    [
                      ["all", "All"],
                      ["selected", "Selected"],
                      ["deselected", "Deselected"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setSelectionFilter(key);
                        setPreviewPage(1);
                      }}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                        selectionFilter === key
                          ? "bg-indigo-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Bulk Select Buttons */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  >
                    Select All ({allRecords.length})
                  </button>
                  <button
                    type="button"
                    onClick={deselectAll}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  >
                    Deselect All
                  </button>
                  {filteredRecords.length !== allRecords.length && (
                    <button
                      type="button"
                      onClick={selectAllMatching}
                      className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300"
                    >
                      Select Matching ({filteredRecords.length})
                    </button>
                  )}
                </div>
              </div>

              {/* Data Table */}
              <div className="rounded-xl border border-slate-200/90 bg-white shadow-2xs dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
                <div className="overflow-x-auto max-h-[460px]">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50/90 backdrop-blur-2xs border-b border-slate-200 text-[11px] font-bold text-slate-700 dark:bg-zinc-800/90 dark:border-zinc-700 dark:text-zinc-300">
                      <tr>
                        <th className="w-10 px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={
                              currentPageRecords.length > 0 &&
                              currentPageRecords.every((r) => selectedSkus.has(r.sku))
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedSkus((prev) => {
                                  const next = new Set(prev);
                                  currentPageRecords.forEach((r) => next.add(r.sku));
                                  return next;
                                });
                              } else {
                                setSelectedSkus((prev) => {
                                  const next = new Set(prev);
                                  currentPageRecords.forEach((r) => next.delete(r.sku));
                                  return next;
                                });
                              }
                            }}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            aria-label="Select/deselect current page"
                          />
                        </th>
                        <th className="px-3 py-2.5">SKU</th>
                        <th className="px-3 py-2.5">Product #</th>
                        <th className="px-3 py-2.5">Description</th>
                        <th className="px-3 py-2.5">Vendor</th>
                        <th className="px-3 py-2.5">Brand</th>
                        <th className="px-3 py-2.5 text-right">List Cost</th>
                        <th className="px-3 py-2.5 text-right">Price</th>
                        <th className="px-3 py-2.5">Size Desc</th>
                        <th className="px-3 py-2.5 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                      {currentPageRecords.map((r) => {
                        const isSelected = selectedSkus.has(r.sku);
                        return (
                          <tr
                            key={r.sku}
                            onClick={() => toggleRow(r.sku)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? "hover:bg-slate-50 dark:hover:bg-zinc-800/40"
                                : "bg-slate-50/50 opacity-60 hover:opacity-80 dark:bg-zinc-900/50"
                            }`}
                          >
                            <td
                              className="px-3 py-2 text-center"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleRow(r.sku)}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                aria-label={`Select ${r.sku}`}
                              />
                            </td>
                            <td className="px-3 py-2 font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">
                              {r.sku}
                              {r.isDuplicate && (
                                <span
                                  title="SKU appears multiple times in file (last occurrence imported)"
                                  className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                >
                                  DUP
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-600 dark:text-zinc-400 whitespace-nowrap">
                              {r.productNumber || "—"}
                            </td>
                            <td className="px-3 py-2 font-medium text-slate-800 dark:text-zinc-200 max-w-xs truncate">
                              {r.description}
                            </td>
                            <td className="px-3 py-2 text-slate-700 dark:text-zinc-300 whitespace-nowrap">
                              {r.vendor || "—"}
                            </td>
                            <td className="px-3 py-2 text-slate-600 dark:text-zinc-400 whitespace-nowrap">
                              {r.brand || "—"}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-slate-900 dark:text-white whitespace-nowrap">
                              ${r.listCost}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">
                              ${r.price}
                            </td>
                            <td className="px-3 py-2 text-slate-600 dark:text-zinc-400 whitespace-nowrap">
                              {r.sizeDesc || "—"}
                            </td>
                            <td className="px-3 py-2 text-center whitespace-nowrap">
                              <span
                                className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  r.isInactive
                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300"
                                    : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300"
                                }`}
                              >
                                {r.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {currentPageRecords.length === 0 && (
                        <tr>
                          <td colSpan={10} className="px-6 py-12 text-center text-slate-500">
                            No records found matching current criteria.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Table Pagination Bar */}
                <div className="flex flex-wrap items-center justify-between border-t border-slate-100 px-4 py-3 dark:border-zinc-800 text-xs">
                  <span className="text-slate-500 dark:text-zinc-400">
                    Showing Page <strong className="text-slate-800 dark:text-white">{previewPage}</strong> of{" "}
                    <strong className="text-slate-800 dark:text-white">{totalPages}</strong> ({filteredRecords.length.toLocaleString()} matching records)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={previewPage <= 1}
                      onClick={() => setPreviewPage((p) => p - 1)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                    >
                      ← Previous
                    </button>
                    <button
                      type="button"
                      disabled={previewPage >= totalPages}
                      onClick={() => setPreviewPage((p) => p + 1)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP 3: CONFIRM & EXECUTE IMPORT */}
          {/* ============================================================ */}
          {step === "confirm" && (
            <div className="max-w-2xl mx-auto py-4 flex flex-col gap-5">
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-5 dark:border-indigo-900/50 dark:bg-indigo-950/20">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Confirm Inventory Import
                </h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-zinc-400">
                  Please review the summary below before executing the catalog import.
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="text-[11px] text-slate-500">File Total</div>
                    <div className="text-base font-bold text-slate-900 dark:text-white">
                      {allRecords.length.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border border-indigo-200 bg-white p-3 dark:border-indigo-900 dark:bg-zinc-900">
                    <div className="text-[11px] text-indigo-700 dark:text-indigo-300">Selected to Import</div>
                    <div className="text-base font-bold text-indigo-700 dark:text-indigo-400">
                      {selectedRecords.length.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-white p-3 dark:border-emerald-900 dark:bg-zinc-900">
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-300">Active Products</div>
                    <div className="text-base font-bold text-emerald-700 dark:text-emerald-400">
                      {activeSelectedCount.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-white p-3 dark:border-amber-900 dark:bg-zinc-900">
                    <div className="text-[11px] text-amber-700 dark:text-amber-300">Inactive Products</div>
                    <div className="text-base font-bold text-amber-700 dark:text-amber-400">
                      {inactiveSelectedCount.toLocaleString()}
                    </div>
                  </div>
                </div>

                {deselectedCount > 0 && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                    <strong>{deselectedCount.toLocaleString()} products were deselected</strong> and will be skipped. They will not be imported or modified.
                  </div>
                )}

                {cleaningResult?.duplicateCount ? (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
                    ⚠️ {cleaningResult.duplicateCount} duplicate SKU occurrences detected in the file. The last occurrence in the file will be imported.
                  </div>
                ) : null}
              </div>

              {/* Explicit Replacement & Data Safety Guarantee */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-5 text-xs text-slate-700 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-300 leading-relaxed">
                <span className="font-bold text-slate-900 dark:text-white block mb-1">
                  Database Synchronization Behavior: Safe Upsert
                </span>
                <p>
                  • Matching products will be updated by exact SKU with current prices, list cost, size description, and status.
                </p>
                <p className="mt-1">
                  • Newly discovered SKUs will be added as fresh inventory items.
                </p>
                <p className="mt-1">
                  • Deselected rows and existing products not in this batch remain <strong>completely untouched</strong> in the database.
                </p>
                <p className="mt-1">
                  • <strong>Clear Inventory is not triggered.</strong> No existing products or historical price updates are deleted.
                </p>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP 4: IMPORT PROGRESS & RESULTS */}
          {/* ============================================================ */}
          {step === "importing" && progress && (
            <div className="max-w-xl mx-auto py-12 flex flex-col items-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400 mb-4 animate-pulse">
                <Spinner />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Importing POS Inventory...
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
                Batch {progress.batchIndex} of {progress.batchCount} ({progress.processed.toLocaleString()} / {progress.total.toLocaleString()} products)
              </p>

              <div className="mt-6 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800 h-3">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-all duration-200"
                  style={{ width: `${importPct}%` }}
                />
              </div>

              <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-1 text-xs text-slate-600 dark:text-zinc-400">
                <span>Inserted: <strong className="text-emerald-600">{progress.inserted.toLocaleString()}</strong></span>
                <span>Updated: <strong className="text-blue-600">{progress.updated.toLocaleString()}</strong></span>
                <span>Skipped: <strong>{progress.skipped.toLocaleString()}</strong></span>
                <span>Failed: <strong className="text-red-600">{progress.failed.length.toLocaleString()}</strong></span>
              </div>
            </div>
          )}

          {step === "complete" && importReport && (
            <div className="max-w-2xl mx-auto py-6 flex flex-col gap-4">
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center gap-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${importReport.failed.length ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"}`}>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      {importReport.failed.length ? "Import Completed with Warnings" : "POS Inventory Import Successful"}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-zinc-400">
                      Processed {importReport.selectedCount.toLocaleString()} selected products in {importReport.seconds}s.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                    <div className="text-[11px] text-slate-500">File Total</div>
                    <div className="text-base font-bold text-slate-900 dark:text-white">
                      {importReport.totalInFile.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-emerald-50/40 p-3 dark:border-zinc-800 dark:bg-emerald-950/20">
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-300">Inserted (New)</div>
                    <div className="text-base font-bold text-emerald-700 dark:text-emerald-400">
                      {importReport.inserted.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-blue-50/40 p-3 dark:border-zinc-800 dark:bg-blue-950/20">
                    <div className="text-[11px] text-blue-700 dark:text-blue-300">Updated</div>
                    <div className="text-base font-bold text-blue-700 dark:text-blue-400">
                      {importReport.updated.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                    <div className="text-[11px] text-slate-500">Deselected / Skipped</div>
                    <div className="text-base font-bold text-slate-700 dark:text-zinc-300">
                      {importReport.deselectedCount.toLocaleString()}
                    </div>
                  </div>
                </div>

                {importReport.failed.length > 0 && (
                  <div className="mt-4">
                    <button
                      type="button"
                      className="text-xs font-semibold text-red-600 underline"
                      onClick={() => setShowFailedRows((v) => !v)}
                    >
                      {showFailedRows ? "Hide failed rows" : `View Failed Rows (${importReport.failed.length})`}
                    </button>
                    {showFailedRows && (
                      <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-200 text-xs">
                        <table className="w-full">
                          <thead className="bg-slate-50 text-[11px]"><tr className="text-left"><th className="px-2 py-1">Row</th><th className="px-2 py-1">SKU</th><th className="px-2 py-1">Reason</th></tr></thead>
                          <tbody>
                            {importReport.failed.map((f, i) => (
                              <tr key={i} className="border-t">
                                <td className="px-2 py-1 font-mono">{f.row}</td>
                                <td className="px-2 py-1 font-mono">{f.sku}</td>
                                <td className="px-2 py-1 text-red-600">{f.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="flex flex-wrap items-center justify-between border-t border-slate-200 bg-slate-50/70 px-6 py-3.5 dark:border-zinc-800 dark:bg-zinc-900/60">
          <div>
            {fileName && (
              <span className="text-xs text-slate-500 dark:text-zinc-400">
                File: <strong className="text-slate-800 dark:text-white">{fileName}</strong>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {step === "preview" && (
              <>
                <button
                  type="button"
                  onClick={() => setStep("upload")}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  ← Choose Different File
                </button>
                <button
                  type="button"
                  disabled={selectedSkus.size === 0}
                  onClick={() => setStep("confirm")}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50"
                >
                  Proceed to Confirmation ({selectedSkus.size.toLocaleString()}) →
                </button>
              </>
            )}

            {step === "confirm" && (
              <>
                <button
                  type="button"
                  onClick={() => setStep("preview")}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  ← Back to Preview
                </button>
                <LoadingButton
                  busy={false}
                  onClick={executeImport}
                  className="rounded-lg bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700"
                >
                  Import Inventory
                </LoadingButton>
              </>
            )}

            {step === "complete" && (
              <button
                type="button"
                onClick={() => {
                  handleReset();
                  onClose();
                }}
                className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 dark:bg-white dark:text-slate-900"
              >
                Done &amp; View All Inventory
              </button>
            )}

            {step === "upload" && (
              <button
                type="button"
                onClick={() => {
                  handleReset();
                  onClose();
                }}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

