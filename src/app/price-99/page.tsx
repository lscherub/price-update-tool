"use client";

import React, { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { useUiMode } from "@/contexts/UiModeContext";
import { useToast } from "@/components/Toast";
import {
  buildPrice99Workbook,
  generatePrice99Filename,
  type Price99Action,
  type Price99BatchRecord,
  type Price99Item,
} from "@/lib/price99";

export default function Price99ManagerPage() {
  const { mode } = useUiMode();
  const toast = useToast();

  // Active view: "manager" | "history"
  const [activeTab, setActiveTab] = useState<"manager" | "history">("manager");

  // Selection state
  const [selectedItems, setSelectedItems] = useState<Price99Item[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Price99Item[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  // Export Preview Modal state
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<Price99Action>("CHECK");
  const [exportItems, setExportItems] = useState<Price99Item[]>([]);
  const [exporting, setExporting] = useState(false);

  // History state
  const [historyBatches, setHistoryBatches] = useState<Price99BatchRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyActionFilter, setHistoryActionFilter] = useState<string>("");
  const [selectedBatch, setSelectedBatch] = useState<Price99BatchRecord | null>(null);

  // Close search dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search for products
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/price-99/products?q=${encodeURIComponent(q)}&limit=15`, {
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && !controller.signal.aborted) {
          setSearchResults(Array.isArray(data.rows) ? data.rows : []);
        }
      } catch {
        /* aborted */
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [searchQuery]);

  // Load history batches
  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams();
      if (historySearch.trim()) params.set("q", historySearch.trim());
      if (historyActionFilter) params.set("action", historyActionFilter);

      const res = await fetch(`/api/price-99/history?${params.toString()}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.batches)) {
        setHistoryBatches(data.batches);
      }
    } catch {
      toast.error("Failed to load history batches");
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [historySearch, historyActionFilter]);

  // Add a product to selection (prevent duplicates)
  const addProduct = (item: Price99Item) => {
    if (selectedItems.some((p) => p.sku === item.sku)) {
      toast.info("Item already selected", `SKU ${item.sku} is already in the list.`);
      return;
    }
    setSelectedItems((prev) => [...prev, item]);
    setSearchQuery("");
    setSearchResults([]);
    setSearchFocused(false);
  };

  // Add all search results
  const addAllSearchResults = () => {
    const toAdd = searchResults.filter(
      (r) => !selectedItems.some((existing) => existing.sku === r.sku)
    );
    if (!toAdd.length) {
      toast.info("No new items", "All search results are already selected.");
      return;
    }
    setSelectedItems((prev) => [...prev, ...toAdd]);
    toast.success("Added products", `Added ${toAdd.length} product(s) to selection.`);
    setSearchQuery("");
    setSearchResults([]);
    setSearchFocused(false);
  };

  // Remove a product from selection
  const removeProduct = (sku: string) => {
    setSelectedItems((prev) => prev.filter((p) => p.sku !== sku));
  };

  // Clear all selected products
  const clearSelection = () => {
    setSelectedItems([]);
  };

  // Open export preview
  const openExportPreview = (action: Price99Action, items: Price99Item[] = selectedItems) => {
    if (!items.length) {
      toast.warning("No products selected", "Select at least one product before exporting.");
      return;
    }
    setPendingAction(action);
    setExportItems(items);
    setPreviewModalOpen(true);
  };

  // Execute export: downloads XLSX and records history
  const confirmExport = async () => {
    if (!exportItems.length) return;
    setExporting(true);

    try {
      // 1. Build & trigger browser download
      const wb = buildPrice99Workbook(exportItems, pendingAction);
      const filename = generatePrice99Filename(pendingAction);
      XLSX.writeFile(wb, filename, { compression: true });

      // 2. Persist to History in shared DB
      const res = await fetch("/api/price-99/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: pendingAction,
          items: exportItems,
        }),
      });

      if (!res.ok) {
        throw new Error("Could not record batch history.");
      }

      const { batch } = await res.json();
      toast.success(
        "Import file generated",
        `Batch ${batch.batchId} saved with ${exportItems.length} product(s).`
      );

      setPreviewModalOpen(false);
      loadHistory();
    } catch (err: any) {
      toast.error("Export Error", err?.message || "Failed to finalize export.");
    } finally {
      setExporting(false);
    }
  };

  // Load a batch into the active selection
  const loadBatchIntoSelection = (batch: Price99BatchRecord) => {
    setSelectedItems(batch.items);
    setSelectedBatch(null);
    setActiveTab("manager");
    toast.success("Loaded Batch", `Loaded ${batch.items.length} product(s) from batch ${batch.batchId}.`);
  };

  const isClassic = mode === "classic";

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto pb-16">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center justify-center rounded-lg font-bold text-white shadow-xs ${
                isClassic ? "h-8 w-8 bg-slate-900 text-sm" : "h-9 w-9 bg-indigo-600 text-base"
              }`}
            >
              99
            </span>
            <h1
              className={
                isClassic
                  ? "text-xl font-bold text-slate-900"
                  : "text-2xl font-black tracking-tight text-slate-900 dark:text-white"
              }
            >
              99 Price Manager
            </h1>
          </div>
          <p
            className={`mt-1 text-xs ${
              isClassic ? "text-slate-600" : "text-slate-500 dark:text-zinc-400"
            }`}
          >
            Select inventory products to generate Amber POS import files for updating the 99 Price column.
          </p>
        </div>

        {/* Tab Switcher */}
        <div
          className={`flex items-center gap-1 rounded-xl p-1 shadow-2xs border ${
            isClassic
              ? "bg-slate-100 border-slate-200"
              : "bg-slate-100/80 border-slate-200/90 dark:bg-zinc-900 dark:border-zinc-800"
          }`}
        >
          <button
            type="button"
            onClick={() => setActiveTab("manager")}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
              activeTab === "manager"
                ? "bg-white text-slate-900 shadow-xs dark:bg-zinc-800 dark:text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span>Product Selection ({selectedItems.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
              activeTab === "history"
                ? "bg-white text-slate-900 shadow-xs dark:bg-zinc-800 dark:text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Batch History ({historyBatches.length})</span>
          </button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* SECTION 1: PRODUCT SELECTION & EXPORT                    */}
      {/* ======================================================== */}
      {activeTab === "manager" && (
        <div className="flex flex-col gap-6">
          {/* Search Bar & Auto-Suggest */}
          <div
            ref={searchContainerRef}
            className={`relative rounded-2xl border p-5 shadow-xs transition-all ${
              isClassic
                ? "border-slate-200 bg-white"
                : "border-slate-200/90 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            }`}
          >
            <label className="block text-xs font-bold text-slate-900 dark:text-white mb-1.5">
              Search All Inventory
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400 dark:text-zinc-500">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                value={searchQuery}
                onFocus={() => setSearchFocused(true)}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by SKU, product description, vendor, or brand…"
                className={`w-full rounded-xl border py-2.5 pl-10 pr-10 text-xs transition-all outline-none ${
                  isClassic
                    ? "border-slate-300 focus:border-slate-600 bg-white"
                    : "border-slate-200 bg-slate-50/50 focus:border-indigo-500 focus:bg-white dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-white dark:focus:border-indigo-500"
                }`}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Results Dropdown */}
            {searchFocused && (searchResults.length > 0 || searching) && (
              <div
                className={`absolute left-0 right-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-xl border shadow-xl ${
                  isClassic
                    ? "border-slate-200 bg-white"
                    : "border-slate-200 bg-white dark:border-zinc-700 dark:bg-zinc-800"
                }`}
              >
                {searching && (
                  <div className="p-3 text-center text-xs text-slate-500 dark:text-zinc-400">
                    Searching inventory…
                  </div>
                )}

                {searchResults.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between border-b px-4 py-2 text-[11px] font-bold text-slate-500 dark:border-zinc-700 dark:text-zinc-400">
                      <span>Found {searchResults.length} matching products</span>
                      <button
                        type="button"
                        onClick={addAllSearchResults}
                        className="text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        + Add all matches
                      </button>
                    </div>

                    <ul className="divide-y divide-slate-100 dark:divide-zinc-700/60">
                      {searchResults.map((item) => {
                        const isAlreadySelected = selectedItems.some((s) => s.sku === item.sku);

                        return (
                          <li
                            key={item.sku}
                            className={`flex items-center justify-between gap-3 px-4 py-2.5 text-xs transition-colors hover:bg-slate-50 dark:hover:bg-zinc-700/50 ${
                              isAlreadySelected ? "opacity-60 bg-slate-50/50 dark:bg-zinc-800/40" : ""
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-slate-900 dark:text-white">
                                  {item.sku}
                                </span>
                                {item.brand && (
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-zinc-700 dark:text-zinc-300">
                                    {item.brand}
                                  </span>
                                )}
                                {item.vendor && (
                                  <span className="text-[11px] text-slate-400 dark:text-zinc-400 truncate">
                                    {item.vendor}
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 truncate text-slate-700 dark:text-zinc-300">
                                {item.description || "No description"}
                              </p>
                            </div>

                            <button
                              type="button"
                              disabled={isAlreadySelected}
                              onClick={() => addProduct(item)}
                              className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                                isAlreadySelected
                                  ? "bg-slate-100 text-slate-400 dark:bg-zinc-700 dark:text-zinc-400 cursor-default"
                                  : isClassic
                                  ? "bg-slate-900 text-white hover:bg-slate-800"
                                  : "bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
                              }`}
                            >
                              {isAlreadySelected ? "Added" : "+ Add"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Selected Products Table / List */}
          <div
            className={`rounded-2xl border shadow-xs overflow-hidden ${
              isClassic
                ? "border-slate-200 bg-white"
                : "border-slate-200/90 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                  Selected Items
                </span>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Products to Import ({selectedItems.length})
                </h2>
              </div>

              {selectedItems.length > 0 && (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-red-400 transition-colors"
                >
                  Clear Selection
                </button>
              )}
            </div>

            {selectedItems.length === 0 ? (
              <div className="p-10 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-zinc-800 dark:text-zinc-500">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <h3 className="mt-3 text-sm font-bold text-slate-800 dark:text-zinc-200">
                  No products selected yet
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                  Search by SKU or description above to add products to your export list.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-zinc-800/80 text-slate-600 dark:text-zinc-300">
                    <tr>
                      <th className="px-4 py-2.5 font-bold border-b border-slate-200 dark:border-zinc-700">#</th>
                      <th className="px-4 py-2.5 font-bold border-b border-slate-200 dark:border-zinc-700">SKU</th>
                      <th className="px-4 py-2.5 font-bold border-b border-slate-200 dark:border-zinc-700">Description</th>
                      <th className="px-4 py-2.5 font-bold border-b border-slate-200 dark:border-zinc-700">Brand</th>
                      <th className="px-4 py-2.5 font-bold border-b border-slate-200 dark:border-zinc-700">Vendor</th>
                      <th className="px-4 py-2.5 font-bold border-b border-slate-200 dark:border-zinc-700 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                    {selectedItems.map((item, idx) => (
                      <tr
                        key={item.sku}
                        className="hover:bg-slate-50/70 dark:hover:bg-zinc-800/40 transition-colors"
                      >
                        <td className="px-4 py-2 text-slate-600 dark:text-zinc-300 w-10">
                          {idx + 1}
                        </td>
                        <td className="px-4 py-2 font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">
                          {item.sku}
                        </td>
                        <td className="px-4 py-2 text-slate-800 dark:text-zinc-200">
                          {item.description || "—"}
                        </td>
                        <td className="px-4 py-2 text-slate-600 dark:text-zinc-400 whitespace-nowrap">
                          {item.brand || "—"}
                        </td>
                        <td className="px-4 py-2 text-slate-600 dark:text-zinc-400 whitespace-nowrap">
                          {item.vendor || "—"}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => removeProduct(item.sku)}
                            className="rounded p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                            title="Remove product"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Export Action Buttons */}
          <div
            className={`rounded-2xl border p-5 shadow-xs ${
              isClassic
                ? "border-slate-200 bg-white"
                : "border-slate-200/90 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Export to Amber POS
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
                  Generates a two-column Excel file containing exact SKUs and the updated 99 Price value.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={selectedItems.length === 0}
                  onClick={() => openExportPreview("CHECK")}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white shadow-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    isClassic
                      ? "bg-emerald-700 hover:bg-emerald-800"
                      : "bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  }`}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Check 99 Price (Y)</span>
                </button>

                <button
                  type="button"
                  disabled={selectedItems.length === 0}
                  onClick={() => openExportPreview("UNCHECK")}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white shadow-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    isClassic
                      ? "bg-slate-700 hover:bg-slate-800"
                      : "bg-slate-700 hover:bg-slate-800 dark:bg-zinc-700 dark:hover:bg-zinc-600"
                  }`}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  <span>Uncheck 99 Price (Blank)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* SECTION 2: DEDICATED HISTORY SECTION                     */}
      {/* ======================================================== */}
      {activeTab === "history" && (
        <div className="flex flex-col gap-5">
          {/* History Search & Filters */}
          <div
            className={`rounded-2xl border p-4 shadow-xs ${
              isClassic
                ? "border-slate-200 bg-white"
                : "border-slate-200/90 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex-1 min-w-[240px]">
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Filter history by Batch ID, SKU, product, or user…"
                  className={`w-full rounded-xl border py-2 px-3.5 text-xs transition-all outline-none ${
                    isClassic
                      ? "border-slate-300 focus:border-slate-600 bg-white"
                      : "border-slate-200 bg-slate-50/50 focus:border-indigo-500 focus:bg-white dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-white"
                  }`}
                />
              </div>

              {/* Action Filter */}
              <div className="flex items-center gap-1.5">
                {[
                  { value: "", label: "All Actions" },
                  { value: "CHECK", label: "Check (Y)" },
                  { value: "UNCHECK", label: "Uncheck (Blank)" },
                ].map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setHistoryActionFilter(f.value)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                      historyActionFilter === f.value
                        ? isClassic
                          ? "bg-slate-900 text-white"
                          : "bg-indigo-600 text-white dark:bg-indigo-500"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Batches List Table */}
          <div
            className={`rounded-2xl border shadow-xs overflow-hidden ${
              isClassic
                ? "border-slate-200 bg-white"
                : "border-slate-200/90 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            }`}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-zinc-800">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Export Batch History ({historyBatches.length})
              </h2>
              <button
                type="button"
                onClick={loadHistory}
                className="text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
              >
                ↻ Refresh
              </button>
            </div>

            {historyLoading ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-zinc-400">
                Loading history…
              </div>
            ) : historyBatches.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-zinc-400">
                No history records found. Batches will appear here whenever an import file is generated.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 dark:bg-zinc-800/80 text-slate-600 dark:text-zinc-300">
                    <tr>
                      <th className="px-4 py-2.5 font-bold border-b border-slate-200 dark:border-zinc-700">Batch ID</th>
                      <th className="px-4 py-2.5 font-bold border-b border-slate-200 dark:border-zinc-700">Date &amp; Time</th>
                      <th className="px-4 py-2.5 font-bold border-b border-slate-200 dark:border-zinc-700">Action</th>
                      <th className="px-4 py-2.5 font-bold border-b border-slate-200 dark:border-zinc-700">Products</th>
                      <th className="px-4 py-2.5 font-bold border-b border-slate-200 dark:border-zinc-700">Created By</th>
                      <th className="px-4 py-2.5 font-bold border-b border-slate-200 dark:border-zinc-700 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                    {historyBatches.map((batch) => (
                      <tr
                        key={batch.batchId}
                        className="hover:bg-slate-50/70 dark:hover:bg-zinc-800/40 transition-colors"
                      >
                        <td className="px-4 py-2.5 font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">
                          {batch.batchId}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-zinc-400 whitespace-nowrap">
                          {new Date(batch.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              batch.action === "CHECK"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300"
                                : "bg-slate-200 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}
                          >
                            {batch.action === "CHECK" ? "✓ Check (Y)" : "— Uncheck (Blank)"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-semibold text-slate-800 dark:text-zinc-200 whitespace-nowrap">
                          {batch.productCount} item{batch.productCount === 1 ? "" : "s"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 dark:text-zinc-400 truncate max-w-[150px]">
                          {batch.createdBy || "System"}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedBatch(batch)}
                              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
                            >
                              Open Details
                            </button>
                            <button
                              type="button"
                              onClick={() => loadBatchIntoSelection(batch)}
                              className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-indigo-600 hover:bg-indigo-50 dark:bg-zinc-800 dark:text-indigo-400 dark:hover:bg-zinc-700 transition-colors"
                              title="Load products into current selector"
                            >
                              Load
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* EXPORT CONFIRMATION / PREVIEW MODAL                      */}
      {/* ======================================================== */}
      {previewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div
            className={`w-full max-w-xl rounded-2xl border p-6 shadow-xl ${
              isClassic
                ? "border-slate-200 bg-white"
                : "border-slate-200/90 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-zinc-800">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                  Amber POS Import File Preview
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Confirm Export &amp; Generate File
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewModalOpen(false)}
                className="rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
                  <span className="text-slate-500 dark:text-zinc-400">Target Action</span>
                  <div className="mt-1 font-bold text-slate-900 dark:text-white">
                    {pendingAction === "CHECK" ? "Check 99 Price ('Y')" : "Uncheck 99 Price (Blank Cell)"}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
                  <span className="text-slate-500 dark:text-zinc-400">Total Products</span>
                  <div className="mt-1 font-bold text-slate-900 dark:text-white">
                    {exportItems.length.toLocaleString()} products
                  </div>
                </div>
              </div>

              {/* Data Table Preview */}
              <div className="rounded-xl border border-slate-200 overflow-hidden dark:border-zinc-800">
                <div className="bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-600 dark:bg-zinc-800 dark:text-zinc-300">
                  Import Spreadsheet Columns Preview
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 sticky top-0">
                      <tr>
                        <th className="px-3 py-1.5 font-bold border-b border-slate-200 dark:border-zinc-700">Sku</th>
                        <th className="px-3 py-1.5 font-bold border-b border-slate-200 dark:border-zinc-700">99 Price</th>
                        <th className="px-3 py-1.5 font-bold border-b border-slate-200 dark:border-zinc-700">Product Info</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                      {exportItems.slice(0, 10).map((item) => (
                        <tr key={item.sku}>
                          <td className="px-3 py-1.5 font-mono font-bold text-slate-900 dark:text-white">
                            {item.sku}
                          </td>
                          <td className="px-3 py-1.5">
                            {pendingAction === "CHECK" ? (
                              <span className="font-bold text-emerald-600 dark:text-emerald-400">Y</span>
                            ) : (
                              <span className="italic text-slate-600 dark:text-zinc-300">(blank)</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-slate-600 dark:text-zinc-400 truncate max-w-[200px]">
                            {item.description || item.brand || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {exportItems.length > 10 && (
                  <div className="bg-slate-50 px-3 py-1 text-center text-[11px] text-slate-500 dark:bg-zinc-800 dark:text-zinc-400">
                    + {exportItems.length - 10} more rows
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setPreviewModalOpen(false)}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={confirmExport}
                className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold text-white shadow-xs transition-all ${
                  pendingAction === "CHECK"
                    ? isClassic
                      ? "bg-emerald-700 hover:bg-emerald-800"
                      : "bg-emerald-600 hover:bg-emerald-700"
                    : isClassic
                    ? "bg-slate-900 hover:bg-slate-800"
                    : "bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500"
                }`}
              >
                {exporting ? (
                  <span>Generating…</span>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <span>Download &amp; Save Batch</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* BATCH DETAIL / RE-EXPORT MODAL                           */}
      {/* ======================================================== */}
      {selectedBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div
            className={`w-full max-w-2xl rounded-2xl border p-6 shadow-xl ${
              isClassic
                ? "border-slate-200 bg-white"
                : "border-slate-200/90 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-zinc-800">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                  Batch Details
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white font-mono">
                  {selectedBatch.batchId}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBatch(null)}
                className="rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
                  <span className="text-slate-500 dark:text-zinc-400">Original Action</span>
                  <div className="mt-1 font-bold text-slate-900 dark:text-white">
                    {selectedBatch.action === "CHECK" ? "Check (Y)" : "Uncheck (Blank)"}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
                  <span className="text-slate-500 dark:text-zinc-400">Created Date</span>
                  <div className="mt-1 font-semibold text-slate-900 dark:text-white">
                    {new Date(selectedBatch.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
                  <span className="text-slate-500 dark:text-zinc-400">Product Count</span>
                  <div className="mt-1 font-bold text-slate-900 dark:text-white">
                    {selectedBatch.productCount} items
                  </div>
                </div>
              </div>

              {/* Items List */}
              <div className="rounded-xl border border-slate-200 overflow-hidden dark:border-zinc-800">
                <div className="max-h-56 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 font-bold border-b border-slate-200 dark:border-zinc-700">#</th>
                        <th className="px-3 py-2 font-bold border-b border-slate-200 dark:border-zinc-700">SKU</th>
                        <th className="px-3 py-2 font-bold border-b border-slate-200 dark:border-zinc-700">Description</th>
                        <th className="px-3 py-2 font-bold border-b border-slate-200 dark:border-zinc-700">Brand / Vendor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                      {selectedBatch.items.map((item, idx) => (
                        <tr key={item.sku}>
                          <td className="px-3 py-1.5 text-slate-600 dark:text-zinc-300 w-8">{idx + 1}</td>
                          <td className="px-3 py-1.5 font-mono font-bold text-slate-900 dark:text-white">
                            {item.sku}
                          </td>
                          <td className="px-3 py-1.5 text-slate-800 dark:text-zinc-200">
                            {item.description || "—"}
                          </td>
                          <td className="px-3 py-1.5 text-slate-600 dark:text-zinc-400">
                            {[item.brand, item.vendor].filter(Boolean).join(" / ") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Re-export and reuse actions */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => loadBatchIntoSelection(selectedBatch)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
              >
                Load into Active Selection
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const batchItems = selectedBatch.items;
                    setSelectedBatch(null);
                    openExportPreview("CHECK", batchItems);
                  }}
                  className="rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition-colors"
                >
                  Export as Check (Y)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const batchItems = selectedBatch.items;
                    setSelectedBatch(null);
                    openExportPreview("UNCHECK", batchItems);
                  }}
                  className="rounded-xl bg-slate-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800 dark:bg-zinc-700 dark:hover:bg-zinc-600 transition-colors"
                >
                  Export as Uncheck (Blank)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

