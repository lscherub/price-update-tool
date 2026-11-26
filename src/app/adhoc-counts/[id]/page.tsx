"use client";

import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  formatAdHocDisplayDate,
  type AdHocCountItemData,
  type AdHocCountSheetData,
  type AdHocSheetStatus,
} from "@/lib/adhocCount";
import { LoadingButton } from "@/components/LoadingButton";
import { BulkPastePreviewDialog } from "@/components/adhoc-counts/BulkPastePreviewDialog";
import { useUiMode } from "@/contexts/UiModeContext";

export default function AdHocCountWorksheetPage() {
  const router = useRouter();
  const params = useParams();
  const sheetId = params.id as string;
  const { registerUnsavedChecker } = useUiMode();

  const [sheet, setSheet] = useState<AdHocCountSheetData | null>(null);
  const [items, setItems] = useState<AdHocCountItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Sheet Name editing
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");

  // Single SKU Add Input
  const [singleSku, setSingleSku] = useState("");
  const [singleAdding, setSingleAdding] = useState(false);

  // Bulk Dialog
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);

  // Table Search, Sort, Pagination
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<keyof AdHocCountItemData>("orderIndex");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Editing SKU modal or inline
  const [editingSkuItemId, setEditingSkuItemId] = useState<string | null>(null);
  const [editingSkuValue, setEditingSkuValue] = useState("");
  const [editingSkuBusy, setEditingSkuBusy] = useState(false);

  // Delete modal state
  const [deleteConfirmType, setDeleteConfirmType] = useState<"selected" | "all" | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  // Exporting
  const [exporting, setExporting] = useState(false);

  // Ref to hold current items for autosave / unsaved checks
  const itemsRef = useRef<AdHocCountItemData[]>(items);
  itemsRef.current = items;
  const hasUnsavedRef = useRef(hasUnsavedChanges);
  hasUnsavedRef.current = hasUnsavedChanges;

  // Register unsaved checker for UI mode context
  useEffect(() => {
    return registerUnsavedChecker(() => hasUnsavedRef.current);
  }, [registerUnsavedChecker]);

  // Window beforeunload prompt when unsaved
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Fetch sheet and items
  const loadSheet = useCallback(async () => {
    if (!sheetId) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/adhoc-counts/${sheetId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load count sheet.");

      setSheet(data.sheet);
      setItems(data.sheet.items || []);
      setNameInput(data.sheet.name);
      setHasUnsavedChanges(false);
      setLastSavedTime(new Date().toLocaleTimeString());
    } catch (err: any) {
      setError(err.message || "Failed to load count sheet.");
    } finally {
      setLoading(false);
    }
  }, [sheetId]);

  useEffect(() => {
    loadSheet();
  }, [loadSheet]);

  // Save changes to backend
  const saveChanges = async (currentItemsToSave = items) => {
    if (!sheetId) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/adhoc-counts/${sheetId}/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: currentItemsToSave }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save changes.");

      setItems(data.items || currentItemsToSave);
      setHasUnsavedChanges(false);
      setLastSavedTime(new Date().toLocaleTimeString());
      setSuccessMessage("Changes saved successfully.");
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err: any) {
      setError(err.message || "Error saving changes.");
    } finally {
      setSaving(false);
    }
  };

  // Debounced autosave
  const autosaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const queueAutosave = (newItems: AdHocCountItemData[]) => {
    setItems(newItems);
    setHasUnsavedChanges(true);

    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }
    autosaveTimeoutRef.current = setTimeout(() => {
      saveChanges(newItems);
    }, 2000);
  };

  // Sheet Name Update
  const handleNameSave = async () => {
    if (!nameInput.trim() || nameInput.trim() === sheet?.name) {
      setIsEditingName(false);
      return;
    }
    try {
      const res = await fetch(`/api/adhoc-counts/${sheetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update sheet name.");
      setSheet((prev) => (prev ? { ...prev, name: data.sheet.name } : null));
      setIsEditingName(false);
    } catch (err: any) {
      setError(err.message || "Could not update sheet name.");
    }
  };

  // Status Toggle
  const handleToggleStatus = async () => {
    if (!sheet) return;
    const nextStatus: AdHocSheetStatus = sheet.status === "Completed" ? "In Progress" : "Completed";
    try {
      const res = await fetch(`/api/adhoc-counts/${sheetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status.");
      setSheet((prev) => (prev ? { ...prev, status: data.sheet.status } : null));
    } catch (err: any) {
      setError(err.message || "Could not update status.");
    }
  };

  // Option A: Single SKU Add
  const handleAddSingleSku = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = singleSku.trim();
    if (!raw) return;

    setSingleAdding(true);
    setError("");
    try {
      const res = await fetch(`/api/adhoc-counts/${sheetId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: raw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add product.");

      setItems(data.items || []);
      setSingleSku("");
      setSuccessMessage(`Added SKU ${raw}`);
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err: any) {
      setError(err.message || "Could not add product.");
    } finally {
      setSingleAdding(false);
    }
  };

  // Option B: Bulk Add callback from preview dialog
  const handleBulkAddConfirm = async (
    newProducts: Array<{
      sku: string;
      brand: string;
      description: string;
      sizeDesc: string;
      matched: boolean;
    }>,
  ) => {
    setError("");
    const res = await fetch(`/api/adhoc-counts/${sheetId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: newProducts }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to add bulk products.");

    setItems(data.items || []);
    setSuccessMessage(`Added ${newProducts.length} product${newProducts.length === 1 ? "" : "s"}.`);
    setTimeout(() => setSuccessMessage(""), 3000);
  };

  // Edit SKU of existing row
  const handleStartEditSku = (item: AdHocCountItemData) => {
    setEditingSkuItemId(item.id);
    setEditingSkuValue(item.sku);
  };

  const handleSaveEditedSku = async () => {
    if (!editingSkuItemId) return;
    const newSku = editingSkuValue.trim();
    const item = items.find((it) => it.id === editingSkuItemId);
    if (!item) return;

    if (!newSku || newSku === item.sku) {
      setEditingSkuItemId(null);
      return;
    }

    setEditingSkuBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/adhoc-counts/${sheetId}/items/${editingSkuItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: newSku }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update SKU.");

      // Replace updated item in local state
      setItems((prev) =>
        prev.map((it) => (it.id === editingSkuItemId ? data.item : it)),
      );
      setEditingSkuItemId(null);
      setSuccessMessage(`Updated SKU to ${newSku} and refreshed product details.`);
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to update SKU.");
    } finally {
      setEditingSkuBusy(false);
    }
  };

  // Handle Count Field Change (QQH, LAYWAY, PREPAID, Expiry, On Transfer)
  const handleCountFieldChange = (
    itemId: string,
    field: "qqh" | "layway" | "prepaid" | "expiry" | "onTransfer",
    val: string,
  ) => {
    const updated = items.map((it) => {
      if (it.id === itemId) {
        return { ...it, [field]: val };
      }
      return it;
    });
    queueAutosave(updated);
  };

  // Delete Individual Row
  const handleDeleteRow = async (itemId: string) => {
    setError("");
    try {
      const res = await fetch(`/api/adhoc-counts/${sheetId}/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: [itemId] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete item.");

      setItems((prev) => prev.filter((it) => it.id !== itemId));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    } catch (err: any) {
      setError(err.message || "Failed to delete item.");
    }
  };

  // Bulk Delete Selected or All Rows
  const handleConfirmDelete = async () => {
    if (!deleteConfirmType) return;
    setDeletingBusy(true);
    setError("");
    try {
      if (deleteConfirmType === "all") {
        const res = await fetch(`/api/adhoc-counts/${sheetId}/items`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ all: true }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to clear sheet.");

        setItems([]);
        setSelectedIds(new Set());
      } else {
        const idsToDelete = Array.from(selectedIds);
        const res = await fetch(`/api/adhoc-counts/${sheetId}/items`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemIds: idsToDelete }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to delete selected items.");

        setItems((prev) => prev.filter((it) => !selectedIds.has(it.id)));
        setSelectedIds(new Set());
      }
      setDeleteConfirmType(null);
    } catch (err: any) {
      setError(err.message || "Failed to delete products.");
    } finally {
      setDeletingBusy(false);
    }
  };

  // Export for Teams (Excel)
  const handleExportExcel = async () => {
    if (!sheet) return;
    setExporting(true);
    setError("");
    try {
      // First save any unsaved changes
      if (hasUnsavedRef.current) {
        await saveChanges(itemsRef.current);
      }

      const res = await fetch(`/api/adhoc-counts/${sheetId}/export/excel`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate Excel export.");
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get("content-disposition") || "";
      let filename = "Inventory Count - Teams Count.xlsx";

      const match = contentDisposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
      if (match && match[1]) {
        filename = decodeURIComponent(match[1].replace(/["']/g, "").trim());
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || "Could not export to Excel.");
    } finally {
      setExporting(false);
    }
  };

  // Sorting Handler
  const handleSort = (column: keyof AdHocCountItemData) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  // Filter & Sort Items
  const filteredAndSortedItems = useMemo(() => {
    let result = [...items];

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (it) =>
          it.sku.toLowerCase().includes(q) ||
          it.brand.toLowerCase().includes(q) ||
          it.description.toLowerCase().includes(q) ||
          it.sizeDesc.toLowerCase().includes(q) ||
          it.qqh.toLowerCase().includes(q) ||
          it.layway.toLowerCase().includes(q) ||
          it.prepaid.toLowerCase().includes(q) ||
          it.expiry.toLowerCase().includes(q) ||
          it.onTransfer.toLowerCase().includes(q),
      );
    }

    result.sort((a, b) => {
      let valA = a[sortColumn];
      let valB = b[sortColumn];

      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();

      if (valA < valB) return sortDirection === "asc" ? -1 : 1;
      if (valA > valB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [items, searchQuery, sortColumn, sortDirection]);

  // Paginated Items
  const paginatedItems = useMemo(() => {
    if (pageSize >= filteredAndSortedItems.length) return filteredAndSortedItems;
    const start = (currentPage - 1) * pageSize;
    return filteredAndSortedItems.slice(start, start + pageSize);
  }, [filteredAndSortedItems, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredAndSortedItems.length / pageSize) || 1;

  // Toggle selection for item
  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Toggle select all on current page
  const toggleSelectAllCurrent = (select: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      paginatedItems.forEach((it) => {
        if (select) next.add(it.id);
        else next.delete(it.id);
      });
      return next;
    });
  };

  const isAllCurrentSelected =
    paginatedItems.length > 0 && paginatedItems.every((it) => selectedIds.has(it.id));

  if (loading && !sheet) {
    return (
      <div className="flex h-64 items-center justify-center text-xs text-slate-500 dark:text-zinc-400">
        Loading inventory count sheet...
      </div>
    );
  }

  if (!sheet) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">Count sheet not found</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
          The requested sheet may have been deleted or does not exist.
        </p>
        <Link
          href="/adhoc-counts"
          className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700"
        >
          ← Return to Count Sheets
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header & Actions Bar */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/adhoc-counts"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 shadow-2xs hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              ← Sheets History
            </Link>

            <span className="text-slate-300 dark:text-zinc-700">/</span>

            {/* Editable Title */}
            {isEditingName ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleNameSave();
                    if (e.key === "Escape") setIsEditingName(false);
                  }}
                  autoFocus
                  className="rounded-lg border border-indigo-600 bg-white px-3 py-1 text-base font-bold text-slate-900 focus:outline-hidden dark:bg-zinc-800 dark:text-white"
                />
                <button
                  type="button"
                  onClick={handleNameSave}
                  className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-indigo-700"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingName(false)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                  {sheet.name}
                </h1>
                <button
                  type="button"
                  onClick={() => {
                    setNameInput(sheet.name);
                    setIsEditingName(true);
                  }}
                  title="Rename count sheet"
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Right Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Status Badge Toggle */}
            <button
              type="button"
              onClick={handleToggleStatus}
              title="Click to toggle status between In Progress and Completed"
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold shadow-2xs transition-colors ${
                sheet.status === "Completed"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/80 dark:text-emerald-300"
                  : "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/80 dark:text-blue-300"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  sheet.status === "Completed" ? "bg-emerald-500" : "bg-blue-500"
                }`}
              />
              {sheet.status}
              <span className="text-[10px] text-slate-400 dark:text-zinc-500">▾</span>
            </button>

            {/* Save Button & Status Indicator */}
            <LoadingButton
              type="button"
              busy={saving}
              onClick={() => saveChanges(items)}
              disabled={!hasUnsavedChanges}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-bold shadow-2xs transition-colors ${
                hasUnsavedChanges
                  ? "bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                  : "border border-slate-200 bg-white text-slate-400 opacity-80 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500"
              }`}
            >
              {saving ? "Saving..." : hasUnsavedChanges ? "Save Changes" : "Saved"}
            </LoadingButton>

            {/* Export for Teams Button */}
            <LoadingButton
              type="button"
              busy={exporting}
              onClick={handleExportExcel}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export for Teams (.xlsx)
            </LoadingButton>
          </div>
        </div>

        {/* Subtitle / Timestamp Info */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-zinc-400">
          <span>Created: {formatAdHocDisplayDate(sheet.createdAt)}</span>
          <span>•</span>
          <span>Last Updated: {formatAdHocDisplayDate(sheet.updatedAt)}</span>
          {lastSavedTime && (
            <>
              <span>•</span>
              <span className="text-emerald-600 dark:text-emerald-400">Last saved at {lastSavedTime}</span>
            </>
          )}
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-300">
          {successMessage}
        </div>
      )}

      {/* Product Entry Bar: Option A (Single) & Option B (Bulk) */}
      <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-zinc-800 dark:bg-zinc-900 md:grid-cols-12">
        {/* Option A: Single UPC/SKU entry */}
        <form onSubmit={handleAddSingleSku} className="flex flex-col gap-2 md:col-span-8">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300">
            Quick Add Product (Enter or Scan SKU / UPC)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={singleSku}
              onChange={(e) => setSingleSku(e.target.value)}
              placeholder="e.g. 62773300207 or scan barcode..."
              className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:bg-white focus:outline-hidden dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:bg-zinc-900"
            />
            <LoadingButton
              type="submit"
              busy={singleAdding}
              disabled={!singleSku.trim()}
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
            >
              Add Product
            </LoadingButton>
          </div>
        </form>

        {/* Option B: Bulk Paste Button */}
        <div className="flex flex-col justify-end gap-2 border-t border-slate-200 pt-3 dark:border-zinc-800 md:col-span-4 md:border-t-0 md:border-l md:pt-0 md:pl-4">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300">
            Multiple Products
          </label>
          <button
            type="button"
            onClick={() => setBulkDialogOpen(true)}
            className="flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-bold text-indigo-700 shadow-2xs hover:bg-indigo-100 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            Bulk Paste UPCs...
          </button>
        </div>
      </div>

      {/* Spreadsheet Table Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-zinc-800 dark:bg-zinc-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* Table Search */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search table products..."
              className="w-56 rounded-xl border border-slate-200 bg-slate-50 py-1.5 pr-3 pl-8 text-xs text-slate-900 focus:border-indigo-600 focus:bg-white focus:outline-hidden dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:bg-zinc-900 sm:w-64"
            />
            <svg
              className="absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400 dark:text-zinc-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          {/* Product count */}
          <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-zinc-800 dark:text-zinc-300">
            {filteredAndSortedItems.length} product{filteredAndSortedItems.length === 1 ? "" : "s"}
          </span>
        </div>

        {/* Selection actions & Clear all */}
        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => setDeleteConfirmType("selected")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-300"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete Selected ({selectedIds.size})
            </button>
          )}

          {items.length > 0 && (
            <button
              type="button"
              onClick={() => setDeleteConfirmType("all")}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-red-400"
            >
              Clear Entire Sheet
            </button>
          )}

          {/* Page size selector */}
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          >
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
            <option value={5000}>Show All</option>
          </select>
        </div>
      </div>

      {/* Spreadsheet Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="density-table w-full border-collapse text-left text-xs">
            {/* Table Header */}
            <thead>
              {/* Group header labels */}
              <tr className="border-b border-slate-200 bg-slate-100/70 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-400">
                <th className="w-10 px-3 py-1.5"></th>
                <th colSpan={4} className="border-r border-slate-200 px-3 py-1.5 text-slate-600 dark:border-zinc-800 dark:text-zinc-300">
                  Inventory-Derived Fields (All Inventory)
                </th>
                <th colSpan={5} className="border-r border-slate-200 px-3 py-1.5 text-indigo-700 dark:border-zinc-800 dark:text-indigo-400">
                  Staff Entry Columns (Store Count Counts & Notes)
                </th>
                <th className="w-10 px-3 py-1.5"></th>
              </tr>

              {/* Exact 9 Column Headers */}
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-700 dark:border-zinc-800 dark:bg-zinc-800/90 dark:text-zinc-300">
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={isAllCurrentSelected}
                    onChange={(e) => toggleSelectAllCurrent(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                </th>

                {/* 1. SKU/UPC */}
                <th
                  onClick={() => handleSort("sku")}
                  className="cursor-pointer px-3 py-2.5 hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  <div className="flex items-center gap-1">
                    <span>SKU/UPC</span>
                    {sortColumn === "sku" && <span>{sortDirection === "asc" ? "▲" : "▼"}</span>}
                  </div>
                </th>

                {/* 2. Brand */}
                <th
                  onClick={() => handleSort("brand")}
                  className="cursor-pointer px-3 py-2.5 hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  <div className="flex items-center gap-1">
                    <span>Brand</span>
                    {sortColumn === "brand" && <span>{sortDirection === "asc" ? "▲" : "▼"}</span>}
                  </div>
                </th>

                {/* 3. Description */}
                <th
                  onClick={() => handleSort("description")}
                  className="cursor-pointer px-3 py-2.5 hover:text-indigo-600 dark:hover:text-indigo-400 min-w-48"
                >
                  <div className="flex items-center gap-1">
                    <span>Description</span>
                    {sortColumn === "description" && <span>{sortDirection === "asc" ? "▲" : "▼"}</span>}
                  </div>
                </th>

                {/* 4. Size Desc. */}
                <th
                  onClick={() => handleSort("sizeDesc")}
                  className="cursor-pointer border-r border-slate-200 px-3 py-2.5 hover:text-indigo-600 dark:border-zinc-800 dark:hover:text-indigo-400"
                >
                  <div className="flex items-center gap-1">
                    <span>Size Desc.</span>
                    {sortColumn === "sizeDesc" && <span>{sortDirection === "asc" ? "▲" : "▼"}</span>}
                  </div>
                </th>

                {/* 5. QQH */}
                <th
                  onClick={() => handleSort("qqh")}
                  className="cursor-pointer bg-indigo-50/30 px-3 py-2.5 text-indigo-950 hover:text-indigo-600 dark:bg-indigo-950/20 dark:text-indigo-200"
                >
                  <div className="flex items-center gap-1">
                    <span>QQH</span>
                    {sortColumn === "qqh" && <span>{sortDirection === "asc" ? "▲" : "▼"}</span>}
                  </div>
                </th>

                {/* 6. LAYWAY */}
                <th
                  onClick={() => handleSort("layway")}
                  className="cursor-pointer bg-indigo-50/30 px-3 py-2.5 text-indigo-950 hover:text-indigo-600 dark:bg-indigo-950/20 dark:text-indigo-200"
                >
                  <div className="flex items-center gap-1">
                    <span>LAYWAY</span>
                    {sortColumn === "layway" && <span>{sortDirection === "asc" ? "▲" : "▼"}</span>}
                  </div>
                </th>

                {/* 7. PREPAID */}
                <th
                  onClick={() => handleSort("prepaid")}
                  className="cursor-pointer bg-indigo-50/30 px-3 py-2.5 text-indigo-950 hover:text-indigo-600 dark:bg-indigo-950/20 dark:text-indigo-200"
                >
                  <div className="flex items-center gap-1">
                    <span>PREPAID</span>
                    {sortColumn === "prepaid" && <span>{sortDirection === "asc" ? "▲" : "▼"}</span>}
                  </div>
                </th>

                {/* 8. Expiry */}
                <th
                  onClick={() => handleSort("expiry")}
                  className="cursor-pointer bg-indigo-50/30 px-3 py-2.5 text-indigo-950 hover:text-indigo-600 dark:bg-indigo-950/20 dark:text-indigo-200"
                >
                  <div className="flex items-center gap-1">
                    <span>Expiry</span>
                    {sortColumn === "expiry" && <span>{sortDirection === "asc" ? "▲" : "▼"}</span>}
                  </div>
                </th>

                {/* 9. On Transfer */}
                <th
                  onClick={() => handleSort("onTransfer")}
                  className="cursor-pointer border-r border-slate-200 bg-indigo-50/30 px-3 py-2.5 text-indigo-950 hover:text-indigo-600 dark:border-zinc-800 dark:bg-indigo-950/20 dark:text-indigo-200"
                >
                  <div className="flex items-center gap-1">
                    <span>On Transfer</span>
                    {sortColumn === "onTransfer" && <span>{sortDirection === "asc" ? "▲" : "▼"}</span>}
                  </div>
                </th>

                {/* Action Col */}
                <th className="w-10 px-3 py-2.5"></th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
              {paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-xs text-slate-400 dark:text-zinc-500">
                    {searchQuery
                      ? "No products match your search filter."
                      : "No products in this sheet yet. Add a single SKU above or use Bulk Paste."}
                  </td>
                </tr>
              ) : (
                paginatedItems.map((item) => (
                  <tr
                    key={item.id}
                    className={`group transition-colors hover:bg-slate-50/80 dark:hover:bg-zinc-800/40 ${
                      selectedIds.has(item.id) ? "bg-indigo-50/30 dark:bg-indigo-950/20" : ""
                    }`}
                  >
                    {/* Select Checkbox */}
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleSelectRow(item.id)}
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                    </td>

                    {/* 1. SKU/UPC (Clickable or editable inline) */}
                    <td className="px-3 py-2 font-mono font-medium text-slate-900 dark:text-white">
                      <div className="flex items-center gap-1.5">
                        <span title="Click edit icon to change SKU and refresh product details">
                          {item.sku}
                        </span>
                        {!item.matched && (
                          <span
                            title="SKU was not found in All Inventory"
                            className="rounded bg-amber-100 px-1.5 py-0.2 text-[9px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          >
                            Not Found
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleStartEditSku(item)}
                          title="Edit SKU and re-lookup"
                          aria-label={`Edit SKU ${item.sku}`}
                          className="opacity-50 transition-opacity hover:opacity-100 focus:opacity-100 group-hover:opacity-100 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                      </div>
                    </td>

                    {/* 2. Brand (Inventory-Derived) */}
                    <td className="px-3 py-2 text-slate-700 dark:text-zinc-300">
                      {item.brand || "—"}
                    </td>

                    {/* 3. Description (Inventory-Derived) */}
                    <td className="px-3 py-2 font-medium text-slate-900 dark:text-zinc-100 max-w-sm truncate">
                      {item.description || (item.matched ? "—" : "Not Found")}
                    </td>

                    {/* 4. Size Desc. (Inventory-Derived) */}
                    <td className="border-r border-slate-200 px-3 py-2 text-slate-600 dark:border-zinc-800 dark:text-zinc-400">
                      {item.sizeDesc || "—"}
                    </td>

                    {/* 5. QQH (Staff Entry) */}
                    <td className="bg-slate-50/50 p-1 dark:bg-zinc-800/20">
                      <input
                        type="text"
                        value={item.qqh}
                        onChange={(e) => handleCountFieldChange(item.id, "qqh", e.target.value)}
                        placeholder="Count"
                        className="w-full rounded border border-transparent bg-white px-2 py-1 text-xs text-slate-900 transition-colors focus:border-indigo-600 focus:outline-hidden dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    </td>

                    {/* 6. LAYWAY (Staff Entry) */}
                    <td className="bg-slate-50/50 p-1 dark:bg-zinc-800/20">
                      <input
                        type="text"
                        value={item.layway}
                        onChange={(e) => handleCountFieldChange(item.id, "layway", e.target.value)}
                        placeholder="Layaway"
                        className="w-full rounded border border-transparent bg-white px-2 py-1 text-xs text-slate-900 transition-colors focus:border-indigo-600 focus:outline-hidden dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    </td>

                    {/* 7. PREPAID (Staff Entry) */}
                    <td className="bg-slate-50/50 p-1 dark:bg-zinc-800/20">
                      <input
                        type="text"
                        value={item.prepaid}
                        onChange={(e) => handleCountFieldChange(item.id, "prepaid", e.target.value)}
                        placeholder="Prepaid"
                        className="w-full rounded border border-transparent bg-white px-2 py-1 text-xs text-slate-900 transition-colors focus:border-indigo-600 focus:outline-hidden dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    </td>

                    {/* 8. Expiry (Staff Entry) */}
                    <td className="bg-slate-50/50 p-1 dark:bg-zinc-800/20">
                      <input
                        type="text"
                        value={item.expiry}
                        onChange={(e) => handleCountFieldChange(item.id, "expiry", e.target.value)}
                        placeholder="MM/YY"
                        className="w-full rounded border border-transparent bg-white px-2 py-1 text-xs text-slate-900 transition-colors focus:border-indigo-600 focus:outline-hidden dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    </td>

                    {/* 9. On Transfer (Staff Entry) */}
                    <td className="border-r border-slate-200 bg-slate-50/50 p-1 dark:border-zinc-800 dark:bg-zinc-800/20">
                      <input
                        type="text"
                        value={item.onTransfer}
                        onChange={(e) => handleCountFieldChange(item.id, "onTransfer", e.target.value)}
                        placeholder="Transfer"
                        className="w-full rounded border border-transparent bg-white px-2 py-1 text-xs text-slate-900 transition-colors focus:border-indigo-600 focus:outline-hidden dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    </td>

                    {/* Actions: Delete Row */}
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteRow(item.id)}
                        title="Delete product row"
                        className="text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {filteredAndSortedItems.length > pageSize && (
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
            <span>
              Showing {(currentPage - 1) * pageSize + 1} to{" "}
              {Math.min(currentPage * pageSize, filteredAndSortedItems.length)} of{" "}
              {filteredAndSortedItems.length} products
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800"
              >
                Previous
              </button>
              <span className="px-2">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bulk Paste Preview Dialog */}
      <BulkPastePreviewDialog
        isOpen={bulkDialogOpen}
        sheetId={sheetId}
        onClose={() => setBulkDialogOpen(false)}
        onConfirmAdd={handleBulkAddConfirm}
      />

      {/* Edit SKU Modal */}
      {editingSkuItemId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Edit SKU / UPC</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              Editing the SKU will re-search All Inventory and update Brand, Description, and Size Desc. Existing staff-entered count information will be completely preserved.
            </p>
            <input
              type="text"
              value={editingSkuValue}
              onChange={(e) => setEditingSkuValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveEditedSku();
                if (e.key === "Escape") setEditingSkuItemId(null);
              }}
              autoFocus
              className="mt-4 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2 font-mono text-xs font-semibold text-slate-900 focus:border-indigo-600 focus:bg-white focus:outline-hidden dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:bg-zinc-900"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingSkuItemId(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                Cancel
              </button>
              <LoadingButton
                type="button"
                busy={editingSkuBusy}
                onClick={handleSaveEditedSku}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 dark:bg-indigo-500"
              >
                Update & Refresh
              </LoadingButton>
            </div>
          </div>
        </div>
      )}

      {/* Delete / Clear Confirmation Dialog */}
      {deleteConfirmType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {deleteConfirmType === "all" ? "Clear Entire Count Sheet" : "Delete Selected Products"}
            </h3>
            <p className="mt-2 text-xs text-slate-600 dark:text-zinc-300">
              {deleteConfirmType === "all"
                ? "Are you sure you want to remove all products from this count sheet? This action cannot be undone."
                : `Are you sure you want to delete ${selectedIds.size} selected product row${
                    selectedIds.size === 1 ? "" : "s"
                  }?`}
            </p>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">
              Products in All Inventory are never modified or removed.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmType(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                Cancel
              </button>
              <LoadingButton
                type="button"
                busy={deletingBusy}
                onClick={handleConfirmDelete}
                className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 dark:bg-red-500"
              >
                {deleteConfirmType === "all" ? "Clear Sheet" : "Delete Selected"}
              </LoadingButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
