/**
 * Pure helpers for the Price Update table UI:
 *
 *   1. A bounded undo/redo history stack for table actions (edits, fills,
 *      add/delete rows).
 *   2. Excel-style column freezing (frozen columns are always a prefix of the
 *      column order so they stay fixed together, in their original order).
 *
 * No pricing, matching, sorting, flags, or database logic lives here — only
 * bookkeeping — so it stays trivially unit-testable.
 */

/* ------------------------------- Undo / Redo ------------------------------ */

export type HistoryEntry = {
  /** Human label, e.g. "Edit Discount". Shown in the Undo/Redo tooltips. */
  label: string;
  /** Reverses this action (called by Undo). */
  undo: () => void | Promise<void>;
  /** Re-applies this action (called by Redo). */
  redo: () => void | Promise<void>;
};

export type HistoryState = { past: HistoryEntry[]; future: HistoryEntry[] };

/** Reasonable amount of history kept for the current editing session. */
export const HISTORY_LIMIT = 50;

export const EMPTY_HISTORY: HistoryState = { past: [], future: [] };

/** Record a new action. Any undone-but-not-redone actions are discarded. */
export function pushHistory(
  state: HistoryState,
  entry: HistoryEntry,
  limit: number = HISTORY_LIMIT,
): HistoryState {
  return { past: [...state.past, entry].slice(-limit), future: [] };
}

export function canUndo(state: HistoryState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: HistoryState): boolean {
  return state.future.length > 0;
}

/** Label of the action Undo would reverse ("" when there is nothing to undo). */
export function undoLabel(state: HistoryState): string {
  return state.past.length ? state.past[state.past.length - 1].label : "";
}

/** Label of the action Redo would re-apply ("" when there is nothing to redo). */
export function redoLabel(state: HistoryState): string {
  return state.future.length ? state.future[state.future.length - 1].label : "";
}

/** Pop the newest action for Undo. Returns null when there is nothing to undo. */
export function takeUndo(state: HistoryState): { state: HistoryState; entry: HistoryEntry } | null {
  if (!state.past.length) return null;
  const entry = state.past[state.past.length - 1];
  return { state: { past: state.past.slice(0, -1), future: [...state.future, entry] }, entry };
}

/** Pop the most recently undone action for Redo. Null when there is nothing to redo. */
export function takeRedo(state: HistoryState): { state: HistoryState; entry: HistoryEntry } | null {
  if (!state.future.length) return null;
  const entry = state.future[state.future.length - 1];
  return { state: { past: [...state.past, entry], future: state.future.slice(0, -1) }, entry };
}

/* ----------------------------- Column freezing ---------------------------- */

export type FreezeGutter = { rowNumbers: number; checkboxes: number };

/**
 * Freeze `key` (and, by Excel rules, every column to its left, so frozen
 * columns always stay fixed together in their original order).
 * Returns the new frozen-count; freezing an already frozen column is a no-op.
 */
export function freezeColumn(keys: readonly string[], frozenCount: number, key: string): number {
  const i = keys.indexOf(key);
  if (i < 0 || i < frozenCount) return frozenCount;
  return i + 1;
}

/**
 * Unfreeze `key`. Columns to its right become unfrozen too — freezing is a
 * contiguous prefix, so a gap could never be displayed correctly.
 */
export function unfreezeColumn(keys: readonly string[], frozenCount: number, key: string): number {
  const i = keys.indexOf(key);
  if (i < 0 || i >= frozenCount) return frozenCount;
  return i;
}

/** True when `key` is currently frozen (i.e. part of the fixed left prefix). */
export function isFrozen(keys: readonly string[], frozenCount: number, key: string): boolean {
  const i = keys.indexOf(key);
  return i >= 0 && i < frozenCount;
}

/**
 * Left offset (px) of a frozen column: the always-sticky row-number and
 * checkbox gutter plus every frozen column before it. Returns null when the
 * column is not frozen (so the caller renders it without sticky styles).
 */
export function frozenLeft(
  keys: readonly string[],
  frozenCount: number,
  key: string,
  widths: Readonly<Record<string, number>>,
  gutter: FreezeGutter,
): number | null {
  const i = keys.indexOf(key);
  if (i < 0 || i >= frozenCount) return null;
  let left = gutter.rowNumbers + gutter.checkboxes;
  for (let j = 0; j < i; j++) left += widths[keys[j]] ?? 0;
  return left;
}
