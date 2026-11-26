"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computePopoverPosition, type PopoverPositionResult } from "@/lib/popoverPosition";

export interface AnchoredMenuProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  style?: React.CSSProperties;
  preferAlign?: "start" | "end";
  gap?: number;
  padding?: number;
  ariaLabel?: string;
  role?: string;
  children: React.ReactNode;
}

function AnchoredMenuPortal({
  anchorRef,
  onClose,
  className = "",
  style,
  preferAlign = "start",
  gap = 6,
  padding = 8,
  ariaLabel,
  role = "dialog",
  children,
}: Omit<AnchoredMenuProps, "open">) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<PopoverPositionResult | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const next = computePopoverPosition({
      anchorRect,
      menuWidth: menuRect.width || menu.offsetWidth || 240,
      menuHeight: menuRect.height || menu.offsetHeight || 200,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      gap,
      padding,
      preferAlign,
    });
    setPos((prev) =>
      prev &&
      prev.top === next.top &&
      prev.left === next.left &&
      prev.maxHeight === next.maxHeight &&
      prev.maxWidth === next.maxWidth &&
      prev.placement === next.placement
        ? prev
        : next,
    );
  }, [anchorRef, gap, padding, preferAlign]);

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(updatePosition);
    return () => cancelAnimationFrame(raf);
  }, [updatePosition]);

  useEffect(() => {
    const handleScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      updatePosition();
    };
    const handleResize = () => updatePosition();

    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && menuRef.current) {
      ro = new ResizeObserver(() => updatePosition());
      ro.observe(menuRef.current);
    }

    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
      ro?.disconnect();
    };
  }, [updatePosition]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        anchorRef.current?.focus?.();
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, onClose]);

  return createPortal(
    <div
      ref={menuRef}
      role={role}
      aria-label={ariaLabel}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className={`fixed z-[60] overflow-y-auto ${className}`}
      style={{
        top: pos ? `${pos.top}px` : "-9999px",
        left: pos ? `${pos.left}px` : "-9999px",
        maxHeight: pos ? `${pos.maxHeight}px` : undefined,
        maxWidth: pos ? `${pos.maxWidth}px` : undefined,
        visibility: pos ? "visible" : "hidden",
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * Portal-rendered dropdown/popover anchored to a trigger element.
 *
 * Escapes overflow-hidden / overflow-x-auto table containers, stays within the
 * browser viewport on left/right edges, flips above/below automatically,
 * repositions on scroll/resize/content-resize, and dismisses on outside click
 * or Escape.
 */
export function AnchoredMenu({ open, ...rest }: AnchoredMenuProps) {
  if (!open || typeof document === "undefined") return null;
  return <AnchoredMenuPortal {...rest} />;
}
