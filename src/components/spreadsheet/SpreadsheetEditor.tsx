"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Flags, type Item } from "@/components/PriceGrid";
import { MarkdownDoc } from "@/components/MarkdownEditor";
import { useToast } from "@/components/Toast";
import { useUiMode } from "@/contexts/UiModeContext";
import type { SortableItemKey } from "@/lib/itemSort";
import { getItemFlags } from "@/lib/itemSort";
import {
  computeFillPatches,
  computePastePatches,
  DEFAULT_SPREADSHEET_PREFS,
  EDITABLE_KEYS,
  filterSpreadsheetItems,
  getCellRawValue,
  isCellInRange,
  loadSpreadsheetPrefs,
  multiSortItems,
  normalizeRange,
  parseNum,
  parseTsvClipboard,
  rowHeightForDensity,
  saveSpreadsheetPrefs,
  serializeRangeToTsv,
  SPREADSHEET_COL_MAP,
  SPREADSHEET_COLS,
  validateCellEdit,
} from "@/lib/spreadsheet/engine";
import {
  DEFAULT_QUICK_FILTERS,
  type CellPatch,
  type CellRange,
  type ColumnFilterSpec,
  type ExpandedQuickFilters,
  type RowDensity,
  type SaveQueueSnapshot,
  type SortRule,
  type SpreadsheetPrefs,
} from "@/lib/spreadsheet/types";
import { BulkEditModal, type BulkEditAction } from "./BulkEditModal";
import { ColumnHeaderMenu } from "./ColumnHeaderMenu";
import { SpreadsheetToolbar } from "./SpreadsheetToolbar";

const ROW_NUM_W = 52;
const CHECK_W = 36;
const ACTION_W = 40;
const HEADER_H = 38;
const PIN_EDGE_SHADOW = "4px 0 6px -4px rgba(15, 23, 42, 0.35)";

type ContextMenuState = {
  x: number;
  y: number;
  rowIndex: number;
  colIndex: number;
  item: Item;
  colKey: SortableItemKey;
};

export type SpreadsheetEditorProps = {
  items: Item[];
  userId: string | null;
  selected: Set<string>;
  onToggleRow: (item: Item) => void;
  onToggleRows: (ids: string[], checked: boolean) => void;
  onApplyBatchEdit: (patches: CellPatch[], beforePatches: CellPatch[], label: string) => void;
  onDeleteRow: (item: Item) => void;
  onOpenNotes: (item: Item) => void;
  onRestoreDiscount: (item: Item) => void;
  saveStatus: SaveQueueSnapshot;
  onFlushNow: () => void;
  onRetryFailed: () => void;
  /** Emits full multi-sorted ID order (across ALL session items) for exports. */
  onExportOrderChange?: (sortedAllIds: string[] | null, primarySort: SortRule | null) => void;
  /** Optional toolbar actions mirrored in full-screen mode. */
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  undoTooltip?: string;
  redoTooltip?: string;
  onAddRow?: () => void;
  onBulkAdd?: () => void;
  onOpenSetLower?: () => void;
  lowerCount?: number;
  onOpenDeleteSelected?: () => void;
  sheetTitle?: string;
  onSwitchToLegacy?: () => void;
};

