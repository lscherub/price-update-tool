import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  EMPTY_HISTORY,
  freezeColumn,
  frozenLeft,
  HISTORY_LIMIT,
  isFrozen,
  pushHistory,
  redoLabel,
  takeRedo,
  takeUndo,
  unfreezeColumn,
  undoLabel,
  type HistoryEntry,
  type HistoryState,
} from "@/lib/tableUi";

const entry = (label: string): HistoryEntry => ({ label, undo: () => {}, redo: () => {} });
const labels = (s: HistoryState) => s.past.map((e) => e.label);

describe("undo/redo history", () => {
  it("starts empty with nothing to undo or redo", () => {
    expect(canUndo(EMPTY_HISTORY)).toBe(false);
    expect(canRedo(EMPTY_HISTORY)).toBe(false);
    expect(undoLabel(EMPTY_HISTORY)).toBe("");
    expect(redoLabel(EMPTY_HISTORY)).toBe("");
    expect(takeUndo(EMPTY_HISTORY)).toBeNull();
    expect(takeRedo(EMPTY_HISTORY)).toBeNull();
  });

  it("undoes newest first and redoes in the original order", () => {
    let s = pushHistory(EMPTY_HISTORY, entry("Edit Discount"));
    s = pushHistory(s, entry("Fill Notes down"));
    s = pushHistory(s, entry("Add row"));
    expect(labels(s)).toEqual(["Edit Discount", "Fill Notes down", "Add row"]);
    expect(undoLabel(s)).toBe("Add row");

    const u1 = takeUndo(s)!;
    expect(u1.entry.label).toBe("Add row");
    expect(labels(u1.state)).toEqual(["Edit Discount", "Fill Notes down"]);
    expect(canRedo(u1.state)).toBe(true);

    const u2 = takeUndo(u1.state)!;
    expect(u2.entry.label).toBe("Fill Notes down");

    const r1 = takeRedo(u2.state)!;
    expect(r1.entry.label).toBe("Fill Notes down");
    const r2 = takeRedo(r1.state)!;
    expect(r2.entry.label).toBe("Add row");
    expect(labels(r2.state)).toEqual(["Edit Discount", "Fill Notes down", "Add row"]);
    expect(canRedo(r2.state)).toBe(false);
  });

  it("keeps the original stacks untouched (pure functions)", () => {
    const s1 = pushHistory(EMPTY_HISTORY, entry("A"));
    takeUndo(s1);
    expect(labels(s1)).toEqual(["A"]);
    expect(s1.future).toEqual([]);
    expect(labels(EMPTY_HISTORY)).toEqual([]);
  });

  it("clears the redo stack when a new action is recorded", () => {
    let s = pushHistory(EMPTY_HISTORY, entry("A"));
    s = takeUndo(s)!.state;
    expect(canRedo(s)).toBe(true);
    s = pushHistory(s, entry("B"));
    expect(canRedo(s)).toBe(false);
    expect(labels(s)).toEqual(["B"]);
  });

  it("caps the history at the limit, dropping the oldest actions", () => {
    let s = EMPTY_HISTORY;
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) s = pushHistory(s, entry(`action ${i}`));
    expect(s.past.length).toBe(HISTORY_LIMIT);
    expect(s.past[0].label).toBe("action 10");
    expect(s.past[s.past.length - 1].label).toBe(`action ${HISTORY_LIMIT + 9}`);
    expect(undoLabel(s)).toBe(`action ${HISTORY_LIMIT + 9}`);
  });

  it("supports a custom limit", () => {
    let s = EMPTY_HISTORY;
    for (let i = 0; i < 5; i++) s = pushHistory(s, entry(`a${i}`), 3);
    expect(labels(s)).toEqual(["a2", "a3", "a4"]);
  });
});

describe("column freezing", () => {
  const KEYS = ["sku", "name", "brand", "vendor", "flags"];

  it("freezes a prefix so frozen columns keep their original order", () => {
    let count = freezeColumn(KEYS, 0, "brand");
    expect(count).toBe(3);
    expect(KEYS.slice(0, count)).toEqual(["sku", "name", "brand"]);
    expect(isFrozen(KEYS, count, "sku")).toBe(true);
    expect(isFrozen(KEYS, count, "name")).toBe(true);
    expect(isFrozen(KEYS, count, "brand")).toBe(true);
    expect(isFrozen(KEYS, count, "vendor")).toBe(false);
    expect(isFrozen(KEYS, count, "flags")).toBe(false);

    // Freezing a later column extends the prefix (multiple frozen columns).
    count = freezeColumn(KEYS, count, "flags");
    expect(count).toBe(5);
    expect(KEYS.slice(0, count)).toEqual(KEYS);
  });

  it("is a no-op when freezing an unknown or already frozen column", () => {
    expect(freezeColumn(KEYS, 2, "sku")).toBe(2);
    expect(freezeColumn(KEYS, 2, "nope")).toBe(2);
    expect(freezeColumn(KEYS, 0, "nope")).toBe(0);
  });

  it("unfreezes that column and any column to its right", () => {
    expect(unfreezeColumn(KEYS, 4, "brand")).toBe(2);
    expect(unfreezeColumn(KEYS, 4, "sku")).toBe(0);
    // Unfreezing a column that is not frozen does nothing.
    expect(unfreezeColumn(KEYS, 2, "vendor")).toBe(2);
    expect(unfreezeColumn(KEYS, 0, "sku")).toBe(0);
    expect(unfreezeColumn(KEYS, 2, "nope")).toBe(2);
  });

  it("places frozen columns after the row-number + checkbox gutter", () => {
    const widths = { sku: 100, name: 200, brand: 50, vendor: 75, flags: 120 };
    const gutter = { rowNumbers: 44, checkboxes: 36 };

    // Nothing frozen -> no offsets at all.
    expect(frozenLeft(KEYS, 0, "sku", widths, gutter)).toBeNull();

    expect(frozenLeft(KEYS, 4, "sku", widths, gutter)).toBe(80);
    expect(frozenLeft(KEYS, 4, "name", widths, gutter)).toBe(180);
    expect(frozenLeft(KEYS, 4, "brand", widths, gutter)).toBe(380);
    // Unfrozen columns are not positioned.
    expect(frozenLeft(KEYS, 4, "flags", widths, gutter)).toBeNull();
    expect(frozenLeft(KEYS, 4, "nope", widths, gutter)).toBeNull();

    // A later freeze keeps the same offsets for earlier columns.
    expect(frozenLeft(KEYS, 5, "vendor", widths, gutter)).toBe(430);
    expect(frozenLeft(KEYS, 5, "flags", widths, gutter)).toBe(505);
  });

  it("treats a missing measured width as zero", () => {
    const gutter = { rowNumbers: 40, checkboxes: 30 };
    expect(frozenLeft(KEYS, 2, "name", {}, gutter)).toBe(70);
  });
});
