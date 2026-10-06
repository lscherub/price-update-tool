import { describe, expect, it } from "vitest";
import {
  clampColWidth,
  clampRowHeight,
  isWrapped,
  layoutStorageKey,
  sanitizeLayout,
  toggleWrapped,
  MAX_COL_WIDTH,
  MAX_ROW_HEIGHT,
  MIN_COL_WIDTH,
  MIN_ROW_HEIGHT,
} from "@/lib/tableLayout";

/**
 * Presentation-only guarantees for the Price Update sheet upgrades:
 * resizable columns, resizable rows, per-column Wrap Text, and
 * session-only layout memory. None of this may touch row data —
 * these helpers only clamp, toggle, and (de)serialize display state.
 */
describe("table layout", () => {
  it("clamps column widths to a usable range", () => {
    expect(clampColWidth(0)).toBe(MIN_COL_WIDTH);
    expect(clampColWidth(-500)).toBe(MIN_COL_WIDTH);
    expect(clampColWidth(120)).toBe(120);
    expect(clampColWidth(5000)).toBe(MAX_COL_WIDTH);
    expect(clampColWidth(NaN)).toBe(MIN_COL_WIDTH);
  });

  it("clamps row heights to a usable range", () => {
    expect(clampRowHeight(0)).toBe(MIN_ROW_HEIGHT);
    expect(clampRowHeight(60)).toBe(60);
    expect(clampRowHeight(5000)).toBe(MAX_ROW_HEIGHT);
    expect(clampRowHeight(NaN)).toBe(MIN_ROW_HEIGHT);
  });

  it("toggles Wrap Text without mutating the input", () => {
    const start: string[] = [];
    const on = toggleWrapped(start, "notes");
    expect(on).toEqual(["notes"]);
    expect(start).toEqual([]);
    expect(isWrapped(on, "notes")).toBe(true);
    const off = toggleWrapped(on, "notes");
    expect(off).toEqual([]);
    expect(isWrapped(off, "notes")).toBe(false);
  });

  it("namespaces stored layouts per price update", () => {
    expect(layoutStorageKey("abc")).toBe("pricegrid:layout:abc");
    expect(layoutStorageKey("abc")).not.toBe(layoutStorageKey("def"));
  });

  it("rejects corrupt/foreign saved layouts", () => {
    expect(sanitizeLayout(null)).toBeNull();
    expect(sanitizeLayout("nope")).toBeNull();
    expect(sanitizeLayout({})).toBeNull();
    expect(sanitizeLayout({ frozen: "x", widths: { notes: "wide" } })).toBeNull();
  });

  it("keeps valid layouts but clamps out-of-range sizes", () => {
    const saved = sanitizeLayout({
      widths: { notes: 5000, vendor: 120, bad: NaN },
      heights: { row1: 4 },
      wrapped: ["notes", "notes", 42],
      frozen: 3,
    });
    expect(saved).not.toBeNull();
    expect(saved!.widths.notes).toBe(MAX_COL_WIDTH);
    expect(saved!.widths.vendor).toBe(120);
    expect(saved!.widths.bad).toBeUndefined();
    expect(saved!.heights.row1).toBe(MIN_ROW_HEIGHT);
    expect(saved!.wrapped).toEqual(["notes"]);
    expect(saved!.frozen).toBe(3);
  });
});
