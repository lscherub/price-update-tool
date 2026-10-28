"use client";
import { useState } from "react";
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
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [pastedData, setPastedData] = useState("");
  const [msg, setMsg] = useState("");

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
      setVendorProducts(d.rows);
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
    setMsg("");
    setStep("creating");
    try {
      const r = await fetch("/api/fullvendor/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor: vendor.trim(), pastedData }),
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

  const activeCount = vendorProducts.filter((p) => !p.isInactive).length;
  const inactiveCount = vendorProducts.filter((p) => p.isInactive).length;
  const busy = step === "creating" || loadingProducts;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
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
            Select the vendor for this full price update. All products currently in inventory for that
            vendor will be included — active <em>and</em> inactive.
          </p>
          <label className="flex flex-col gap-1 text-sm" htmlFor="fv-vendor-input">
            Vendor
            <VendorCombobox
              id="fv-vendor-input"
              value={vendor}
              onChange={(v) => { setVendor(v); setMsg(""); }}
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

      {/* ---- Step 2: Preview vendor inventory ---- */}
      {step === "preview" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">{vendor}</h2>
                <p className="text-sm text-slate-500">
                  {vendorProducts.length} products in inventory
                  {" — "}
                  <span className="text-emerald-700">{activeCount} active</span>
                  {inactiveCount > 0 && (
                    <>, <span className="text-amber-700">{inactiveCount} inactive</span></>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded border px-3 py-1.5 text-sm text-slate-600"
                  onClick={() => { setStep("select-vendor"); setVendorProducts([]); }}
                >
                  ← Change Vendor
                </button>
                <button
                  type="button"
                  className="rounded bg-indigo-700 px-3 py-1.5 text-sm font-semibold text-white"
                  onClick={() => setStep("paste")}
                >
                  Proceed to Paste Prices →
                </button>
              </div>
            </div>
          </div>

          <div className="max-h-96 overflow-auto rounded-xl border bg-white">
            <table className="w-full min-w-[700px] text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="text-left">
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
              <tbody>
                {vendorProducts.map((p) => (
                  <tr key={p.id} className={`border-t ${p.isInactive ? "bg-amber-50 opacity-70" : ""}`}>
                    <td className="px-2 py-1 font-mono">{p.sku}</td>
                    <td className="px-2 py-1">{p.productNumber}</td>
                    <td className="px-2 py-1">{p.description}</td>
                    <td className="px-2 py-1">{p.brand}</td>
                    <td className="px-2 py-1 text-right font-mono">{p.listCost}</td>
                    <td className="px-2 py-1 text-right font-mono">{p.price}</td>
                    <td className="px-2 py-1">{p.sizeDesc}</td>
                    <td className="px-2 py-1">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        p.isInactive
                          ? "bg-amber-100 text-amber-800"
                          : "bg-emerald-100 text-emerald-800"
                      }`}>
                        {p.isInactive ? "Inactive" : "Active"}
                      </span>
                    </td>
                  </tr>
                ))}
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
            <strong>All {vendorProducts.length} vendor products</strong> will appear in the worksheet.
            Products without a matching price will be included with a blank Vendor List Price (New) —
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

