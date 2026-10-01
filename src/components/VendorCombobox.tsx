"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeVendor } from "@/lib/pricing";
import { Spinner } from "./LoadingButton";

type VendorOption = { vendor: string; count: number };

/**
 * Searchable vendor combobox for New Price Update.
 *
 * - Queries `/api/vendors/options` (server-side `ILIKE` against distinct
 *   Product.vendor), so the ~21,000 product rows never reach the browser.
 * - Debounced, abortable, keyboard navigable.
 * - Always allows manual entry: if nothing matches, the user is offered
 *   `Use "<typed>" anyway`, so a brand-new vendor can still be processed.
 * - A near-duplicate typed name resolves to the stored spelling, so a vendor
 *   is not duplicated by typing it slightly differently.
 */
export function VendorCombobox({
  value,
  onChange,
  placeholder = "Search or select vendor...",
  disabled = false,
  id,
}: {
  value: string;
  onChange: (vendor: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<VendorOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // Reset the visible query when the parent clears/changes the value.
  // Adjusting state during render (rather than in an effect) avoids an extra
  // render pass and React's set-state-in-effect warning.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setQuery(value);
  }

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/vendors/options?q=${encodeURIComponent(query.trim())}&limit=20`, {
          signal: controller.signal,
        });
        if (!r.ok) { setOptions([]); return; }
        const d = await r.json().catch(() => ({}));
        setOptions(Array.isArray(d.rows) ? d.rows : []);
        setHighlight(0);
      } catch {
        // Aborted or offline — keep the previous results.
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [query, open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const normalizedTyped = normalizeVendor(query);
  const exactMatch = useMemo(
    () => options.find((o) => normalizeVendor(o.vendor) === normalizedTyped),
    [options, normalizedTyped],
  );
  // Canonical spelling if the typed text matches an existing vendor loosely.
  const suggested = useMemo(() => {
    if (!query.trim()) return "";
    if (exactMatch) return exactMatch.vendor;
    const compact = normalizedTyped.replace(/[^a-z0-9]/g, "");
    if (!compact) return "";
    return options.find((o) => normalizeVendor(o.vendor).replace(/[^a-z0-9]/g, "") === compact)?.vendor ?? "";
  }, [exactMatch, normalizedTyped, options, query]);

  const commit = (vendor: string) => {
    onChange(vendor);
    setQuery(vendor);
    setOpen(false);
  };

  const showManualHint = query.trim().length > 0 && !exactMatch;

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2 rounded border bg-white px-3 py-2 focus-within:ring-2 focus-within:ring-slate-900">
        <input
          id={id}
          className="w-full min-w-0 bg-transparent text-sm outline-none disabled:opacity-60"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls="vendor-listbox"
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { setOpen(true); setHighlight((h) => Math.min(h + 1, options.length - 1)); }
            else if (e.key === "ArrowUp") { setHighlight((h) => Math.max(h - 1, 0)); }
            else if (e.key === "Enter" && open && options[highlight]) {
              e.preventDefault();
              commit(options[highlight].vendor);
            } else if (e.key === "Escape") { setOpen(false); }
            else if (e.key === "Tab") { setOpen(false); onChange(query.trim()); }
          }}
        />
        {loading && <Spinner className="shrink-0 text-slate-400" />}
        <button
          type="button"
          tabIndex={-1}
          aria-label="Toggle vendor suggestions"
          disabled={disabled}
          className="shrink-0 text-xs text-slate-400"
          onClick={() => setOpen((o) => !o)}
        >
          ▼
        </button>
      </div>

      {open && (
        <div
          id="vendor-listbox"
          role="listbox"
          className="absolute z-40 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-white shadow-lg"
        >
          {options.length === 0 && !loading && (
            <div className="px-3 py-2 text-sm text-slate-500">
              {query.trim() ? "No existing vendor found." : "Type to search vendors."}
            </div>
          )}
          {options.map((o, i) => (
            <button
              key={o.vendor}
              type="button"
              role="option"
              aria-selected={i === highlight}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                i === highlight ? "bg-slate-100" : "hover:bg-slate-50"
              }`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => commit(o.vendor)}
            >
              <span className="truncate">{o.vendor}</span>
              {o.count > 0 && <span className="shrink-0 text-xs text-slate-400">{o.count.toLocaleString()} products</span>}
            </button>
          ))}

          {showManualHint && (
            <div className="border-t bg-slate-50 p-2">
              {suggested && (
                <button
                  type="button"
                  className="mb-1 block w-full rounded px-2 py-1.5 text-left text-xs text-blue-700 hover:bg-blue-50"
                  onClick={() => commit(suggested)}
                >
                  Use existing vendor &ldquo;{suggested}&rdquo;
                </button>
              )}
              <button
                type="button"
                className="block w-full rounded px-2 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => commit(query.trim())}
              >
                Use &ldquo;{query.trim()}&rdquo; anyway (new vendor)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
