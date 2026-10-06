/**
 * Presentation-only table layout helpers for the Price Update sheet.
 *
 * Stores the user's *display* preferences — column widths, row heights,
 * Wrap Text columns, and frozen-column count — in sessionStorage so they
 * survive navigation during the current session.
 *
 * No pricing, matching, sorting, flags, export, or database logic lives
 * here — only clamping, toggling, and (de)serialization — so it stays
 * trivially unit-testable. Nothing here touches row data.
 */

export type TableLayoutState = {
  /** Column key -> width in px (only columns the user resized). */
  widths: Record<string, number>;
  /** Row id -> height in px (only rows the user resized). */
  heights: Record<string, number>;
  /** Column keys with Wrap Text enabled. */
  wrapped: string[];
  /** Frozen-column count (contiguous left prefix, same meaning as the grid). */
  frozen: number;
};

/** Narrowest a column can be dragged (keeps the sort/menu button reachable). */
export const MIN_COL_WIDTH = 64;
/** Widest a column can be dragged (keeps the sheet scrollable). */
export const MAX_COL_WIDTH = 900;
/** Shortest a row can be dragged. */
export const MIN_ROW_HEIGHT = 26;
/** Tallest a row can be dragged (wrapped content can still grow past this). */
export const MAX_ROW_HEIGHT = 640;

function clampInt(px: number, lo: number, hi: number): number {
  if (!Number.isFinite(px)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(px)));
}

/** Clamp a dragged column width into the allowed range. */
export function clampColWidth(px: number): number {
  return clampInt(px, MIN_COL_WIDTH, MAX_COL_WIDTH);
}

/** Clamp a dragged row height into the allowed range. */
export function clampRowHeight(px: number): number {
  return clampInt(px, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
}

/** True when Wrap Text is enabled for `key`. */
export function isWrapped(wrapped: readonly string[], key: string): boolean {
  return wrapped.includes(key);
}

/**
 * Toggle Wrap Text for `key`. Returns a new array; enables when off,
 * disables when on. Never mutates the input.
 */
export function toggleWrapped(wrapped: readonly string[], key: string): string[] {
  if (isWrapped(wrapped, key)) return wrapped.filter((k) => k !== key);
  return [...wrapped, key];
}

/** sessionStorage key for a grid instance (one layout per price update). */
export function layoutStorageKey(layoutKey: string): string {
  return `pricegrid:layout:${layoutKey}`;
}

function sanitizedNumberMap(raw: unknown, clamp: (n: number) => number): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || !k || typeof v !== "number" || !Number.isFinite(v)) continue;
    out[k.slice(0, 80)] = clamp(v);
    if (Object.keys(out).length >= 500) break;
  }
  return out;
}

/**
 * Validate unknown parsed JSON into a TableLayoutState. Returns null when
 * there is nothing usable (missing/corrupt/foreign data) so callers fall
 * back to defaults without throwing.
 */
export function sanitizeLayout(raw: unknown): TableLayoutState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const wrapped = Array.isArray(r.wrapped)
    ? [...new Set(r.wrapped.filter((k): k is string => typeof k === "string" && !!k))].slice(0, 100)
    : [];
  const frozenRaw = r.frozen;
  const frozen =
    typeof frozenRaw === "number" && Number.isFinite(frozenRaw)
      ? Math.max(0, Math.floor(frozenRaw))
      : 0;
  const widths = sanitizedNumberMap(r.widths, clampColWidth);
  const heights = sanitizedNumberMap(r.heights, clampRowHeight);
  if (!wrapped.length && !Object.keys(widths).length && !Object.keys(heights).length && frozen === 0) {
    return null;
  }
  return { widths, heights, wrapped, frozen };
}

/**
 * Load a saved layout for this grid instance (current session only).
 * Returns null on the server, without a layoutKey, or when nothing valid
 * was saved — all safe fallbacks to grid defaults.
 */
export function loadTableLayout(layoutKey: string | undefined): TableLayoutState | null {
  try {
    if (!layoutKey || typeof window === "undefined") return null;
    const store = window.sessionStorage;
    if (!store) return null;
    const raw = store.getItem(layoutStorageKey(layoutKey));
    if (!raw) return null;
    return sanitizeLayout(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Save a layout for this grid instance (current session only). Never
 * throws: persistence is a nicety and must never break the grid.
 */
export function saveTableLayout(layoutKey: string | undefined, state: TableLayoutState): void {
  try {
    if (!layoutKey || typeof window === "undefined") return;
    const store = window.sessionStorage;
    if (!store) return;
    store.setItem(
      layoutStorageKey(layoutKey),
      JSON.stringify({ widths: state.widths, heights: state.heights, wrapped: state.wrapped, frozen: state.frozen }),
    );
  } catch {
    // Session-only nicety (private mode, quota, SSR) — grid keeps working in memory.
  }
}
