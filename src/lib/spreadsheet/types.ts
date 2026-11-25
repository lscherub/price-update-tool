import type { SortableItemKey } from "@/lib/itemSort";

export type SpreadsheetColKind = "text" | "number" | "flags";

export type SpreadsheetColDef = {
  key: SortableItemKey;
  label: string;
  shortLabel: string;
  editable: boolean;
  kind: SpreadsheetColKind;
  defaultWidth: number;
};

export type TextFilterOp =
  | "contains"
  | "notContains"
  | "equals"
  | "notEquals"
  | "beginsWith"
  | "endsWith"
  | "blank"
  | "nonBlank";

export type NumberFilterOp =
  | "gt"
  | "lt"
  | "eq"
  | "between"
  | "gte"
  | "lte"
  | "blank"
  | "nonBlank";

export type ColumnFilterSpec =
  | { kind: "text"; op: TextFilterOp; value: string }
  | { kind: "number"; op: NumberFilterOp; value: string; valueTo?: string }
  | { kind: "flags"; values: string[] };

export type TriStateFilter = "all" | "yes" | "no";

export type ExpandedQuickFilters = {
  /** Legacy status dropdown value (kept 100% compatible). */
  legacyFilter: string;
  vendorPrice: TriStateFilter;
  discount: TriStateFilter;
  newRetail: TriStateFilter;
  customOverride: TriStateFilter;
  priceChanged: TriStateFilter;
};

export const DEFAULT_QUICK_FILTERS: ExpandedQuickFilters = {
  legacyFilter: "all",
  vendorPrice: "all",
  discount: "all",
  newRetail: "all",
  customOverride: "all",
  priceChanged: "all",
};

export type SortRule = {
  id: SortableItemKey;
  desc: boolean;
};

export type CellRange = {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
};

export type RowDensity = "compact" | "comfortable" | "spacious";

export type SpreadsheetPrefs = {
  columnOrder: SortableItemKey[];
  columnSizing: Record<string, number>;
  columnVisibility: Record<string, boolean>;
  pinnedColumns: SortableItemKey[];
  wrapCols: string[];
  density: RowDensity;
};

export type SaveQueueSnapshot = {
  state: "saved" | "dirty" | "saving" | "error";
  pendingCount: number;
  inFlightCount: number;
  failedCount: number;
  lastSavedAt: number | null;
  lastError: string | null;
};

export type CellPatch = {
  id: string;
  fields: Record<string, string>;
};
