"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingButton } from "./LoadingButton";
import {
  buildDiscountMaps,
  calculateUnitFromBox,
  discountSourceLabel,
  resolveDiscountWithSource,
  validateBoxInputs,
} from "@/lib/calculator";
import type { DiscountSource } from "@/lib/calculator";
import { DEFAULT_DIVISOR, normalizeSku } from "@/lib/pricing";

export type NewItemInput = {
  rawVendorSku: string;
  cleanedSku: string;
  discount: string;
  vendorListPriceNew: string;
  marginDivisor: string;
  notes: string;
};

export type BoxPreview = {
  perUnitList: string;
  discount: string;
  source: DiscountSource;
  netCost: string;
  retailExact: string;
  retail: string;
};

const EMPTY: NewItemInput = {
  rawVendorSku: "", cleanedSku: "", discount: "", vendorListPriceNew: "", marginDivisor: "", notes: "",
};

type ProductHit = {
  sku: string;
  productNumber: string;
  description: string;
  vendor: string;
  brand: string;
};

/**
 * "Add Row" form for an existing price update.
 *
 * The user may identify the product with a Raw Vendor SKU/Code OR a Cleaned SKU
 * — both are optional individually, but at least one is required. Whatever they
 * leave blank is populated by the existing SKU cleaning / inventory matching
 * logic on the server. Discount, Vendor List Price (New), Margin/Divisor and
 * Notes are the same optional inputs an imported row already offers (they can
 * also be edited inline afterwards).
 */
