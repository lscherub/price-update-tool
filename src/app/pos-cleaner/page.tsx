"use client";

import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { useUiMode } from "@/contexts/UiModeContext";
import {
  POS_OUTPUT_COLUMNS,
  validateAndExtractPosRows,
  buildCleanedPosWorkbook,
  generateCleanedPosFilename,
  type PosExtractionResult,
} from "@/lib/posCleaner";

export default function PosCleanerPage() {
  const { mode } = useUiMode();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState<"idle" | "processing" | "ready" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusBadge, setStatusBadge] = useState("Waiting");
  const [extraction, setExtraction] = useState<PosExtractionResult | null>(null);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setStatus("processing");
    setStatusBadge("Reading file…");
    setStatusMessage("Parsing workbook in browser…");
    setExtraction(null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, {
        type: "array",
        cellDates: true,
        raw: false,
      });

      if (!workbook.SheetNames.length) {
        throw new Error("The workbook does not contain any worksheets.");
      }

      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: "",
        raw: false,
      });

      const result = validateAndExtractPosRows(matrix);
      setExtraction(result);

      if (!result.success) {
        setStatus("error");
        setStatusBadge("Error");
        setStatusMessage(result.error || "Unable to process this file.");
        return;
      }

      setStatus("ready");
      setStatusBadge("Ready");
      setStatusMessage(
        `Successfully validated and prepared ${result.totalProducts.toLocaleString()} product${
          result.totalProducts === 1 ? "" : "s"
        }.`
      );
    } catch (err: any) {
      setStatus("error");
      setStatusBadge("Error");
      setStatusMessage(err?.message || "Failed to read or parse file.");
      setExtraction(null);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDownload = () => {
    if (!extraction || !extraction.success || !extraction.rows.length) return;
    const wb = buildCleanedPosWorkbook(extraction.rows);
    const outName = generateCleanedPosFilename(fileName);
    XLSX.writeFile(wb, outName, { compression: true });
  };

  const handleReset = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
    setFileName("");
    setStatus("idle");
    setStatusMessage("");
    setStatusBadge("Waiting");
    setExtraction(null);
    setDragActive(false);
  };

  const isClassic = mode === "classic";

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto pb-12">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={onFileChange}
      />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center justify-center rounded-lg font-bold text-white shadow-xs ${
                isClassic ? "h-8 w-8 bg-slate-900 text-sm" : "h-9 w-9 bg-emerald-600 text-base"
              }`}
            >
              P
            </span>
            <h1
              className={
                isClassic
                  ? "text-xl font-bold text-slate-900"
                  : "text-2xl font-black tracking-tight text-slate-900 dark:text-white"
              }
            >
              POS Excel Cleaner
            </h1>
          </div>
          <p
            className={`mt-1 text-xs ${
              isClassic ? "text-slate-600" : "text-slate-500 dark:text-zinc-400"
            }`}
          >
            Upload your Amber/Cybex POS export to validate headers and download a clean 8-column Excel file.
          </p>
        </div>
      </div>

      {/* Drag & Drop Zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-all ${
          dragActive
            ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20"
            : isClassic
            ? "border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50"
            : "border-slate-300/80 bg-white hover:border-emerald-500/80 hover:bg-slate-50/50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-500/50 dark:hover:bg-zinc-800/60"
        }`}
      >
        <div
          className={`flex h-13 w-13 items-center justify-center rounded-2xl transition-transform group-hover:scale-105 ${
            isClassic
              ? "bg-slate-100 text-slate-800"
              : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400"
          }`}
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
          Drop your Excel or CSV file here
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">or click to browse from your device</p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
          className={`mt-4 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold text-white shadow-xs transition-colors ${
            isClassic
              ? "bg-slate-900 hover:bg-slate-800"
              : "bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          }`}
        >
          Choose Excel File
        </button>
        <span className="mt-3 text-[11px] text-slate-600 dark:text-zinc-300">
          Supports .xlsx, .xls, and .csv
        </span>
      </div>

      {/* File Status & Validation Card */}
      {status !== "idle" && (
        <div
          className={`rounded-2xl border p-5 shadow-xs transition-all ${
            isClassic
              ? "border-slate-200 bg-white"
              : "border-slate-200/90 bg-white dark:border-zinc-800 dark:bg-zinc-900"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                Uploaded File
              </span>
              <p className="text-sm font-bold text-slate-900 dark:text-white break-all">
                {fileName || "—"}
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                status === "ready"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300"
                  : status === "error"
                  ? "bg-red-100 text-red-800 dark:bg-red-950/80 dark:text-red-300"
                  : "bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              {statusBadge}
            </span>
          </div>

          <p
            className={`mt-3 text-xs ${
              status === "error"
                ? "text-red-600 dark:text-red-400 font-medium"
                : "text-slate-600 dark:text-zinc-300"
            }`}
          >
            {statusMessage}
          </p>

          {/* Column Checks */}
          <div className="mt-4 flex flex-wrap gap-2">
            {POS_OUTPUT_COLUMNS.map((col) => {
              const isMissing = extraction?.missingColumns.includes(col);
              const isFound = extraction?.foundColumns && extraction.foundColumns[col] !== -1;

              return (
                <span
                  key={col}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    isMissing
                      ? "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50"
                      : isFound
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50"
                      : "bg-slate-100 text-slate-500 border border-slate-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700"
                  }`}
                >
                  {isMissing ? (
                    <span className="text-red-500 font-bold">✕</span>
                  ) : isFound ? (
                    <span className="text-emerald-600 font-bold">✓</span>
                  ) : (
                    <span>•</span>
                  )}
                  <span>{col}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Output Columns Specification */}
      <div
        className={`rounded-2xl border p-5 shadow-xs ${
          isClassic
            ? "border-slate-200 bg-white"
            : "border-slate-200/90 bg-white dark:border-zinc-800 dark:bg-zinc-900"
        }`}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-zinc-800">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
              Required Schema
            </span>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Standard 8 Output Columns
            </h3>
          </div>
          <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
            Exact order
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {POS_OUTPUT_COLUMNS.map((col, idx) => (
            <div
              key={col}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
                isClassic
                  ? "border-slate-200 bg-slate-50 text-slate-800"
                  : "border-slate-200 bg-slate-50/70 text-slate-700 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300"
              }`}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600 dark:bg-zinc-700 dark:text-zinc-300">
                {idx + 1}
              </span>
              <span className="truncate">{col}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Output Preview */}
      {extraction?.success && extraction.rows.length > 0 && (
        <div
          className={`rounded-2xl border overflow-hidden shadow-xs ${
            isClassic
              ? "border-slate-200 bg-white"
              : "border-slate-200/90 bg-white dark:border-zinc-800 dark:bg-zinc-900"
          }`}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                Preview
              </span>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Cleaned Data Preview (first {Math.min(25, extraction.rows.length)} of {extraction.totalProducts.toLocaleString()})
              </h3>
            </div>
            <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
              {extraction.totalProducts.toLocaleString()} total products
            </span>
          </div>

          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200">
                <tr>
                  {POS_OUTPUT_COLUMNS.map((col) => (
                    <th key={col} className="px-3.5 py-2.5 font-bold border-b border-slate-200 dark:border-zinc-700 whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                {extraction.rows.slice(0, 25).map((row, i) => (
                  <tr
                    key={i}
                    className="hover:bg-slate-50/70 dark:hover:bg-zinc-800/40 transition-colors"
                  >
                    {POS_OUTPUT_COLUMNS.map((col) => (
                      <td
                        key={col}
                        className={`px-3.5 py-2 text-slate-800 dark:text-zinc-200 whitespace-nowrap ${
                          col === "Sku" ? "font-mono" : ""
                        }`}
                      >
                        {row[col] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!extraction?.success}
          onClick={handleDownload}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-bold text-white shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            isClassic
              ? "bg-slate-900 hover:bg-slate-800"
              : "bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          }`}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>Clean &amp; Download Excel</span>
        </button>

        <button
          type="button"
          onClick={handleReset}
          className={`rounded-xl border px-5 py-3.5 text-sm font-bold transition-colors ${
            isClassic
              ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          }`}
        >
          Reset
        </button>
      </div>

      {/* Privacy / Local Processing Notice */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-[11px] text-slate-600 dark:text-zinc-300">
        <span className="flex items-center gap-1.5">
          <svg className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          Processed entirely in your browser using client-side SheetJS.
        </span>
        <span>Your POS export file is never uploaded to any server.</span>
      </div>
    </div>
  );
}

