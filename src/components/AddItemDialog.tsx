"use client";

import { useState } from "react";
import { LoadingButton } from "./LoadingButton";

export type NewItemInput = {
  rawVendorSku: string;
  cleanedSku: string;
  discount: string;
  vendorListPriceNew: string;
  marginDivisor: string;
  notes: string;
};

const EMPTY: NewItemInput = {
  rawVendorSku: "", cleanedSku: "", discount: "", vendorListPriceNew: "", marginDivisor: "", notes: "",
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
export function AddItemDialog({ busy, onClose, onSubmit }: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (v: NewItemInput) => void;
}) {
  const [v, setV] = useState<NewItemInput>(EMPTY);
  const set = (k: keyof NewItemInput, value: string) => setV((prev) => ({ ...prev, [k]: value }));

  const hasId = v.rawVendorSku.trim() !== "" || v.cleanedSku.trim() !== "";
  const disc = v.discount.trim();
  const discBad = disc !== "" && (Number.isNaN(Number(disc.replace(/[%$,]/g, ""))) || Number(disc.replace(/[%$,]/g, "")) < 0 || Number(disc.replace(/[%$,]/g, "")) > 100);
  const canSubmit = hasId && !discBad && !busy;

  const field = (
    key: keyof NewItemInput,
    label: string,
    hint: string,
  ) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input
        className="rounded border px-3 py-1.5"
        value={v[key]}
        placeholder={hint}
        aria-label={label}
        onChange={(e) => set(key, e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) onSubmit(v); }}
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Add product row">
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-bold">Add Product</h2>
        <p className="mt-1 text-sm text-slate-600">
          Enter <span className="font-semibold">either</span> a Raw Vendor SKU/Code <span className="font-semibold">or</span> a Cleaned SKU — you don&apos;t need both.
          The remaining product details are filled in by the existing SKU matching logic. If the SKU is not in inventory the row keeps the usual{" "}
          <span className="font-semibold text-red-700">Not Found</span> flag.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("rawVendorSku", "Raw Vendor SKU/Code", "e.g. 0588-12345A")}
          {field("cleanedSku", "Cleaned SKU", "e.g. 058812345")}
          {field("discount", "Discount (%)", "optional, 0-100")}
          {field("vendorListPriceNew", "Vendor List Price (New)", "optional")}
          {field("marginDivisor", "Margin/Divisor", "optional, default 0.605")}
        </div>
        <div className="mt-3">
          {field("notes", "Notes", "optional")}
        </div>
        {discBad && <p className="mt-2 text-sm text-red-600">Discount must be 0-100.</p>}
        {!hasId && <p className="mt-2 text-sm text-slate-500">Enter a Raw Vendor SKU/Code or a Cleaned SKU to continue.</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5 text-sm disabled:opacity-60" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <LoadingButton
            busy={busy}
            busyLabel="Adding..."
            disabled={!canSubmit}
            onClick={() => onSubmit(v)}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Add Row
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}
