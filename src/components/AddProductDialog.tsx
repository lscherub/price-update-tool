"use client";
import { useEffect, useRef, useState } from "react";
import { LoadingButton, Spinner } from "./LoadingButton";

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
  /** Present only when "This product has an old SKU" is checked. */
  previousSku?: string;
};

type SuggestRow = { name: string; count: number };

type LookedUpPreviousProduct = {
  id: string;
  sku: string;
  productNumber: string;
  description: string;
  vendor: string;
  brand: string;
  listCost: string;
  price: string;
  sizeDesc: string;
  isInactive: boolean;
  isOldSku: boolean;
  supersededByProductId: string | null;
  supersededBySku: string | null;
  supersededByDescription: string | null;
};

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
        className="w-full rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 text-sm text-slate-900 dark:text-zinc-100 disabled:opacity-60"
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
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg">
          {rows.map((r) => (
            <button
              key={r.name}
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-slate-800 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700"
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
 * Supports optional Old-to-New SKU replacement linking: when "This product has an old SKU"
 * is checked, looks up the exact Previous SKU (preserving leading zeros), pre-fills all
 * copyable product fields for optional editing, and creates the linked replacement atomically.
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

  // Optional Old SKU replacement state
  const [hasOldSku, setHasOldSku] = useState(false);
  const [previousSkuInput, setPreviousSkuInput] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [matchedOld, setMatchedOld] = useState<LookedUpPreviousProduct | null>(null);

  const firstRef = useRef<HTMLInputElement>(null);

  // Trap focus inside the dialog when it opens.
  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const lookupPreviousSku = async () => {
    const querySku = previousSkuInput.trim();
    setLookupError("");
    setErr("");
    if (!querySku) {
      setMatchedOld(null);
      setLookupError("Enter a Previous SKU to look up.");
      return;
    }
    setLookupBusy(true);
    try {
      const r = await fetch(`/api/inventory/product?sku=${encodeURIComponent(querySku)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMatchedOld(null);
        setLookupError(typeof d.error === "string" ? d.error : "Could not look up that SKU.");
        return;
      }
      if (!d.found || !d.product) {
        setMatchedOld(null);
        setLookupError(`Previous SKU "${querySku}" was not found in All Inventory.`);
        return;
      }
      const found = d.product as LookedUpPreviousProduct;
      setMatchedOld(found);
      // Populate all copyable fields from the existing product (NEVER copying Previous SKU into New SKU).
      setProductNumber(found.productNumber ?? "");
      setDescription(found.description ?? "");
      setVendor(found.vendor ?? "");
      setBrand(found.brand ?? "");
      setListCost(found.listCost ?? "");
      setPrice(found.price ?? "");
      setSizeDesc(found.sizeDesc ?? "");
      setStatus(found.isInactive ? "inactive" : "active");
    } catch {
      setMatchedOld(null);
      setLookupError("Could not reach the server while looking up the Previous SKU.");
    } finally {
      setLookupBusy(false);
    }
  };

  const validate = (): string => {
    const newSku = sku.trim();
    if (!newSku) return "SKU is required.";
    if (hasOldSku) {
      const prevSku = previousSkuInput.trim();
      if (!prevSku) return "Previous SKU is required when 'This product has an old SKU' is checked.";
      if (prevSku === newSku) return "Previous SKU cannot be the same as the new SKU.";
      if (!matchedOld || matchedOld.sku !== prevSku) {
        return "Look up and confirm the Previous SKU before adding the replacement product.";
      }
      if (matchedOld.supersededByProductId && matchedOld.supersededBySku) {
        return `SKU "${matchedOld.sku}" is already linked to replacement SKU "${matchedOld.supersededBySku}". Resolve the existing relationship first.`;
      }
    }
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
      ...(hasOldSku ? { previousSku: previousSkuInput.trim() } : {}),
    });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !busy) onClose();
  };

  const hasConflict = Boolean(matchedOld?.supersededByProductId && matchedOld?.supersededBySku);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add Product"
      onKeyDown={onKey}
    >
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-2xl text-slate-900 dark:text-zinc-100">
        <h2 className="text-lg font-bold">Add Product</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
          Manually add a single product without importing a full POS inventory file.
        </p>

        {/* Optional Old SKU Replacement Toggle */}
        <div className="mt-3 rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50/70 dark:bg-zinc-800/60 p-3 text-xs">
          <label className="flex cursor-pointer items-center gap-2 font-semibold text-slate-800 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={hasOldSku}
              disabled={busy}
              onChange={(e) => {
                const checked = e.target.checked;
                setHasOldSku(checked);
                setErr("");
                if (!checked) {
                  setPreviousSkuInput("");
                  setLookupError("");
                  setMatchedOld(null);
                }
              }}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>This product has an old SKU</span>
          </label>

          {hasOldSku && (
            <div className="mt-2.5 flex flex-col gap-2">
              <div className="flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="font-semibold text-slate-700 dark:text-zinc-300">
                    Previous SKU <span className="text-red-600">*</span>
                  </span>
                  <input
                    type="text"
                    className="h-8 rounded border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 font-mono text-xs text-slate-900 dark:text-zinc-100 disabled:opacity-60"
                    value={previousSkuInput}
                    disabled={busy || lookupBusy}
                    onChange={(e) => {
                      setPreviousSkuInput(e.target.value);
                      setLookupError("");
                      setErr("");
                      if (matchedOld && e.target.value.trim() !== matchedOld.sku) {
                        setMatchedOld(null);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void lookupPreviousSku();
                      }
                    }}
                    placeholder="e.g. 73373905102 (leading zeros preserved)"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || lookupBusy || !previousSkuInput.trim()}
                  onClick={() => void lookupPreviousSku()}
                  className="inline-flex h-8 items-center gap-1.5 rounded bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {lookupBusy && <Spinner />}
                  <span>Look Up</span>
                </button>
              </div>

              {lookupError && (
                <div className="rounded border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-2.5 py-1.5 text-red-700 dark:text-red-300">
                  {lookupError}
                </div>
              )}

              {matchedOld && !hasConflict && (
                <div className="rounded border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/80 dark:bg-emerald-950/30 px-2.5 py-2 text-emerald-900 dark:text-emerald-200">
                  <div className="font-semibold">
                    Found: <span className="font-mono">{matchedOld.sku}</span> — {matchedOld.description || "(No description)"}
                  </div>
                  <div className="mt-0.5 text-[11px] opacity-85">
                    Fields below have been populated from this product. Edit any fields that changed and enter the new SKU. The original record will remain untouched except for being marked as Old SKU upon creation.
                  </div>
                </div>
              )}

              {matchedOld && hasConflict && (
                <div className="rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-2 text-amber-950 dark:text-amber-200">
                  <div className="font-bold">Existing Replacement Conflict</div>
                  <div className="mt-0.5">
                    SKU <span className="font-mono font-semibold">{matchedOld.sku}</span> is already linked to replacement SKU{" "}
                    <span className="font-mono font-semibold">{matchedOld.supersededBySku}</span>
                    {matchedOld.supersededByDescription ? ` (${matchedOld.supersededByDescription})` : ""}.
                    Resolve the existing link before assigning another replacement.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <label className="col-span-2 flex flex-col gap-1">
            <span className="font-semibold">
              {hasOldSku ? "New SKU" : "SKU"} <span className="text-red-600">*</span>
            </span>
            <input
              ref={firstRef}
              className="rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 font-mono text-slate-900 dark:text-zinc-100 disabled:opacity-60"
              value={sku}
              disabled={busy}
              onChange={(e) => {
                setSku(e.target.value);
                setErr("");
              }}
              placeholder={hasOldSku ? "Enter the new replacement SKU (e.g. 73373985102)" : "e.g. 0588504522"}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-semibold">Product Number</span>
            <input
              className="rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 text-slate-900 dark:text-zinc-100 disabled:opacity-60"
              value={productNumber}
              disabled={busy}
              onChange={(e) => setProductNumber(e.target.value)}
              placeholder="e.g. 12345"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-semibold">Size Desc.</span>
            <input
              className="rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 text-slate-900 dark:text-zinc-100 disabled:opacity-60"
              value={sizeDesc}
              disabled={busy}
              onChange={(e) => setSizeDesc(e.target.value)}
              placeholder="e.g. 500 ml"
            />
          </label>

          <label className="col-span-2 flex flex-col gap-1">
            <span className="font-semibold">Description</span>
            <input
              className="rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 text-slate-900 dark:text-zinc-100 disabled:opacity-60"
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
              className="rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 font-mono text-slate-900 dark:text-zinc-100 disabled:opacity-60"
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
              className="rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 font-mono text-slate-900 dark:text-zinc-100 disabled:opacity-60"
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
              className="rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 text-slate-900 dark:text-zinc-100 disabled:opacity-60"
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
          <div className="mt-3 rounded border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {err}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-slate-200 dark:border-zinc-700 px-3 py-1.5 text-sm text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-60"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <LoadingButton
            busy={busy}
            busyLabel="Saving..."
            disabled={hasConflict}
            onClick={submit}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            Add Product
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}
