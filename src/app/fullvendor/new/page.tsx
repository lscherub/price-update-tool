"use client";
import { useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { apiErrorText } from "@/lib/apiError";
import { LoadingButton } from "@/components/LoadingButton";
import { useToast } from "@/components/Toast";
import { VendorCombobox } from "@/components/VendorCombobox";

type VendorProduct = {
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
};

type Step = "select-vendor" | "preview" | "paste" | "creating";

export default function FullVendorNewPage() {
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState<Step>("select-vendor");
  const [vendor, setVendor] = useState("");
  const [vendorProducts, setVendorProducts] = useState<VendorProduct[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [pastedData, setPastedData] = useState("");
  const [msg, setMsg] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const lastLoadedVendorRef = useRef<string>("");
  const lastLoadedProductsRef = useRef<Set<string>>(new Set());

  // --- Step 1: Select vendor and load products ---
  const loadVendorProducts = async () => {
    if (!vendor.trim()) { setMsg("Select or type a vendor first."); return; }
    setMsg("");
    setLoadingProducts(true);
    try {
      const r = await fetch(`/api/vendors/products?vendor=${encodeURIComponent(vendor.trim())}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(apiErrorText(d, "Could not load vendor products."));
        return;
      }
      if (!Array.isArray(d.rows) || d.rows.length === 0) {
        setMsg(`No inventory products found for "${vendor.trim()}". Import inventory first.`);
        return;
      }

      const rows: VendorProduct[] = d.rows;
      setVendorProducts(rows);

      const currentVendor = vendor.trim().toLowerCase();
      const isSameVendor = lastLoadedVendorRef.current.toLowerCase() === currentVendor;

      // Initialize / update selection
      setSelectedIds((prevSelected) => {
        if (!isSameVendor || prevSelected.size === 0) {
          // New vendor (or initial load): select all products by default
          return new Set(rows.map((p) => p.id));
        }
        // Refreshing same vendor: preserve selections for existing products,
        // and select newly discovered products by default
        const next = new Set<string>();
        const prevKnown = lastLoadedProductsRef.current;
        for (const p of rows) {
          if (prevKnown.has(p.id)) {
            if (prevSelected.has(p.id)) next.add(p.id);
          } else {
            next.add(p.id);
          }
        }
        return next;
      });

      lastLoadedVendorRef.current = vendor.trim();
      lastLoadedProductsRef.current = new Set(rows.map((p) => p.id));
      setStep("preview");
    } catch {
      setMsg("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoadingProducts(false);
    }
  };

  // --- Step 3: Create the full-vendor session ---
  const createSession = async () => {
    if (!pastedData.trim()) { setMsg("Paste vendor SKU/price data first."); return; }
    if (selectedIds.size === 0) {
      setMsg("Select at least one product to include in the worksheet.");
      return;
    }
    setMsg("");
    setStep("creating");
    try {
      const r = await fetch("/api/fullvendor/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor: vendor.trim(),
          pastedData,
          selectedProductIds: Array.from(selectedIds),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setStep("paste");
        const t = apiErrorText(d, "Could not create the Full Vendor Price Update.");
        setMsg(t);
        toast.error("Could not create the Full Vendor Price Update.", t);
        return;
      }
      const sid: string = d.sessionId;
      toast.success(
        "Full Vendor Price Update created.",
        `${d.total} products — ${d.matched} with new prices, ${d.unmatched} without${d.ambiguous ? `, ${d.ambiguous} ambiguous` : ""}.`,
      );
      router.push(`/sessions/${sid}`);
      router.refresh();
    } catch {
      setStep("paste");
      setMsg("Could not reach the server. Check your connection and try again.");
      toast.error("Could not reach the server.", "Check your connection and try again.");
    }
  };

  const totalCount = vendorProducts.length;
  const selectedCount = vendorProducts.filter((p) => selectedIds.has(p.id)).length;
  const activeCount = vendorProducts.filter((p) => !p.isInactive).length;
  const inactiveCount = vendorProducts.filter((p) => p.isInactive).length;

  const allSelected = totalCount > 0 && selectedCount === totalCount;
  const someSelected = selectedCount > 0 && selectedCount < totalCount;

  // Toggle single product selection
  const toggleProduct = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Select all products (entire vendor list, not just visible)
  const selectAll = () => {
    setSelectedIds(new Set(vendorProducts.map((p) => p.id)));
  };

  // Deselect all products
  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  // Filtered products for display (search + active/inactive status)
  const visibleProducts = useMemo(() => {
    let list = vendorProducts;
    if (statusFilter === "active") list = list.filter((p) => !p.isInactive);
    else if (statusFilter === "inactive") list = list.filter((p) => p.isInactive);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((p) =>
        p.sku.toLowerCase().includes(q) ||
        p.productNumber.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q)
      );
    }
    return list;
  }, [vendorProducts, statusFilter, searchQuery]);

  const busy = step === "creating" || loadingProducts;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Full Vendor Price Update</h1>
        <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-800">
          {step === "select-vendor" ? "Step 1 of 3"
            : step === "preview" ? "Step 2 of 3"
            : step === "paste" || step === "creating" ? "Step 3 of 3"
            : ""}
        </span>
      </div>

      {/* ---- Step 1: Select Vendor ---- */}
      {step === "select-vendor" && (
        <div className="flex flex-col gap-3 rounded-xl border bg-white p-4">
          <p className="text-sm text-slate-600">
            Select the vendor for this full price update. You can choose which vendor products to include
            in the next step.
          </p>
          <label className="flex flex-col gap-1 text-sm" htmlFor="fv-vendor-input">
            Vendor
            <VendorCombobox
              id="fv-vendor-input"
              value={vendor}
              onChange={(v) => {
                setVendor(v);
                setMsg("");
                if (v.trim().toLowerCase() !== lastLoadedVendorRef.current.toLowerCase()) {
                  setSelectedIds(new Set());
                  lastLoadedVendorRef.current = "";
                  lastLoadedProductsRef.current = new Set();
                }
              }}
              disabled={busy}
            />
          </label>
          {msg && <div className="text-sm text-red-700" role="alert">{msg}</div>}
          <div className="flex justify-end">
            <LoadingButton busy={loadingProducts} busyLabel="Loading products..." onClick={loadVendorProducts}>
              Preview Vendor Products →
            </LoadingButton>
          </div>
        </div>
      )}

      {/* ---- Step 2: Preview vendor inventory & select products ---- */}
      {step === "preview" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{vendor}</h2>
                <p className="text-sm text-slate-600">
                  <strong className="text-slate-900">
                    {selectedCount.toLocaleString()} of {totalCount.toLocaleString()} products selected
                  </strong>
                  {" — "}
                  <span className="text-emerald-700 font-medium">{activeCount.toLocaleString()} active</span>
                  {inactiveCount > 0 && (
                    <>, <span className="text-amber-700 font-medium">{inactiveCount.toLocaleString()} inactive</span></>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    setStep("select-vendor");
                    setVendorProducts([]);
                    setSelectedIds(new Set());
                    setSearchQuery("");
                    setStatusFilter("all");
                    lastLoadedVendorRef.current = "";
                    lastLoadedProductsRef.current = new Set();
                  }}
                >
                  ← Change Vendor
                </button>
                <button
                  type="button"
                  disabled={selectedCount === 0}
                  className="rounded bg-indigo-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
                  onClick={() => {
                    if (selectedCount === 0) {
                      setMsg("Select at least one product to proceed.");
                      return;
                    }
                    setStep("paste");
                  }}
                >
                  Proceed to Paste Prices →
                </button>
              </div>
            </div>

            {/* Filter and selection bar */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
                >
                  Select All ({totalCount.toLocaleString()})
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={deselectAll}
                  className="font-medium text-slate-600 hover:text-slate-800 hover:underline"
                >
                  Deselect All
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                  <button
                    type="button"
                    onClick={() => setStatusFilter("all")}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      statusFilter === "all" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    All ({totalCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("active")}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      statusFilter === "active" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Active ({activeCount})
                  </button>
                  {inactiveCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setStatusFilter("inactive")}
                      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                        statusFilter === "inactive" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Inactive ({inactiveCount})
                    </button>
                  )}
                </div>

                <input
                  type="text"
                  placeholder="Filter by SKU, description..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs focus:border-indigo-500 focus:outline-hidden"
                />
              </div>
            </div>
          </div>

          {msg && <div className="text-sm text-red-700" role="alert">{msg}</div>}

          {/* Table */}
          <div className="max-h-[28rem] overflow-auto rounded-xl border bg-white shadow-xs">
            <table className="w-full min-w-[700px] text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 font-semibold text-slate-700 shadow-xs">
                <tr className="text-left">
                  <th className="w-10 px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      checked={allSelected}
                      onChange={(e) => {
                        if (e.target.checked) selectAll();
                        else deselectAll();
                      }}
                      aria-label="Select all or deselect all products"
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </th>
                  <th className="px-2 py-2">SKU</th>
                  <th className="px-2 py-2">Product #</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2">Brand</th>
                  <th className="px-2 py-2 text-right">List Cost</th>
                  <th className="px-2 py-2 text-right">Price</th>
                  <th className="px-2 py-2">Size</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleProducts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400">
                      No products match your search or filter.
                    </td>
                  </tr>
                ) : (
                  visibleProducts.map((p) => {
                    const isSelected = selectedIds.has(p.id);
                    return (
                      <tr
                        key={p.id}
                        className={`transition-colors ${
                          !isSelected
                            ? "bg-slate-50/60 text-slate-400"
                            : p.isInactive
                            ? "bg-amber-50/60 hover:bg-amber-50"
                            : "hover:bg-slate-50/80"
                        }`}
                      >
                        <td className="w-10 px-3 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleProduct(p.id)}
                            aria-label={`Select product ${p.sku}`}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="px-2 py-1.5 font-mono font-medium">{p.sku}</td>
                        <td className="px-2 py-1.5">{p.productNumber}</td>
                        <td className="px-2 py-1.5">{p.description}</td>
                        <td className="px-2 py-1.5">{p.brand}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{p.listCost}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{p.price}</td>
                        <td className="px-2 py-1.5">{p.sizeDesc}</td>
                        <td className="px-2 py-1.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                              p.isInactive
                                ? "bg-amber-100 text-amber-800"
                                : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            {p.isInactive ? "Inactive" : "Active"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- Step 3: Paste vendor pricing ---- */}
      {(step === "paste" || step === "creating") && (
        <div className="flex flex-col gap-3 rounded-xl border bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Paste Vendor Pricing for {vendor}</h2>
            <button
              type="button"
              className="text-sm text-slate-500 underline"
              disabled={busy}
              onClick={() => setStep("preview")}
            >
              ← Back to Preview
            </button>
          </div>
          <p className="text-sm text-slate-600">
            Copy two columns directly from Excel (Raw Vendor SKU/Code and Vendor List Price) and paste below.
            Tab-separated, one product per line. SKUs will be cleaned and matched automatically.
          </p>
          <p className="text-sm text-slate-600">
            <strong>{selectedCount.toLocaleString()} selected vendor product{selectedCount === 1 ? "" : "s"}</strong> will appear in the worksheet.
            {selectedCount < totalCount && (
              <span className="text-slate-500"> ({totalCount - selectedCount} unselected product{totalCount - selectedCount === 1 ? "" : "s"} excluded).</span>
            )}
            {" "}Products without a matching price will be included with a blank Vendor List Price (New) —
            they will <em>not</em> receive a fabricated price.
          </p>

          <label className="flex flex-col gap-1 text-sm">
            Paste Vendor Data (Raw SKU + Price, tab-separated from Excel)
            <textarea
              className="min-h-48 rounded border px-3 py-2 font-mono text-xs disabled:opacity-60"
              value={pastedData}
              disabled={busy}
              onChange={(e) => { setPastedData(e.target.value); setMsg(""); }}
              placeholder={"0 58854 04522 7\t19.99\n624-917-74008-0\t24.50\nSKU123\t5.99"}
            />
          </label>

          {msg && <div className="text-sm text-red-700" role="alert">{msg}</div>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-sm disabled:opacity-60"
              disabled={busy}
              onClick={() => setStep("preview")}
            >
              Cancel
            </button>
            <LoadingButton
              busy={step === "creating"}
              busyLabel="Creating worksheet..."
              stableWidth
              onClick={createSession}
            >
              Create Full Vendor Price Update
            </LoadingButton>
          </div>
        </div>
      )}
    </div>
  );
}
