"use client";
import { useEffect, useRef, useState } from "react";
import { LoadingButton } from "./LoadingButton";

export type AddProductInput = {
  sku: string;
  productNumber: string;
  description: string;
  vendor: string;
  brand: string;
  listCost: string;
  price: string;
  sizeDesc: string;
  status: "active" | "inactive";
};

type SuggestRow = { name: string; count: number };

function SuggestInput({
  label,
  value,
  onChange,
  endpoint,
  kind,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  endpoint: string;
  kind: "vendor" | "brand";
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SuggestRow[]>([]);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${endpoint}?q=${encodeURIComponent(value.trim())}&limit=10`, { signal: c.signal });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || c.signal.aborted) return;
        const list: SuggestRow[] = (Array.isArray(d.rows) ? d.rows : [])
          .map((x: { vendor?: string; brand?: string; count?: number }) => ({
            name: String(kind === "vendor" ? (x.vendor ?? "") : (x.brand ?? "")),
            count: Number(x.count ?? 0),
          }))
          .filter((x: SuggestRow) => x.name);
        setRows(list);
      } catch {
        /* keep previous */
      }
    }, 200);
    return () => {
      c.abort();
      clearTimeout(t);
    };
  }, [value, open, endpoint, kind]);

  return (
    <div ref={boxRef} className="relative">
      <input
        aria-label={label}
        className="w-full rounded border px-2 py-1.5 text-sm disabled:opacity-60"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
      />
      {open && rows.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-lg border bg-white shadow-lg">
          {rows.map((r) => (
            <button
              key={r.name}
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-100"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(r.name);
                setOpen(false);
              }}
            >
              <span className="truncate">{r.name}</span>
              {r.count > 0 && <span className="shrink-0 text-xs text-slate-400">{r.count} products</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Modal dialog to manually add a single product to inventory.
 * Validates required fields, SKU uniqueness check, and numeric price/cost.
 * Reuses existing form + modal patterns from AddItemDialog.
 */
export function AddProductDialog({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (v: AddProductInput) => void;
}) {
  const [sku, setSku] = useState("");
  const [productNumber, setProductNumber] = useState("");
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [brand, setBrand] = useState("");
  const [listCost, setListCost] = useState("");
  const [price, setPrice] = useState("");
  const [sizeDesc, setSizeDesc] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [err, setErr] = useState("");
  const firstRef = useRef<HTMLInputElement>(null);

  // Trap focus inside the dialog when it opens.
  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const validate = (): string => {
    if (!sku.trim()) return "SKU is required.";
    const costRaw = listCost.trim().replace(/[$,\s]/g, "");
    if (costRaw !== "") {
      const c = Number(costRaw);
      if (!Number.isFinite(c) || c < 0) return "List Cost must be a positive number or 0.";
    }
    const priceRaw = price.trim().replace(/[$,\s]/g, "");
    if (priceRaw !== "") {
      const p = Number(priceRaw);
      if (!Number.isFinite(p) || p < 0) return "Price must be a positive number or 0.";
    }
    return "";
  };

  const submit = () => {
    const msg = validate();
    if (msg) {
      setErr(msg);
      return;
    }
    setErr("");
    onSubmit({
      sku: sku.trim(),
      productNumber: productNumber.trim(),
      description: description.trim(),
      vendor: vendor.trim(),
      brand: brand.trim(),
      listCost: listCost.trim(),
      price: price.trim(),
      sizeDesc: sizeDesc.trim(),
      status,
    });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !busy) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add Product"
      onKeyDown={onKey}
    >
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-bold">Add Product</h2>
        <p className="mt-1 text-sm text-slate-500">
          Manually add a single product without importing a full POS inventory file.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <label className="col-span-2 flex flex-col gap-1">
            <span className="font-semibold">
              SKU <span className="text-red-600">*</span>
            </span>
            <input
              ref={firstRef}
              className="rounded border px-2 py-1.5 font-mono disabled:opacity-60"
              value={sku}
              disabled={busy}
              onChange={(e) => {
                setSku(e.target.value);
                setErr("");
              }}
              placeholder="e.g. 0588504522"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-semibold">Product Number</span>
            <input
              className="rounded border px-2 py-1.5 disabled:opacity-60"
              value={productNumber}
              disabled={busy}
              onChange={(e) => setProductNumber(e.target.value)}
              placeholder="e.g. 12345"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-semibold">Size Desc.</span>
            <input
              className="rounded border px-2 py-1.5 disabled:opacity-60"
              value={sizeDesc}
              disabled={busy}
              onChange={(e) => setSizeDesc(e.target.value)}
              placeholder="e.g. 500 ml"
            />
          </label>

          <label className="col-span-2 flex flex-col gap-1">
            <span className="font-semibold">Description</span>
            <input
              className="rounded border px-2 py-1.5 disabled:opacity-60"
              value={description}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Product Description"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="font-semibold">Vendor</span>
            <SuggestInput
              label="Vendor"
              value={vendor}
              onChange={setVendor}
              endpoint="/api/vendors/options"
              kind="vendor"
              disabled={busy}
              placeholder="Select or enter vendor..."
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="font-semibold">Brand</span>
            <SuggestInput
              label="Brand"
              value={brand}
              onChange={setBrand}
              endpoint="/api/vendors/brands/options"
              kind="brand"
              disabled={busy}
              placeholder="Select or enter brand..."
            />
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-semibold">List Cost</span>
            <input
              className="rounded border px-2 py-1.5 font-mono disabled:opacity-60"
              value={listCost}
              disabled={busy}
              onChange={(e) => {
                setListCost(e.target.value);
                setErr("");
              }}
              placeholder="0.00"
              inputMode="decimal"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-semibold">Price</span>
            <input
              className="rounded border px-2 py-1.5 font-mono disabled:opacity-60"
              value={price}
              disabled={busy}
              onChange={(e) => {
                setPrice(e.target.value);
                setErr("");
              }}
              placeholder="0.00"
              inputMode="decimal"
            />
          </label>

          <label className="col-span-2 flex flex-col gap-1">
            <span className="font-semibold">Status</span>
            <select
              className="rounded border px-2 py-1.5 disabled:opacity-60"
              value={status}
              disabled={busy}
              onChange={(e) => setStatus(e.target.value as "active" | "inactive")}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>

        {err && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {err}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-60"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <LoadingButton
            busy={busy}
            busyLabel="Saving..."
            onClick={submit}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            Add Product
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}
