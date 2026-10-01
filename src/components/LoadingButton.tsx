"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * Reusable async-action button.
 *
 * Every button that triggers a database write, import, export or PDF
 * generation should use this so the user always sees that something is
 * happening: the label swaps to `busyLabel`, a spinner appears, and the
 * button is disabled to block duplicate clicks.
 *
 * Usage:
 *   <LoadingButton busy={busy} busyLabel="Importing..." onClick={start}>
 *     Import Inventory
 *   </LoadingButton>
 */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
  /** Keep the width stable while the label changes, to avoid layout shift. */
  stableWidth?: boolean;
};

export function LoadingButton({
  busy = false,
  busyLabel = "Working...",
  children,
  stableWidth = false,
  className = "rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60",
  disabled,
  type = "button",
  ...rest
}: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  // Freeze the rendered width at the idle label's width so the button does not
  // jump around as the text changes between "Import Inventory" and "Importing...".
  useEffect(() => {
    if (!stableWidth || busy || !ref.current) return;
    setWidth(ref.current.offsetWidth);
  }, [stableWidth, busy, children]);

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed ${className}`}
      style={stableWidth && width ? { width, minWidth: width } : undefined}
    >
      {busy && <Spinner />}
      <span>{busy ? busyLabel : children}</span>
    </button>
  );
}