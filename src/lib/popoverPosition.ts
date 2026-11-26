export type RectLike = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type PopoverPositionInput = {
  anchorRect: RectLike;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  gap?: number;
  padding?: number;
  preferAlign?: "start" | "end";
};

export type PopoverPositionResult = {
  top: number;
  left: number;
  maxHeight: number;
  maxWidth: number;
  placement: "bottom" | "top";
};

/**
 * Pure viewport-collision positioning for anchored menus/popovers.
 *
 * - Keeps the menu inside the horizontal viewport bounds (shifting left when
 *   opened near the right edge and right when opened near the left edge).
 * - Flips above the anchor when there is not enough vertical room below and
 *   more room exists above.
 * - Caps maxHeight/maxWidth so content scrolls internally rather than
 *   overflowing small viewports.
 */
export function computePopoverPosition({
  anchorRect,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
  gap = 6,
  padding = 8,
  preferAlign = "start",
}: PopoverPositionInput): PopoverPositionResult {
  const safeViewportW = Math.max(viewportWidth, padding * 2 + 120);
  const safeViewportH = Math.max(viewportHeight, padding * 2 + 120);
  const maxWidth = Math.max(120, safeViewportW - padding * 2);
  const effectiveW = Math.min(Math.max(menuWidth, 0), maxWidth);

  const idealLeft = preferAlign === "end" ? anchorRect.right - effectiveW : anchorRect.left;
  const maxLeft = Math.max(padding, safeViewportW - padding - effectiveW);
  const left = Math.min(Math.max(idealLeft, padding), maxLeft);

  const spaceBelow = Math.max(0, safeViewportH - anchorRect.bottom - gap - padding);
  const spaceAbove = Math.max(0, anchorRect.top - gap - padding);

  let placement: "bottom" | "top" = "bottom";
  let maxHeight: number;
  let top: number;

  if (menuHeight <= spaceBelow || spaceBelow >= spaceAbove) {
    placement = "bottom";
    maxHeight = Math.max(120, spaceBelow);
    const usedH = Math.min(menuHeight, maxHeight);
    top = anchorRect.bottom + gap;
    if (top + usedH > safeViewportH - padding) {
      top = Math.max(padding, safeViewportH - padding - usedH);
    }
  } else {
    placement = "top";
    maxHeight = Math.max(120, spaceAbove);
    const usedH = Math.min(menuHeight, maxHeight);
    top = Math.max(padding, anchorRect.top - gap - usedH);
  }

  return {
    top: Math.round(top),
    left: Math.round(left),
    maxHeight: Math.round(maxHeight),
    maxWidth: Math.round(maxWidth),
    placement,
  };
}