export function SpreadsheetEditor({
  items,
  userId,
  selected,
  onToggleRow,
  onToggleRows,
  onApplyBatchEdit,
  onDeleteRow,
  onOpenNotes,
  onRestoreDiscount,
  saveStatus,
  onFlushNow,
  onRetryFailed,
  onExportOrderChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  undoTooltip,
  redoTooltip,
  onAddRow,
  onBulkAdd,
  onOpenSetLower,
  lowerCount,
  onOpenDeleteSelected,
  sheetTitle,
  onSwitchToLegacy,
}: SpreadsheetEditorProps) {
  const toast = useToast();
  const { spreadsheetFullscreen: isFullscreen, setSpreadsheetFullscreen: setIsFullscreen } = useUiMode();

  // Always exit full-screen cleanly when unmounting SpreadsheetEditor (e.g. route change / editor switch)
  useEffect(() => {
    return () => {
      setIsFullscreen(false);
    };
  }, [setIsFullscreen]);

  // ---- Persistent user preferences (column order, widths, visibility, pins, wrap, density) ----
  const [prefs, setPrefs] = useState<SpreadsheetPrefs>(() => loadSpreadsheetPrefs(userId));
  const prefsLoadedForRef = useRef<string | null>(userId);

  useEffect(() => {
    if (prefsLoadedForRef.current === userId) return;
    prefsLoadedForRef.current = userId;
    setPrefs(loadSpreadsheetPrefs(userId));
  }, [userId]);

  useEffect(() => {
    saveSpreadsheetPrefs(userId, prefs);
  }, [userId, prefs]);

  // ---- Filtering, Multi-Sort, Frozen Top Rows, Full-Screen ----
  const [globalQuery, setGlobalQuery] = useState("");
  const [quickFilters, setQuickFilters] = useState<ExpandedQuickFilters>(DEFAULT_QUICK_FILTERS);
  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilterSpec>>({});
  const [sortRules, setSortRules] = useState<SortRule[]>([]);
  const [pinnedRowIds, setPinnedRowIds] = useState<string[]>([]);

  // ---- Header Menu, Context Menu, Bulk Edit Modal ----
  const [headerMenu, setHeaderMenu] = useState<{ key: SortableItemKey; rect: DOMRect } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);

  // ---- Active Cell, Multi-Cell Range Selection, Inline Editing, Fill Handle ----
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);
  const [selectionRange, setSelectionRange] = useState<CellRange | null>(null);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number; draft: string } | null>(null);
  const [fillPreview, setFillPreview] = useState<CellRange | null>(null);

  // Drag refs (no unnecessary re-renders during drag)
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRootRef = useRef<HTMLDivElement | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const selDragRef = useRef<{ anchorRow: number; anchorCol: number } | null>(null);
  const fillDragRef = useRef<{ source: CellRange; currentTarget: CellRange } | null>(null);
  const colResizeRef = useRef<{ key: SortableItemKey; startX: number; startW: number } | null>(null);
  const dragColKeyRef = useRef<SortableItemKey | null>(null);
  const [dropTargetCol, setDropTargetCol] = useState<SortableItemKey | null>(null);

  // ---- Flags metadata ----
  const { availableFlags, flagCounts } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) {
      for (const f of getItemFlags(it)) {
        counts.set(f, (counts.get(f) ?? 0) + 1);
      }
    }
    const order = ["Not Found", "Inactive", "Manual SKU", "Custom", "Changed", "No change"];
    return {
      availableFlags: order.filter((f) => counts.has(f)),
      flagCounts: counts,
    };
  }, [items]);

  const selectedFlagsSet = useMemo(() => {
    const spec = columnFilters.flags;
    return new Set(spec?.kind === "flags" ? spec.values : []);
  }, [columnFilters.flags]);

  // ---- Filtered + Multi-Sorted Rows ----
  const processedRows = useMemo(() => {
    const filtered = filterSpreadsheetItems(items, {
      globalQuery,
      selectedFlags: selectedFlagsSet,
      quick: quickFilters,
      columnFilters,
    });
    return multiSortItems(filtered, sortRules);
  }, [items, globalQuery, selectedFlagsSet, quickFilters, columnFilters, sortRules]);

  // Notify parent of full-session multi-sort order for Store Count exports
  // (always across ALL items so client-side filters never accidentally omit exported records).
  useEffect(() => {
    if (!onExportOrderChange) return;
    if (!sortRules.length) {
      onExportOrderChange(null, null);
      return;
    }
    const sortedAll = multiSortItems(items, sortRules);
    onExportOrderChange(sortedAll.map((r) => r.id), sortRules[0] ?? null);
  }, [items, sortRules, onExportOrderChange]);

  // Separate frozen top rows from virtualized body rows while preserving unified visual index
  const { pinnedTopRows, bodyRows, combinedRows } = useMemo(() => {
    if (!pinnedRowIds.length) {
      return { pinnedTopRows: [] as Item[], bodyRows: processedRows, combinedRows: processedRows };
    }
    const pinSet = new Set(pinnedRowIds);
    const byId = new Map(processedRows.map((r) => [r.id, r]));
    const pinned: Item[] = [];
    for (const pid of pinnedRowIds) {
      const hit = byId.get(pid);
      if (hit) pinned.push(hit);
    }
    const body = processedRows.filter((r) => !pinSet.has(r.id));
    return { pinnedTopRows: pinned, bodyRows: body, combinedRows: [...pinned, ...body] };
  }, [processedRows, pinnedRowIds]);

  // ---- Visible Columns (Pinned left columns first, then unpinned in visual order) ----
  const { visibleColKeys, pinnedSet, colLeftOffsets, totalTableWidth } = useMemo(() => {
    const orderedVisible = prefs.columnOrder.filter((k) => prefs.columnVisibility[k] !== false);
    const pSet = new Set<SortableItemKey>(prefs.pinnedColumns.filter((k) => prefs.columnVisibility[k] !== false));
    const pinnedOrdered = orderedVisible.filter((k) => pSet.has(k));
    const unpinnedOrdered = orderedVisible.filter((k) => !pSet.has(k));
    const keys = [...pinnedOrdered, ...unpinnedOrdered];

    const offsets: Record<string, number> = {};
    let left = ROW_NUM_W + CHECK_W;
    for (const k of pinnedOrdered) {
      offsets[k] = left;
      left += prefs.columnSizing[k] ?? SPREADSHEET_COL_MAP.get(k)?.defaultWidth ?? 120;
    }
    let totalW = ROW_NUM_W + CHECK_W + ACTION_W;
    for (const k of keys) {
      totalW += prefs.columnSizing[k] ?? SPREADSHEET_COL_MAP.get(k)?.defaultWidth ?? 120;
    }
    return { visibleColKeys: keys, pinnedSet: pSet, colLeftOffsets: offsets, totalTableWidth: totalW };
  }, [prefs.columnOrder, prefs.columnVisibility, prefs.pinnedColumns, prefs.columnSizing]);

  const lastPinnedKey = useMemo(() => {
    let last: SortableItemKey | null = null;
    for (const k of visibleColKeys) {
      if (pinnedSet.has(k)) last = k;
    }
    return last;
  }, [visibleColKeys, pinnedSet]);

  // ---- TanStack Virtualizer (React 19 safe: useFlushSync: false) ----
  const rowHeight = rowHeightForDensity(prefs.density);
  const virtualizer = useVirtualizer({
    count: bodyRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 14,
    useFlushSync: false,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  // ---- Helpers for column widths ----
  const getColWidth = useCallback(
    (key: SortableItemKey) => prefs.columnSizing[key] ?? SPREADSHEET_COL_MAP.get(key)?.defaultWidth ?? 120,
    [prefs.columnSizing],
  );

  const autoFitColumn = useCallback(
    (key: SortableItemKey) => {
      const col = SPREADSHEET_COL_MAP.get(key);
      if (!col) return;
      const sample = combinedRows.slice(0, 400);
      let maxChars = col.label.length + 4;
      for (const r of sample) {
        const len = getCellRawValue(r, key).length;
        if (len > maxChars) maxChars = len;
      }
      const px = Math.max(84, Math.min(460, Math.round(maxChars * 7.6 + 34)));
      setPrefs((prev) => ({
        ...prev,
        columnSizing: { ...prev.columnSizing, [key]: px },
      }));
    },
    [combinedRows],
  );

  const autoFitAllColumns = useCallback(() => {
    const sample = combinedRows.slice(0, 300);
    const nextSizing: Record<string, number> = { ...prefs.columnSizing };
    for (const col of SPREADSHEET_COLS) {
      let maxChars = col.label.length + 4;
      for (const r of sample) {
        const len = getCellRawValue(r, col.key).length;
        if (len > maxChars) maxChars = len;
      }
      nextSizing[col.key] = Math.max(84, Math.min(420, Math.round(maxChars * 7.5 + 32)));
    }
    setPrefs((prev) => ({ ...prev, columnSizing: nextSizing }));
  }, [combinedRows, prefs.columnSizing]);

  // ---- Sorting helpers (supports single click, Shift+click multi-sort, and menu) ----
  const handleHeaderClick = useCallback((key: SortableItemKey, shiftKey: boolean) => {
    setSortRules((prev) => {
      const idx = prev.findIndex((r) => r.id === key);
      if (shiftKey) {
        if (idx < 0) return [...prev, { id: key, desc: false }];
        if (!prev[idx].desc) {
          const next = [...prev];
          next[idx] = { id: key, desc: true };
          return next;
        }
        return prev.filter((_, i) => i !== idx);
      }
      // Single click: cycle asc -> desc -> clear (if sole sort), or set primary
      if (idx === 0 && prev.length === 1) {
        if (!prev[0].desc) return [{ id: key, desc: true }];
        return [];
      }
      return [{ id: key, desc: false }];
    });
  }, []);

  const setPrimarySort = useCallback((key: SortableItemKey, desc: boolean) => {
    setSortRules([{ id: key, desc }]);
  }, []);

  const addSecondarySort = useCallback((key: SortableItemKey, desc: boolean) => {
    setSortRules((prev) => {
      const without = prev.filter((r) => r.id !== key);
      return [...without, { id: key, desc }];
    });
  }, []);

  const removeSort = useCallback((key: SortableItemKey) => {
    setSortRules((prev) => prev.filter((r) => r.id !== key));
  }, []);

  // ---- Column Pinning / Freezing ----
  const togglePinColumn = useCallback((key: SortableItemKey) => {
    setPrefs((prev) => {
      const exists = prev.pinnedColumns.includes(key);
      return {
        ...prev,
        pinnedColumns: exists
          ? prev.pinnedColumns.filter((k) => k !== key)
          : [...prev.pinnedColumns, key],
      };
    });
  }, []);

  const freezeUpToColumn = useCallback((key: SortableItemKey) => {
    setPrefs((prev) => {
      const visibleOrder = prev.columnOrder.filter((k) => prev.columnVisibility[k] !== false);
      const idx = visibleOrder.indexOf(key);
      if (idx < 0) return prev;
      return { ...prev, pinnedColumns: visibleOrder.slice(0, idx + 1) };
    });
  }, []);

  // ---- Column Drag-and-Drop Reorder (visual only; never mutates data/exports) ----
  const onColDragStart = (key: SortableItemKey) => {
    dragColKeyRef.current = key;
  };
  const onColDragOver = (e: React.DragEvent, targetKey: SortableItemKey) => {
    if (!dragColKeyRef.current || dragColKeyRef.current === targetKey) return;
    e.preventDefault();
    setDropTargetCol(targetKey);
  };
  const onColDrop = (targetKey: SortableItemKey) => {
    const src = dragColKeyRef.current;
    dragColKeyRef.current = null;
    setDropTargetCol(null);
    if (!src || src === targetKey) return;
    setPrefs((prev) => {
      const next = prev.columnOrder.filter((k) => k !== src);
      const targetIdx = next.indexOf(targetKey);
      if (targetIdx < 0) return prev;
      next.splice(targetIdx, 0, src);
      return { ...prev, columnOrder: next };
    });
  };
  const onColDragEnd = () => {
    dragColKeyRef.current = null;
    setDropTargetCol(null);
  };

  // ---- Column Resize Drag ----
  const startColResize = (e: ReactPointerEvent<HTMLSpanElement>, key: SortableItemKey) => {
    e.preventDefault();
    e.stopPropagation();
    colResizeRef.current = { key, startX: e.clientX, startW: getColWidth(key) };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (colResizeRef.current) {
        const d = colResizeRef.current;
        const nextW = Math.max(64, Math.min(720, Math.round(d.startW + (e.clientX - d.startX))));
        setPrefs((prev) => (prev.columnSizing[d.key] === nextW ? prev : {
          ...prev,
          columnSizing: { ...prev.columnSizing, [d.key]: nextW },
        }));
      }
      // Auto-scroll when dragging range or fill handle near edges
      if ((selDragRef.current || fillDragRef.current) && scrollRef.current) {
        const rect = scrollRef.current.getBoundingClientRect();
        const edge = 36;
        if (e.clientY > rect.bottom - edge) scrollRef.current.scrollTop += 18;
        else if (e.clientY < rect.top + HEADER_H + edge) scrollRef.current.scrollTop -= 18;
        if (e.clientX > rect.right - edge) scrollRef.current.scrollLeft += 24;
        else if (e.clientX < rect.left + ROW_NUM_W + CHECK_W + edge) scrollRef.current.scrollLeft -= 24;
      }
    };
    const onUp = () => {
      colResizeRef.current = null;
      selDragRef.current = null;
      if (fillDragRef.current) {
        const { source, currentTarget } = fillDragRef.current;
        fillDragRef.current = null;
        setFillPreview(null);
        const plan = computeFillPatches(combinedRows, visibleColKeys, source, currentTarget);
        if (plan.errors.length) {
          toast.error("Some cells could not be filled.", plan.errors[0]);
        }
        if (plan.patches.length) {
          onApplyBatchEdit(plan.patches, plan.beforePatches, `Fill ${plan.editedCellCount} cell${plan.editedCellCount === 1 ? "" : "s"}`);
          setSelectionRange(currentTarget);
          toast.success(`Filled ${plan.editedCellCount} cell${plan.editedCellCount === 1 ? "" : "s"}.`);
        } else if (plan.skippedReadOnly > 0) {
          toast.info("Read-only columns cannot be filled.");
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [combinedRows, visibleColKeys, onApplyBatchEdit, toast]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [contextMenu]);

  // Fullscreen Escape shortcut (when not editing a cell)
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editingCell && !showBulkModal && !headerMenu) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen, editingCell, showBulkModal, headerMenu]);

  // ---- Commit / Cancel Inline Cell Edit ----
  const startEdit = useCallback(
    (rowIdx: number, colIdx: number, initialOverride?: string) => {
      const item = combinedRows[rowIdx];
      const colKey = visibleColKeys[colIdx];
      if (!item || !colKey) return;
      if (!EDITABLE_KEYS.has(colKey)) return;
      if (colKey === "notes") {
        onOpenNotes(item);
        return;
      }
      const existing = colKey === "nearest9"
        ? (item.nearest9Custom ?? getCellRawValue(item, colKey))
        : getCellRawValue(item, colKey);
      setEditingCell({
        row: rowIdx,
        col: colIdx,
        draft: initialOverride !== undefined ? initialOverride : existing,
      });
      requestAnimationFrame(() => {
        if (editInputRef.current) {
          editInputRef.current.focus();
          if (initialOverride === undefined) editInputRef.current.select();
        }
      });
    },
    [combinedRows, visibleColKeys, onOpenNotes],
  );

  const commitEdit = useCallback(
    (moveDir?: "down" | "up" | "right" | "left") => {
      if (!editingCell) return;
      const { row: rIdx, col: cIdx, draft } = editingCell;
      const item = combinedRows[rIdx];
      const colKey = visibleColKeys[cIdx];
      setEditingCell(null);

      if (item && colKey && EDITABLE_KEYS.has(colKey)) {
        const check = validateCellEdit(colKey, draft);
        if (!check.ok) {
          toast.error("Invalid value", check.error);
        } else {
          const prevDisplay = getCellRawValue(item, colKey);
          const prevRaw = colKey === "nearest9" ? (item.nearest9Custom ?? "") : prevDisplay;
          const changed = colKey === "nearest9"
            ? (draft.trim() === "" ? Boolean(item.nearest9Custom) : check.normalized !== prevDisplay)
            : check.normalized !== prevDisplay;
          if (changed) {
            const label = SPREADSHEET_COL_MAP.get(colKey)?.shortLabel ?? colKey;
            onApplyBatchEdit(
              [{ id: item.id, fields: { [colKey]: check.normalized } }],
              [{ id: item.id, fields: { [colKey]: prevRaw } }],
              `Edit ${label}`,
            );
          }
        }
      }

      if (moveDir) {
        let nr = rIdx;
        let nc = cIdx;
        if (moveDir === "down") nr = Math.min(combinedRows.length - 1, rIdx + 1);
        else if (moveDir === "up") nr = Math.max(0, rIdx - 1);
        else if (moveDir === "right") {
          if (cIdx + 1 < visibleColKeys.length) nc = cIdx + 1;
          else if (rIdx + 1 < combinedRows.length) { nr = rIdx + 1; nc = 0; }
        } else if (moveDir === "left") {
          if (cIdx > 0) nc = cIdx - 1;
          else if (rIdx > 0) { nr = rIdx - 1; nc = visibleColKeys.length - 1; }
        }
        setActiveCell({ row: nr, col: nc });
        setSelectionRange(normalizeRange(nr, nc, nr, nc));
        if (nr >= pinnedTopRows.length) {
          virtualizer.scrollToIndex(nr - pinnedTopRows.length, { align: "auto" });
        }
      }
      gridRootRef.current?.focus({ preventScroll: true });
    },
    [editingCell, combinedRows, visibleColKeys, onApplyBatchEdit, toast, pinnedTopRows.length, virtualizer],
  );

  // ---- Copy / Paste / Clear / Fill Down Actions ----
  const copySelection = useCallback(async () => {
    const range = selectionRange ?? (activeCell ? normalizeRange(activeCell.row, activeCell.col, activeCell.row, activeCell.col) : null);
    if (!range) return;
    const tsv = serializeRangeToTsv(combinedRows, visibleColKeys, range);
    try {
      await navigator.clipboard.writeText(tsv);
      const cellCount = (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
      toast.success(`Copied ${cellCount} cell${cellCount === 1 ? "" : "s"}.`);
    } catch {
      toast.error("Copy failed", "Browser clipboard access was denied.");
    }
  }, [selectionRange, activeCell, combinedRows, visibleColKeys, toast]);

  const pasteFromText = useCallback(
    (text: string) => {
      const range = selectionRange ?? (activeCell ? normalizeRange(activeCell.row, activeCell.col, activeCell.row, activeCell.col) : null);
      if (!range) return;
      const matrix = parseTsvClipboard(text);
      if (!matrix.length) return;
      const plan = computePastePatches(combinedRows, visibleColKeys, range, matrix);
      if (plan.errors.length) {
        toast.error("Some pasted values were invalid", plan.errors[0]);
      }
      if (plan.patches.length) {
        onApplyBatchEdit(plan.patches, plan.beforePatches, `Paste ${plan.editedCellCount} cell${plan.editedCellCount === 1 ? "" : "s"}`);
        toast.success(
          `Pasted ${plan.editedCellCount} cell${plan.editedCellCount === 1 ? "" : "s"}${
            plan.skippedReadOnly > 0 ? ` (${plan.skippedReadOnly} read-only skipped)` : ""
          }.`,
        );
      } else if (plan.skippedReadOnly > 0) {
        toast.info("Cannot paste into read-only/calculated columns.");
      }
    },
    [selectionRange, activeCell, combinedRows, visibleColKeys, onApplyBatchEdit, toast],
  );

  const pasteSelection = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      pasteFromText(text);
    } catch {
      toast.error("Paste failed", "Use Ctrl/Cmd+V directly or grant clipboard permission.");
    }
  }, [pasteFromText, toast]);

  const clearSelection = useCallback(() => {
    const range = selectionRange ?? (activeCell ? normalizeRange(activeCell.row, activeCell.col, activeCell.row, activeCell.col) : null);
    if (!range) return;
    const plan = computePastePatches(combinedRows, visibleColKeys, range, [[""]]);
    if (plan.patches.length) {
      onApplyBatchEdit(plan.patches, plan.beforePatches, `Clear ${plan.editedCellCount} cell${plan.editedCellCount === 1 ? "" : "s"}`);
    } else if (plan.skippedReadOnly > 0) {
      toast.info("Selected cells are read-only.");
    }
  }, [selectionRange, activeCell, combinedRows, visibleColKeys, onApplyBatchEdit, toast]);

  const fillDownSelection = useCallback(() => {
    if (!selectionRange || selectionRange.endRow <= selectionRange.startRow) return;
    const source: CellRange = {
      startRow: selectionRange.startRow,
      endRow: selectionRange.startRow,
      startCol: selectionRange.startCol,
      endCol: selectionRange.endCol,
    };
    const plan = computeFillPatches(combinedRows, visibleColKeys, source, selectionRange);
    if (plan.patches.length) {
      onApplyBatchEdit(plan.patches, plan.beforePatches, `Fill down ${plan.editedCellCount} cell${plan.editedCellCount === 1 ? "" : "s"}`);
      toast.success(`Filled down ${plan.editedCellCount} cell${plan.editedCellCount === 1 ? "" : "s"}.`);
    }
  }, [selectionRange, combinedRows, visibleColKeys, onApplyBatchEdit, toast]);

  // ---- Bulk Edit Modal Handler ----
  const bulkTargetRows = useMemo(() => {
    if (selected.size > 0) {
      return items.filter((r) => selected.has(r.id));
    }
    if (selectionRange) {
      return combinedRows.slice(selectionRange.startRow, selectionRange.endRow + 1);
    }
    if (activeCell && combinedRows[activeCell.row]) {
      return [combinedRows[activeCell.row]];
    }
    return [];
  }, [selected, items, selectionRange, activeCell, combinedRows]);

  const handleBulkEditApply = useCallback(
    (action: BulkEditAction) => {
      if (!bulkTargetRows.length) return;
      const patches: CellPatch[] = [];
      const beforePatches: CellPatch[] = [];

      for (const r of bulkTargetRows) {
        if (action.kind === "clearCustomNearest9") {
          if (!r.nearest9Custom) continue;
          patches.push({ id: r.id, fields: { nearest9: "" } });
          beforePatches.push({ id: r.id, fields: { nearest9: r.nearest9Custom } });
        } else if (action.kind === "restoreDefaultDiscount") {
          patches.push({ id: r.id, fields: { discount: "" } });
          beforePatches.push({ id: r.id, fields: { discount: r.discount ?? "" } });
        } else {
          const prev = action.field === "nearest9"
            ? (r.nearest9Custom ?? "")
            : getCellRawValue(r, action.field);
          patches.push({ id: r.id, fields: { [action.field]: action.value } });
          beforePatches.push({ id: r.id, fields: { [action.field]: prev } });
        }
      }

      if (!patches.length) {
        toast.info("No rows needed updating.");
        return;
      }
      onApplyBatchEdit(patches, beforePatches, action.label);
      toast.success(`Updated ${patches.length.toLocaleString()} row${patches.length === 1 ? "" : "s"}.`);
    },
    [bulkTargetRows, onApplyBatchEdit, toast],
  );

  // ---- Grid Keyboard Navigation ----
  const handleGridKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editingCell) return; // inline input handles its own keys
    const targetEl = e.target as HTMLElement | null;
    if (targetEl && (targetEl.tagName === "INPUT" || targetEl.tagName === "TEXTAREA" || targetEl.tagName === "SELECT")) {
      return;
    }

    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;

    if (mod && key.toLowerCase() === "c") {
      e.preventDefault();
      void copySelection();
      return;
    }
    if (mod && key.toLowerCase() === "d") {
      e.preventDefault();
      fillDownSelection();
      return;
    }
    if (mod && key.toLowerCase() === "a") {
      if (combinedRows.length > 0 && visibleColKeys.length > 0) {
        e.preventDefault();
        setActiveCell({ row: 0, col: 0 });
        setSelectionRange({
          startRow: 0,
          endRow: combinedRows.length - 1,
          startCol: 0,
          endCol: visibleColKeys.length - 1,
        });
      }
      return;
    }

    if (!activeCell) {
      if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Tab", "Enter"].includes(key) && combinedRows.length > 0) {
        e.preventDefault();
        setActiveCell({ row: 0, col: 0 });
        setSelectionRange({ startRow: 0, endRow: 0, startCol: 0, endCol: 0 });
      }
      return;
    }

    const maxR = combinedRows.length - 1;
    const maxC = visibleColKeys.length - 1;
    if (maxR < 0 || maxC < 0) return;

    const moveTo = (nr: number, nc: number, extend: boolean) => {
      const cr = Math.max(0, Math.min(maxR, nr));
      const cc = Math.max(0, Math.min(maxC, nc));
      if (extend && selectionRange) {
        const anchorR = activeCell.row === selectionRange.startRow ? selectionRange.endRow : selectionRange.startRow;
        const anchorC = activeCell.col === selectionRange.startCol ? selectionRange.endCol : selectionRange.startCol;
        setActiveCell({ row: cr, col: cc });
        setSelectionRange(normalizeRange(anchorR, anchorC, cr, cc));
      } else {
        setActiveCell({ row: cr, col: cc });
        setSelectionRange({ startRow: cr, endRow: cr, startCol: cc, endCol: cc });
      }
      if (cr >= pinnedTopRows.length) {
        virtualizer.scrollToIndex(cr - pinnedTopRows.length, { align: "auto" });
      }
    };

    if (key === "ArrowDown") { e.preventDefault(); moveTo(mod ? maxR : activeCell.row + 1, activeCell.col, e.shiftKey); return; }
    if (key === "ArrowUp") { e.preventDefault(); moveTo(mod ? 0 : activeCell.row - 1, activeCell.col, e.shiftKey); return; }
    if (key === "ArrowRight") { e.preventDefault(); moveTo(activeCell.row, mod ? maxC : activeCell.col + 1, e.shiftKey); return; }
    if (key === "ArrowLeft") { e.preventDefault(); moveTo(activeCell.row, mod ? 0 : activeCell.col - 1, e.shiftKey); return; }
    if (key === "Home") { e.preventDefault(); moveTo(mod ? 0 : activeCell.row, 0, e.shiftKey); return; }
    if (key === "End") { e.preventDefault(); moveTo(mod ? maxR : activeCell.row, maxC, e.shiftKey); return; }
    if (key === "PageDown") { e.preventDefault(); moveTo(activeCell.row + 15, activeCell.col, e.shiftKey); return; }
    if (key === "PageUp") { e.preventDefault(); moveTo(activeCell.row - 15, activeCell.col, e.shiftKey); return; }

    if (key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        if (activeCell.col > 0) moveTo(activeCell.row, activeCell.col - 1, false);
        else if (activeCell.row > 0) moveTo(activeCell.row - 1, maxC, false);
      } else {
        if (activeCell.col < maxC) moveTo(activeCell.row, activeCell.col + 1, false);
        else if (activeCell.row < maxR) moveTo(activeCell.row + 1, 0, false);
      }
      return;
    }

    if (key === "Enter" || key === "F2") {
      e.preventDefault();
      const colKey = visibleColKeys[activeCell.col];
      if (EDITABLE_KEYS.has(colKey)) {
        startEdit(activeCell.row, activeCell.col);
      } else {
        moveTo(e.shiftKey ? activeCell.row - 1 : activeCell.row + 1, activeCell.col, false);
      }
      return;
    }

    if (key === "Delete" || key === "Backspace") {
      e.preventDefault();
      clearSelection();
      return;
    }

    if (key === "Escape") {
      setSelectionRange(activeCell ? { startRow: activeCell.row, endRow: activeCell.row, startCol: activeCell.col, endCol: activeCell.col } : null);
      return;
    }

    // Direct typing enters edit mode immediately (Excel behavior!)
    if (!mod && !e.altKey && key.length === 1) {
      const colKey = visibleColKeys[activeCell.col];
      if (EDITABLE_KEYS.has(colKey) && colKey !== "notes") {
        e.preventDefault();
        startEdit(activeCell.row, activeCell.col, key);
      }
    }
  };

  // Native paste event catches Ctrl/Cmd+V reliably across all browsers without needing clipboard-read permission
  const handleGridPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (editingCell) return;
    const targetEl = e.target as HTMLElement | null;
    if (targetEl && (targetEl.tagName === "INPUT" || targetEl.tagName === "TEXTAREA" || targetEl.tagName === "SELECT")) {
      return;
    }
    const text = e.clipboardData?.getData("text/plain");
    if (text !== undefined && text !== "") {
      e.preventDefault();
      pasteFromText(text);
    }
  };

  // ---- Selection Stats (Excel Status Bar: Count / Sum / Avg) ----
  const selectionStats = useMemo(() => {
    if (!selectionRange) return null;
    const rCount = selectionRange.endRow - selectionRange.startRow + 1;
    const cCount = selectionRange.endCol - selectionRange.startCol + 1;
    const total = rCount * cCount;
    if (total <= 1 || total > 50000) return { count: total, numericCount: 0, sum: 0, avg: 0 };
    let numericCount = 0;
    let sum = 0;
    for (let r = selectionRange.startRow; r <= selectionRange.endRow; r++) {
      const item = combinedRows[r];
      if (!item) continue;
      for (let c = selectionRange.startCol; c <= selectionRange.endCol; c++) {
        const colKey = visibleColKeys[c];
        if (!colKey) continue;
        const n = parseNum(getCellRawValue(item, colKey));
        if (n !== null) {
          numericCount++;
          sum += n;
        }
      }
    }
    return { count: total, numericCount, sum, avg: numericCount > 0 ? sum / numericCount : 0 };
  }, [selectionRange, combinedRows, visibleColKeys]);

  // ---- Active Cell Formula/Preview Bar Info ----
  const activeInfo = useMemo(() => {
    if (!activeCell) return null;
    const item = combinedRows[activeCell.row];
    const colKey = visibleColKeys[activeCell.col];
    if (!item || !colKey) return null;
    const col = SPREADSHEET_COL_MAP.get(colKey);
    return {
      item,
      colKey,
      colLabel: col?.label ?? colKey,
      editable: Boolean(col?.editable),
      value: getCellRawValue(item, colKey),
      rowNumber: activeCell.row + 1,
    };
  }, [activeCell, combinedRows, visibleColKeys]);

  // Visible select-all checkbox state
  const allVisibleIds = useMemo(() => combinedRows.map((r) => r.id), [combinedRows]);
  const selectedVisibleCount = useMemo(
    () => combinedRows.reduce((acc, r) => acc + (selected.has(r.id) ? 1 : 0), 0),
    [combinedRows, selected],
  );
  const allVisibleChecked = combinedRows.length > 0 && selectedVisibleCount === combinedRows.length;

  // ---- Row Renderer (shared by Frozen Top Rows & Virtualized Body Rows) ----
  const renderRow = (item: Item, visualRowIdx: number, isPinnedTop: boolean, topOffsetPx?: number) => {
    const isRowChecked = selected.has(item.id);
    const baseRowBg = isRowChecked
      ? "var(--grid-selected-bg, #e0f2fe)"
      : !item.matched
        ? "var(--grid-unmatched-bg, #fef2f2)"
        : isPinnedTop
          ? "#f8fafc"
          : "var(--grid-bg, #ffffff)";

    const rowStyle: CSSProperties = isPinnedTop
      ? {
          position: "sticky",
          top: topOffsetPx,
          zIndex: 25,
          height: rowHeight,
          width: totalTableWidth,
          background: baseRowBg,
          borderBottom: "1px solid var(--grid-border, #e2e8f0)",
        }
      : {
          position: "absolute",
          top: 0,
          left: 0,
          transform: `translateY(${topOffsetPx ?? 0}px)`,
          height: rowHeight,
          width: totalTableWidth,
          background: baseRowBg,
          borderBottom: "1px solid var(--grid-border, #e2e8f0)",
        };

    return (
      <div
        key={`${isPinnedTop ? "pin" : "row"}-${item.id}`}
        role="row"
        data-row-id={item.id}
        className="flex items-stretch select-none text-[13px]"
        style={rowStyle}
      >
        {/* Sticky Row Number + Pin Toggle Gutter */}
        <div
          className="flex shrink-0 items-center justify-between border-r border-slate-200 dark:border-zinc-800 px-1 text-[11px] font-mono text-slate-500 dark:text-zinc-400"
          style={{
            width: ROW_NUM_W,
            position: "sticky",
            left: 0,
            zIndex: isPinnedTop ? 36 : 16,
            background: baseRowBg,
          }}
        >
          <button
            type="button"
            onClick={() => onToggleRow(item)}
            title="Click to toggle row selection"
            className="flex-1 text-center hover:text-slate-900 dark:hover:text-white"
          >
            {visualRowIdx + 1}
          </button>
          <button
            type="button"
            onClick={() => {
              setPinnedRowIds((prev) =>
                prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id],
              );
            }}
            title={isPinnedTop ? "Unfreeze row" : "Freeze row at top"}
            className={`text-[10px] leading-none transition-opacity ${
              isPinnedTop ? "text-indigo-600 dark:text-indigo-400 opacity-100" : "opacity-0 hover:opacity-100 text-slate-400"
            }`}
          >
            📌
          </button>
        </div>

        {/* Sticky Checkbox Gutter */}
        <div
          className="flex shrink-0 items-center justify-center border-r border-slate-200 dark:border-zinc-800"
          style={{
            width: CHECK_W,
            position: "sticky",
            left: ROW_NUM_W,
            zIndex: isPinnedTop ? 36 : 16,
            background: baseRowBg,
            boxShadow: !lastPinnedKey ? PIN_EDGE_SHADOW : undefined,
          }}
        >
          <input
            type="checkbox"
            aria-label={`Select ${item.cleanedSku || item.rawVendorSku}`}
            checked={isRowChecked}
            onChange={() => onToggleRow(item)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
          />
        </div>

        {/* Data Cells */}
        {visibleColKeys.map((colKey, colIdx) => {
          const col = SPREADSHEET_COL_MAP.get(colKey)!;
          const w = getColWidth(colKey);
          const isPinnedCol = pinnedSet.has(colKey);
          const isEditing = editingCell?.row === visualRowIdx && editingCell?.col === colIdx;
          const isActive = activeCell?.row === visualRowIdx && activeCell?.col === colIdx;
          const inSel = isCellInRange(selectionRange, visualRowIdx, colIdx);
          const inFillPreview =
            fillPreview !== null &&
            isCellInRange(fillPreview, visualRowIdx, colIdx) &&
            !isCellInRange(selectionRange, visualRowIdx, colIdx);
          const showFillHandle =
            !editingCell &&
            selectionRange !== null &&
            selectionRange.endRow === visualRowIdx &&
            selectionRange.endCol === colIdx;

          const customN9 = colKey === "nearest9" && Boolean(item.nearest9Custom && String(item.nearest9Custom).trim() !== "");
          const isNum = col.kind === "number";
          const isSku = colKey === "rawVendorSku" || colKey === "cleanedSku" || colKey === "productNumber";
          const isWrap = prefs.wrapCols.includes(colKey);

          let cellBg = baseRowBg;
          if (inFillPreview) cellBg = "rgba(14, 165, 233, 0.22)";
          else if (inSel && !isActive) cellBg = "rgba(99, 102, 241, 0.14)";
          else if (customN9) cellBg = "var(--grid-custom-bg, #fffbeb)";
          else if (col.editable && !isRowChecked && item.matched) cellBg = "var(--grid-editable-bg, #f0fdf4)";

          const cellStyle: CSSProperties = {
            width: w,
            minWidth: w,
            maxWidth: w,
            background: cellBg,
            ...(isPinnedCol
              ? {
                  position: "sticky",
                  left: colLeftOffsets[colKey],
                  zIndex: isPinnedTop ? 35 : 15,
                  boxShadow: colKey === lastPinnedKey ? PIN_EDGE_SHADOW : undefined,
                }
              : {}),
          };

          const rawVal = getCellRawValue(item, colKey);

          return (
            <div
              key={colKey}
              role="gridcell"
              data-col={colKey}
              style={cellStyle}
              onPointerDown={(e) => {
                if (e.button === 2) return; // right-click handled by onContextMenu
                if (editingCell && (editingCell.row !== visualRowIdx || editingCell.col !== colIdx)) {
                  commitEdit();
                }
                if (e.shiftKey && activeCell) {
                  setSelectionRange(normalizeRange(activeCell.row, activeCell.col, visualRowIdx, colIdx));
                } else {
                  setActiveCell({ row: visualRowIdx, col: colIdx });
                  setSelectionRange({ startRow: visualRowIdx, endRow: visualRowIdx, startCol: colIdx, endCol: colIdx });
                  selDragRef.current = { anchorRow: visualRowIdx, anchorCol: colIdx };
                }
                gridRootRef.current?.focus({ preventScroll: true });
              }}
              onPointerEnter={() => {
                if (fillDragRef.current) {
                  const src = fillDragRef.current.source;
                  // Excel-style: extend either vertically or horizontally based on dominant drag delta
                  const dRow = Math.max(src.startRow - visualRowIdx, visualRowIdx - src.endRow, 0);
                  const dCol = Math.max(src.startCol - colIdx, colIdx - src.endCol, 0);
                  let target: CellRange;
                  if (dRow >= dCol) {
                    target = {
                      startRow: Math.min(src.startRow, visualRowIdx),
                      endRow: Math.max(src.endRow, visualRowIdx),
                      startCol: src.startCol,
                      endCol: src.endCol,
                    };
                  } else {
                    target = {
                      startRow: src.startRow,
                      endRow: src.endRow,
                      startCol: Math.min(src.startCol, colIdx),
                      endCol: Math.max(src.endCol, colIdx),
                    };
                  }
                  fillDragRef.current.currentTarget = target;
                  setFillPreview(target);
                  return;
                }
                if (selDragRef.current) {
                  setSelectionRange(
                    normalizeRange(selDragRef.current.anchorRow, selDragRef.current.anchorCol, visualRowIdx, colIdx),
                  );
                }
              }}
              onDoubleClick={() => {
                if (col.editable) startEdit(visualRowIdx, colIdx);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!isCellInRange(selectionRange, visualRowIdx, colIdx)) {
                  setActiveCell({ row: visualRowIdx, col: colIdx });
                  setSelectionRange({ startRow: visualRowIdx, endRow: visualRowIdx, startCol: colIdx, endCol: colIdx });
                }
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  rowIndex: visualRowIdx,
                  colIndex: colIdx,
                  item,
                  colKey,
                });
              }}
              className={`relative flex shrink-0 items-center border-r border-slate-200/90 dark:border-zinc-800/90 px-2 overflow-hidden ${
                isActive ? "ring-2 ring-inset ring-indigo-600 dark:ring-indigo-400 z-[18]" : ""
              } ${inFillPreview ? "outline-1 outline-dashed outline-sky-500 -outline-offset-1" : ""}`}
            >
              {isEditing ? (
                <input
                  ref={editInputRef}
                  type="text"
                  value={editingCell.draft}
                  onChange={(e) => setEditingCell((prev) => (prev ? { ...prev, draft: e.target.value } : prev))}
                  onBlur={() => commitEdit()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") { e.preventDefault(); commitEdit(e.shiftKey ? "up" : "down"); }
                    else if (e.key === "Tab") { e.preventDefault(); commitEdit(e.shiftKey ? "left" : "right"); }
                    else if (e.key === "Escape") { e.preventDefault(); setEditingCell(null); gridRootRef.current?.focus({ preventScroll: true }); }
                  }}
                  className={`h-full w-full bg-white dark:bg-zinc-900 px-1 text-[13px] text-slate-900 dark:text-white outline-none ${
                    isNum ? "text-right font-mono tabular-nums" : isSku ? "font-mono text-xs" : ""
                  }`}
                />
              ) : colKey === "flags" ? (
                <div className="truncate w-full">
                  <Flags r={item} />
                </div>
              ) : colKey === "notes" ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenNotes(item); }}
                  className="w-full truncate text-left text-xs text-slate-700 dark:text-zinc-300 hover:text-indigo-700 dark:hover:text-indigo-300"
                  title={rawVal ? "Click to open Markdown notes" : "Add Markdown note"}
                >
                  {rawVal ? <MarkdownDoc source={rawVal} compact /> : <span className="text-slate-400">+ Note</span>}
                </button>
              ) : (
                <div
                  className={`w-full ${isWrap ? "whitespace-normal break-words leading-tight text-xs" : "truncate"} ${
                    isNum ? "text-right font-mono tabular-nums" : isSku ? "font-mono text-xs" : ""
                  } text-slate-900 dark:text-zinc-100`}
                  title={
                    colKey === "nearest9" && customN9
                      ? `Custom Nearest 9 (${rawVal}) — clear to restore calculated value`
                      : rawVal
                  }
                >
                  {rawVal}
                </div>
              )}

              {customN9 && !isEditing && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-1 top-0.5 rounded bg-amber-400/90 px-1 text-[9px] font-bold leading-tight text-amber-950"
                >
                  custom
                </span>
              )}

              {/* Excel Fill Handle at bottom-right of selection */}
              {showFillHandle && (
                <span
                  role="button"
                  aria-label="Drag fill handle"
                  title="Drag down or across to fill cells"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!selectionRange) return;
                    fillDragRef.current = { source: selectionRange, currentTarget: selectionRange };
                    setFillPreview(selectionRange);
                  }}
                  className="absolute -right-[1px] -bottom-[1px] z-20 h-2.5 w-2.5 cursor-crosshair border border-white dark:border-zinc-900 bg-indigo-600 dark:bg-indigo-400"
                />
              )}
            </div>
          );
        })}

        {/* Delete Row Action Column */}
        <div
          className="flex shrink-0 items-center justify-center"
          style={{ width: ACTION_W }}
        >
          <button
            type="button"
            onClick={() => onDeleteRow(item)}
            title="Delete row"
            aria-label={`Delete ${item.cleanedSku || item.rawVendorSku}`}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      className={
        isFullscreen
          ? "flex h-full w-full flex-col bg-white dark:bg-zinc-950 overflow-hidden"
          : "flex flex-col rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs overflow-hidden"
      }
    >
      {/* Fullscreen Compact Header Bar */}
      {isFullscreen && (
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 bg-slate-900 px-4 py-2 text-xs text-white">
          <div className="flex items-center gap-3">
            <span className="font-bold text-sm">{sheetTitle || "Price Update Spreadsheet"}</span>
            <span className="rounded bg-white/15 px-2 py-0.5 font-mono text-[11px]">
              {combinedRows.length.toLocaleString()} / {items.length.toLocaleString()} rows
            </span>
          </div>
          <div className="flex items-center gap-2">
            {onSwitchToLegacy && (
              <button
                type="button"
                onClick={onSwitchToLegacy}
                className="rounded-md border border-white/25 px-2.5 py-1 text-xs font-medium hover:bg-white/10"
              >
                Switch to Legacy Editor
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsFullscreen(false)}
              className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-100"
            >
              Exit Full Screen
            </button>
          </div>
        </div>
      )}

      {/* Compact Excel Toolbar */}
      <SpreadsheetToolbar
        globalQuery={globalQuery}
        onGlobalQueryChange={setGlobalQuery}
        quickFilters={quickFilters}
        onQuickFiltersChange={setQuickFilters}
        columnFilters={columnFilters}
        onClearColumnFilter={(k) =>
          setColumnFilters((prev) => {
            const next = { ...prev };
            delete next[k];
            return next;
          })
        }
        onClearAllFilters={() => {
          setGlobalQuery("");
          setQuickFilters(DEFAULT_QUICK_FILTERS);
          setColumnFilters({});
        }}
        sortRules={sortRules}
        onSortRulesChange={setSortRules}
        columnVisibility={prefs.columnVisibility}
        onToggleColumnVisibility={(k) =>
          setPrefs((prev) => ({
            ...prev,
            columnVisibility: { ...prev.columnVisibility, [k]: prev.columnVisibility[k] === false },
          }))
        }
        onShowAllColumns={() => setPrefs((prev) => ({ ...prev, columnVisibility: {} }))}
        onAutoFitAllColumns={autoFitAllColumns}
        onResetLayout={() => {
          setPrefs({ ...DEFAULT_SPREADSHEET_PREFS });
          setPinnedRowIds([]);
          toast.success("Spreadsheet layout reset to defaults.");
        }}
        pinnedColumns={prefs.pinnedColumns}
        pinnedRowCount={pinnedTopRows.length}
        onUnfreezeAll={() => {
          setPrefs((prev) => ({ ...prev, pinnedColumns: [] }));
          setPinnedRowIds([]);
        }}
        onFreezeTopN={(n) => {
          if (n <= 0) setPinnedRowIds([]);
          else setPinnedRowIds(processedRows.slice(0, n).map((r) => r.id));
        }}
        onPinSelectedRows={() => {
          const ids = processedRows.filter((r) => selected.has(r.id)).map((r) => r.id).slice(0, 20);
          setPinnedRowIds(ids);
        }}
        selectedRowCount={selected.size}
        selectedCellCount={selectionStats?.count ?? (activeCell ? 1 : 0)}
        selectionStats={selectionStats}
        onOpenBulkEdit={() => setShowBulkModal(true)}
        density={prefs.density}
        onDensityChange={(d: RowDensity) => setPrefs((prev) => ({ ...prev, density: d }))}
        isFullscreen={isFullscreen}
        onToggleFullscreen={() => setIsFullscreen((v) => !v)}
        saveStatus={saveStatus}
        onFlushNow={onFlushNow}
        onRetryFailed={onRetryFailed}
        visibleRowCount={combinedRows.length}
        totalRowCount={items.length}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        undoTooltip={undoTooltip}
        redoTooltip={redoTooltip}
        onAddRow={onAddRow}
        onBulkAdd={onBulkAdd}
        onOpenSetLower={onOpenSetLower}
        lowerCount={lowerCount}
        onOpenDeleteSelected={onOpenDeleteSelected}
      />

      {/* Compact Excel Formula / Cell Inspector Bar */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/80 px-3 py-1 text-xs">
        <span className="shrink-0 rounded border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 dark:text-zinc-200 min-w-28 text-center">
          {activeInfo ? `R${activeInfo.rowNumber} · ${SPREADSHEET_COL_MAP.get(activeInfo.colKey)?.shortLabel}` : "No cell"}
        </span>
        {activeInfo ? (
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              activeInfo.editable
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                : "bg-slate-200/80 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400"
            }`}>
              {activeInfo.editable ? "Editable" : "Read-only"}
            </span>
            <span className="truncate font-mono text-xs text-slate-800 dark:text-zinc-200">
              {activeInfo.value || <span className="italic text-slate-400">(empty)</span>}
            </span>
          </div>
        ) : (
          <span className="text-[11px] text-slate-400 dark:text-zinc-500">
            Click any cell to navigate · Double-click or type to edit · Shift+Click headers to multi-sort · Drag blue square to fill · Ctrl/Cmd+C &amp; V to copy/paste
          </span>
        )}
      </div>

      {/* Virtualized Grid Viewport */}
      <div
        ref={(el) => {
          scrollRef.current = el;
          gridRootRef.current = el;
        }}
        tabIndex={0}
        role="grid"
        aria-label="Price Update Spreadsheet"
        onKeyDown={handleGridKeyDown}
        onPaste={handleGridPaste}
        className="relative flex-1 min-h-0 overflow-auto outline-none bg-white dark:bg-zinc-950"
        style={isFullscreen ? undefined : { height: "calc(100vh - 250px)", minHeight: 520 }}
      >
        <div style={{ width: totalTableWidth, minHeight: "100%" }}>
          {/* Sticky Header Row */}
          <div
            role="row"
            className="sticky top-0 z-30 flex items-stretch border-b-2 border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-xs font-semibold text-slate-700 dark:text-zinc-200 select-none"
            style={{ height: HEADER_H, width: totalTableWidth }}
          >
            {/* Row # Header */}
            <div
              className="flex shrink-0 items-center justify-center border-r border-slate-200 dark:border-zinc-800 text-[11px] font-normal text-slate-400"
              style={{ width: ROW_NUM_W, position: "sticky", left: 0, zIndex: 42, background: "var(--grid-header-bg, #f1f5f9)" }}
            >
              #
            </div>

            {/* Select All Visible Checkbox Header */}
            <div
              className="flex shrink-0 items-center justify-center border-r border-slate-200 dark:border-zinc-800"
              style={{
                width: CHECK_W,
                position: "sticky",
                left: ROW_NUM_W,
                zIndex: 42,
                background: "var(--grid-header-bg, #f1f5f9)",
                boxShadow: !lastPinnedKey ? PIN_EDGE_SHADOW : undefined,
              }}
            >
              <input
                type="checkbox"
                aria-label="Select all filtered rows"
                checked={allVisibleChecked}
                ref={(el) => { if (el) el.indeterminate = !allVisibleChecked && selectedVisibleCount > 0; }}
                onChange={() => onToggleRows(allVisibleIds, !allVisibleChecked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
              />
            </div>

            {/* Data Column Headers (Draggable + Resizable + Multi-Sort + Filter Menu) */}
            {visibleColKeys.map((colKey) => {
              const col = SPREADSHEET_COL_MAP.get(colKey)!;
              const w = getColWidth(colKey);
              const isPinnedCol = pinnedSet.has(colKey);
              const sortIdx = sortRules.findIndex((r) => r.id === colKey);
              const sortRule = sortIdx >= 0 ? sortRules[sortIdx] : null;
              const hasFilter = Boolean(columnFilters[colKey]);
              const isDropTarget = dropTargetCol === colKey;

              const headerBg = col.editable
                ? "var(--grid-editable-bg, #ecfdf5)"
                : "var(--grid-header-bg, #f1f5f9)";

              return (
                <div
                  key={colKey}
                  role="columnheader"
                  draggable
                  onDragStart={() => onColDragStart(colKey)}
                  onDragOver={(e) => onColDragOver(e, colKey)}
                  onDrop={() => onColDrop(colKey)}
                  onDragEnd={onColDragEnd}
                  style={{
                    width: w,
                    minWidth: w,
                    maxWidth: w,
                    background: headerBg,
                    ...(isPinnedCol
                      ? {
                          position: "sticky",
                          left: colLeftOffsets[colKey],
                          zIndex: 40,
                          boxShadow: colKey === lastPinnedKey ? PIN_EDGE_SHADOW : undefined,
                        }
                      : {}),
                  }}
                  className={`relative flex shrink-0 items-center justify-between gap-1 border-r border-slate-200 dark:border-zinc-800 px-2 cursor-grab active:cursor-grabbing ${
                    isDropTarget ? "border-l-4 border-l-indigo-600" : ""
                  } ${col.editable ? "text-emerald-950 dark:text-emerald-300" : ""}`}
                >
                  <button
                    type="button"
                    onClick={(e) => handleHeaderClick(colKey, e.shiftKey)}
                    title={`${col.label} — Click to sort, Shift+Click to add multi-column sort, drag header to reorder`}
                    className={`flex flex-1 items-center gap-1 min-w-0 truncate ${
                      col.kind === "number" ? "justify-end text-right" : "text-left"
                    }`}
                  >
                    {isPinnedCol && <span className="text-[10px] text-indigo-600 dark:text-indigo-400 shrink-0">📌</span>}
                    <span className="truncate">{col.label}</span>
                  </button>

                  <div className="flex shrink-0 items-center gap-0.5">
                    {sortRule && (
                      <span
                        className="inline-flex items-center rounded bg-indigo-600 px-1 py-0.2 font-mono text-[10px] font-bold text-white"
                        title={`Sort priority #${sortIdx + 1} (${sortRule.desc ? "Descending" : "Ascending"})`}
                      >
                        {sortRules.length > 1 ? sortIdx + 1 : ""}
                        {sortRule.desc ? "↓" : "↑"}
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={`Filter and sort ${col.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setHeaderMenu((prev) => (prev?.key === colKey ? null : { key: colKey, rect }));
                      }}
                      className={`rounded p-0.5 transition-colors ${
                        hasFilter
                          ? "bg-sky-600 text-white"
                          : "text-slate-400 hover:bg-slate-200 dark:hover:bg-zinc-700 hover:text-slate-900 dark:hover:text-white"
                      }`}
                    >
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                        {hasFilter ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        )}
                      </svg>
                    </button>
                  </div>

                  {/* Resize Handle (drag to resize, double-click to auto-fit) */}
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    title="Drag to resize · Double-click to auto-fit"
                    onPointerDown={(e) => startColResize(e, colKey)}
                    onDoubleClick={(e) => { e.stopPropagation(); autoFitColumn(colKey); }}
                    className="absolute top-0 right-0 h-full w-2.5 cursor-col-resize touch-none"
                  >
                    <span className="absolute top-0 right-0 h-full w-[2px] bg-transparent hover:bg-indigo-500" />
                  </span>
                </div>
              );
            })}

            {/* Right Action Header Spacer */}
            <div className="shrink-0" style={{ width: ACTION_W }} />
          </div>

          {/* Frozen Top Rows (simultaneous with Frozen Left Columns!) */}
          {pinnedTopRows.map((row, idx) => renderRow(row, idx, true, HEADER_H + idx * rowHeight))}

          {/* Virtualized Body Rows */}
          {bodyRows.length === 0 && pinnedTopRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-xs text-slate-400 dark:text-zinc-500">
              <p className="font-medium text-slate-600 dark:text-zinc-300">No products match the current filters.</p>
              <button
                type="button"
                onClick={() => {
                  setGlobalQuery("");
                  setQuickFilters(DEFAULT_QUICK_FILTERS);
                  setColumnFilters({});
                }}
                className="mt-2 rounded-lg border border-slate-200 dark:border-zinc-700 px-3 py-1.5 font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-slate-50 dark:hover:bg-zinc-800"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: totalTableWidth,
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((vRow) => {
                const row = bodyRows[vRow.index];
                if (!row) return null;
                return renderRow(row, pinnedTopRows.length + vRow.index, false, vRow.start);
              })}
            </div>
          )}
        </div>
      </div>

      {/* Column Header Filter / Sort / Freeze Popover */}
      {headerMenu && SPREADSHEET_COL_MAP.has(headerMenu.key) && (
        <ColumnHeaderMenu
          col={SPREADSHEET_COL_MAP.get(headerMenu.key)!}
          anchorRect={headerMenu.rect}
          sortRules={sortRules}
          currentFilter={columnFilters[headerMenu.key]}
          isPinned={pinnedSet.has(headerMenu.key)}
          isWrapped={prefs.wrapCols.includes(headerMenu.key)}
          availableFlags={availableFlags}
          flagCounts={flagCounts}
          onClose={() => setHeaderMenu(null)}
          onSetPrimarySort={setPrimarySort}
          onAddSecondarySort={addSecondarySort}
          onRemoveSort={removeSort}
          onSetFilter={(k, spec) =>
            setColumnFilters((prev) => {
              const next = { ...prev };
              if (!spec) delete next[k];
              else next[k] = spec;
              return next;
            })
          }
          onTogglePin={togglePinColumn}
          onFreezeUpTo={freezeUpToColumn}
          onAutoFit={autoFitColumn}
          onToggleWrap={(k) =>
            setPrefs((prev) => ({
              ...prev,
              wrapCols: prev.wrapCols.includes(k)
                ? prev.wrapCols.filter((x) => x !== k)
                : [...prev.wrapCols, k],
            }))
          }
          onHideColumn={(k) =>
            setPrefs((prev) => ({
              ...prev,
              columnVisibility: { ...prev.columnVisibility, [k]: false },
            }))
          }
        />
      )}

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          role="menu"
          className="fixed z-50 w-56 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1 text-xs shadow-2xl text-slate-800 dark:text-zinc-200"
          style={{
            left: typeof window !== "undefined" ? Math.min(contextMenu.x, window.innerWidth - 235) : contextMenu.x,
            top: typeof window !== "undefined" ? Math.min(contextMenu.y, window.innerHeight - 280) : contextMenu.y,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => { setContextMenu(null); void copySelection(); }}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <span>Copy</span><span className="text-[10px] text-slate-400">Ctrl/Cmd+C</span>
          </button>
          <button
            type="button"
            onClick={() => { setContextMenu(null); void pasteSelection(); }}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <span>Paste</span><span className="text-[10px] text-slate-400">Ctrl/Cmd+V</span>
          </button>
          <button
            type="button"
            onClick={() => { setContextMenu(null); clearSelection(); }}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <span>Clear editable cell(s)</span><span className="text-[10px] text-slate-400">Del</span>
          </button>
          {selectionRange && selectionRange.endRow > selectionRange.startRow && (
            <button
              type="button"
              onClick={() => { setContextMenu(null); fillDownSelection(); }}
              className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              <span>Fill down selection</span><span className="text-[10px] text-slate-400">Ctrl/Cmd+D</span>
            </button>
          )}
          <div className="my-1 border-t border-slate-100 dark:border-zinc-800" />
          <button
            type="button"
            onClick={() => { setContextMenu(null); setShowBulkModal(true); }}
            className="block w-full px-3 py-1.5 text-left font-medium text-emerald-700 dark:text-emerald-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            Bulk edit selected rows...
          </button>
          {contextMenu.colKey === "discount" && (
            <button
              type="button"
              onClick={() => {
                const it = contextMenu.item;
                setContextMenu(null);
                onRestoreDiscount(it);
              }}
              className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              Restore default Vendor/Brand discount
            </button>
          )}
          {contextMenu.colKey === "nearest9" && Boolean(contextMenu.item.nearest9Custom) && (
            <button
              type="button"
              onClick={() => {
                const it = contextMenu.item;
                setContextMenu(null);
                onApplyBatchEdit(
                  [{ id: it.id, fields: { nearest9: "" } }],
                  [{ id: it.id, fields: { nearest9: it.nearest9Custom ?? "" } }],
                  "Clear Custom Nearest 9",
                );
              }}
              className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              Clear Custom Nearest 9 (restore auto)
            </button>
          )}
          <div className="my-1 border-t border-slate-100 dark:border-zinc-800" />
          <button
            type="button"
            onClick={() => {
              const rid = contextMenu.item.id;
              setContextMenu(null);
              setPinnedRowIds((prev) => (prev.includes(rid) ? prev.filter((x) => x !== rid) : [...prev, rid]));
            }}
            className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            {pinnedRowIds.includes(contextMenu.item.id) ? "Unfreeze this row" : "Freeze this row at top"}
          </button>
        </div>
      )}

      {/* Bulk Edit Modal */}
      {showBulkModal && bulkTargetRows.length > 0 && (
        <BulkEditModal
          targetRowCount={bulkTargetRows.length}
          scopeLabel={selected.size > 0 ? "checked rows" : "selected rows"}
          onApply={handleBulkEditApply}
          onClose={() => setShowBulkModal(false)}
        />
      )}
    </div>
  );
}