export function AddItemDialog({ busy, onClose, onSubmit, existingSkus }: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (v: NewItemInput) => void;
  existingSkus?: string[];
}) {
  const [v, setV] = useState<NewItemInput>(EMPTY);
  const set = (k: keyof NewItemInput, value: string) => setV((prev) => ({ ...prev, [k]: value }));

  const hasId = v.rawVendorSku.trim() !== "" || v.cleanedSku.trim() !== "";
  const disc = v.discount.trim();
  const discBad = disc !== "" && (Number.isNaN(Number(disc.replace(/[%$,]/g, ""))) || Number(disc.replace(/[%$,]/g, "")) < 0 || Number(disc.replace(/[%$,]/g, "")) > 100);

  // ---- Box/case mode ----
  const [boxMode, setBoxMode] = useState(false);
  const [qtyPerBox, setQtyPerBox] = useState("");
  const [boxPrice, setBoxPrice] = useState("");
  const [boxVendor, setBoxVendor] = useState("");
  const [boxBrand, setBoxBrand] = useState("");
  const [maps, setMaps] = useState<{ vendors: Map<string, string>; brands: Map<string, string> } | null>(null);
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [hitsOpen, setHitsOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!boxMode || maps) return;
    fetch("/api/calculator/discounts")
      .then((r) => r.json().catch(() => ({})))
      .then((d) => {
        if (Array.isArray(d.vendors))
          setMaps(
            buildDiscountMaps(
              d.vendors.map((x: { vendor: string; discount: string }) => ({ vendor: x.vendor, discount: x.discount })),
              (Array.isArray(d.brands) ? d.brands : []).map((x: { vendor: string; brand: string; discount: string }) => ({
                vendor: x.vendor,
                brand: x.brand,
                discount: x.discount,
              })),
            ),
          );
      })
      .catch(() => {});
  }, [boxMode, maps]);

  useEffect(() => {
    if (!boxMode) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setHitsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [boxMode]);

  useEffect(() => {
    if (!boxMode) return;
    const q = (v.rawVendorSku || v.cleanedSku).trim();
    const c = new AbortController();
    const t = setTimeout(async () => {
      // All setState happens in the debounced fetch callback, never
      // synchronously in the effect body.
      if (q.length < 2) {
        setHits([]);
        return;
      }
      try {
        const r = await fetch(`/api/calculator/products?q=${encodeURIComponent(q)}&limit=8`, { signal: c.signal });
        const d = await r.json().catch(() => ({}));
        if (r.ok && !c.signal.aborted) setHits(Array.isArray(d.rows) ? d.rows : []);
      } catch {
        /* aborted */
      }
    }, 300);
    return () => {
      c.abort();
      clearTimeout(t);
    };
  }, [boxMode, v.rawVendorSku, v.cleanedSku]);

  const resolved = useMemo(() => {
    if (!boxMode || !maps) return null;
    const vendor = boxVendor.trim() || undefined;
    const brand = boxBrand.trim() || undefined;
    const r = resolveDiscountWithSource(maps.vendors, maps.brands, vendor, brand);
    const manual = disc !== "";
    return { vendor: vendor ?? "", brand: brand ?? "", discount: manual ? disc.replace(/[%$,]/g, "").trim() : r.discount, source: (manual ? "manual" : r.source) as DiscountSource };
  }, [boxMode, maps, boxVendor, boxBrand, disc]);

  const boxErr = boxMode ? validateBoxInputs(boxPrice, qtyPerBox) : null;
  const preview: BoxPreview | null = useMemo(() => {
    if (!boxMode || boxErr || !resolved) return null;
    const r = calculateUnitFromBox({
      boxPrice,
      qtyPerBox,
      discountPct: resolved.discount,
      divisor: v.marginDivisor.trim() || DEFAULT_DIVISOR,
    });
    if (r.perUnitList === null || r.netCost === null || r.retailRounded === null || !r.retailExact) return null;
    return {
      perUnitList: r.perUnitList,
      discount: resolved.discount,
      source: resolved.source,
      netCost: r.netCost,
      retailExact: r.retailExact,
      retail: r.retailRounded,
    };
  }, [boxMode, boxErr, resolved, boxPrice, qtyPerBox, v.marginDivisor]);

  function pickHit(h: ProductHit) {
    if (!v.cleanedSku.trim()) set("cleanedSku", h.sku);
    if (!boxVendor.trim()) setBoxVendor(h.vendor);
    if (!boxBrand.trim()) setBoxBrand(h.brand);
    setHitsOpen(false);
  }

  function submit() {
    if (!boxMode || !preview) {
      onSubmit(v);
      return;
    }
    onSubmit({
      ...v,
      vendorListPriceNew: preview.perUnitList,
      discount: preview.discount,
    });
  }

  const canSubmit = hasId && !discBad && !busy && (!boxMode || !!preview);

  const normSkus = useMemo(() => {
    return new Set((existingSkus ?? []).map((s) => normalizeSku(s)).filter(Boolean));
  }, [existingSkus]);
  const duplicate = useMemo(() => {
    if (!hasId || normSkus.size === 0) return false;
    const cands = [v.rawVendorSku, v.cleanedSku].map((s) => normalizeSku(s)).filter(Boolean);
    return cands.some((c) => normSkus.has(c));
  }, [hasId, normSkus, v.rawVendorSku, v.cleanedSku]);

  const field = (
    key: keyof NewItemInput,
    label: string,
    hint: string,
  ) => (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-slate-700 dark:text-zinc-300">{label}</span>
      <input
        className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs text-slate-900 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-500 focus:border-indigo-500 focus:outline-none transition-colors"
        value={v[key]}
        placeholder={hint}
        aria-label={label}
        onChange={(e) => set(key, e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) submit(); }}
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs" role="dialog" aria-modal="true" aria-label="Add product row">
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-5 shadow-2xl text-slate-900 dark:text-zinc-100">
        <h2 className="text-lg font-bold">Add Product</h2>
        <p className="mt-1 text-xs text-slate-600 dark:text-zinc-400">
          Enter <span className="font-semibold">either</span> a Raw Vendor SKU/Code <span className="font-semibold">or</span> a Cleaned SKU — you don&apos;t need both.
          The remaining product details are filled in by the existing SKU matching logic. If the SKU is not in inventory the row keeps the usual{" "}
          <span className="font-semibold text-red-700 dark:text-red-400">Not Found</span> flag.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("rawVendorSku", "Raw Vendor SKU/Code", "e.g. 0588-12345A")}
          {field("cleanedSku", "Cleaned SKU", "e.g. 058812345")}
          {field("discount", "Discount (%)", "optional, 0-100")}
          {field("vendorListPriceNew", "Vendor List Price (New)", "optional")}
          {field("marginDivisor", "Margin/Divisor", "optional, default 0.605")}
        </div>
        <div className="mt-3 flex flex-col gap-1 text-xs">
          <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={boxMode}
              onChange={(e) => setBoxMode(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600"
            />
            <span className="font-medium">Calculate price from a box/case</span>
          </label>
          <span className="text-xs text-slate-500 dark:text-zinc-400">
            For one sellable unit: box price is divided by quantity first, then
            the saved vendor/brand discount and worksheet nearest-9 apply.
          </span>
        </div>
        <div className="mt-3">
          {field("notes", "Notes", "optional")}
        </div>
        {boxMode ? (
          <div ref={boxRef} className="mt-3 rounded-lg border bg-slate-50 p-3">
            <p className="text-sm font-semibold">Box/case → single unit</p>
            {hits.length > 0 ? (
              <div className="mt-2">
                <button
                  type="button"
                  className="text-xs text-blue-700 underline"
                  onClick={() => setHitsOpen((o) => !o)}
                >
                  {hitsOpen ? "Hide" : "Show"} matching products ({hits.length})
                </button>
                {hitsOpen ? (
                  <ul className="mt-1 max-h-32 overflow-auto rounded border bg-white text-xs">
                    {hits.map((h) => (
                      <li key={h.sku}>
                        <button
                          type="button"
                          className="block w-full px-2 py-1 text-left hover:bg-slate-100"
                          onClick={() => pickHit(h)}
                        >
                          <span className="font-semibold">{h.sku}</span>
                          {" — "}
                          {h.description || h.productNumber} ({h.vendor}
                          {h.brand ? ` / ${h.brand}` : ""})
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Quantity per box/case</span>
                <input
                  className="rounded border px-3 py-1.5"
                  value={qtyPerBox}
                  inputMode="numeric"
                  placeholder="e.g. 24"
                  aria-label="Quantity per box/case"
                  onChange={(e) => setQtyPerBox(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Vendor list price per box/case</span>
                <input
                  className="rounded border px-3 py-1.5"
                  value={boxPrice}
                  inputMode="decimal"
                  placeholder="e.g. 24.00"
                  aria-label="Vendor list price per box/case"
                  onChange={(e) => setBoxPrice(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Vendor (for discount)</span>
                <input
                  className="rounded border px-3 py-1.5"
                  value={boxVendor}
                  placeholder="From matched product or type it"
                  aria-label="Vendor (for discount)"
                  onChange={(e) => setBoxVendor(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Brand (for discount)</span>
                <input
                  className="rounded border px-3 py-1.5"
                  value={boxBrand}
                  placeholder="From matched product or type it"
                  aria-label="Brand (for discount)"
                  onChange={(e) => setBoxBrand(e.target.value)}
                />
              </label>
            </div>
            {boxErr ? (
              <p className="mt-2 text-sm text-amber-700">{boxErr}</p>
            ) : preview ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-slate-600">Per-unit list (before discount)</dt>
                <dd className="text-right font-semibold">${preview.perUnitList}</dd>
                <dt className="text-slate-600">Discount</dt>
                <dd className="text-right font-semibold">
                  {preview.discount}% ({discountSourceLabel(preview.source)})
                </dd>
                <dt className="text-slate-600">Net cost (per unit)</dt>
                <dd className="text-right font-semibold">${preview.netCost}</dd>
                <dt className="text-slate-600">Suggested retail (nearest-9)</dt>
                <dd className="text-right font-bold text-emerald-700">${preview.retail}</dd>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                Enter the quantity and box price to preview the per-unit calculation.
              </p>
            )}
          </div>
        ) : null}
        {discBad && <p className="mt-2 text-sm text-red-600">Discount must be 0-100.</p>}
        {!hasId && <p className="mt-2 text-sm text-slate-500">Enter a Raw Vendor SKU/Code or a Cleaned SKU to continue.</p>}
        {duplicate ? (
          <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-sm text-amber-800">
            This SKU is already on this price update. Adding it again will create a second row.
          </p>
        ) : null}
        {boxMode && hasId && !preview ? (
          <p className="mt-2 text-sm text-slate-500">Complete the box/case fields to enable Add Row.</p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded-lg border border-slate-200 dark:border-zinc-700 px-3.5 py-1.5 text-xs font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-60 transition-colors" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <LoadingButton
            busy={busy}
            busyLabel="Adding..."
            disabled={!canSubmit}
            onClick={() => submit()}
            className="rounded-lg bg-emerald-600 dark:bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 dark:hover:bg-emerald-600 disabled:opacity-50 transition-colors shadow-xs"
          >
            Add Row
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}
