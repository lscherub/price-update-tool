"use client";

import { useState } from "react";
import { LoadingButton } from "./LoadingButton";
import { useToast } from "./Toast";
import { apiErrorText } from "@/lib/apiError";

export type PreviewRow = {
  index: number;
  rawVendorSku: string;
  cleanedSku: string;
  discount: string;
  vendorListPriceNew: string | null;
  marginDivisor: string;
  notes: string;
  matched: boolean;
  isInactive: boolean;
  productNumber: string;
  productName: string;
  brand: string;
  vendor: string;
  currentListPrice: string | null;
  ourNewListPrice: string | null;
  ourNewRetailPrice: string | null;
  oldRetailPrice: string | null;
  nearest9: string | null;
  invalid: boolean;
  invalidReason: string;
};

/** Rows sent back to the server, which recomputes (never trusts) the prices. */
export type BulkInputRow = {
  rawVendorSku: string;
  cleanedSku: string;
  discount: string;
  vendorListPriceNew: string;
  marginDivisor: string;
  notes: string;
};

export function BulkAddDialog({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  /** Called with the ids of the rows that were actually added (+ count). */
  onDone: (ids: string[], inputs: BulkInputRow[], added: number) => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<"input" | "preview">("input");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const hasInput = text.trim().length > 0 || !!file;

  const doPreview = async () => {
    if (previewBusy || !hasInput) return;
    setPreviewBusy(true);
    setMsg("");
    try {
      let r: Response;
      if (file) {
        const fd = new FormData();
        fd.append("action", "preview");
        fd.append("file", file);
        r = await fetch(`/api/sessions/${id}/items/bulk`, { method: "POST", body: fd });
      } else {
        r = await fetch(`/api/sessions/${id}/items/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "preview", text }),
        });
      }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, "Could not generate a preview.");
        setMsg(t);
        toast.error("Preview failed.", t);
        return;
      }
      const rows = Array.isArray((d as { rows?: unknown }).rows) ? ((d as { rows: PreviewRow[] }).rows as PreviewRow[]) : [];
      setPreviewRows(rows);
      setStep("preview");
      if (!rows.length) setMsg("No rows were found after parsing.");
    } catch {
      setMsg("Could not reach the server while generating the preview.");
      toast.error("Preview failed.", "Could not reach the server.");
    } finally {
      setPreviewBusy(false);
    }
  };

  const matchedCount = previewRows.filter((r) => !r.invalid && r.matched).length;
  const notFoundCount = previewRows.filter((r) => !r.invalid && !r.matched).length;
  const invalidCount = previewRows.filter((r) => r.invalid).length;
  const addableRows = previewRows.filter((r) => !r.invalid);
  const addableInputs: BulkInputRow[] = addableRows.map((r) => ({
    rawVendorSku: r.rawVendorSku ?? "",
    cleanedSku: r.cleanedSku ?? "",
    discount: r.discount ?? "",
    vendorListPriceNew: r.vendorListPriceNew ?? "",
    marginDivisor: r.marginDivisor ?? "",
    notes: r.notes ?? "",
  }));

  const doAdd = async () => {
    if (addBusy) return;
    setAddBusy(true);
    setMsg("");
    try {
      const r = await fetch(`/api/sessions/${id}/items/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", rows: addableInputs }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, "Could not add the rows.");
        setMsg(t);
        toast.error("Adding rows failed.", t);
        return;
      }
      const added = Number((d as { added?: number }).added ?? 0);
      onDone((d as { ids?: string[] }).ids ?? [], addableInputs, added);
    } catch {
      setMsg("Could not reach the server while adding rows.");
      toast.error("Adding rows failed.", "Could not reach the server.");
    } finally {
      setAddBusy(false);
    }
  };

  const money = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? "—" : v);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Bulk add rows">
      <div className="w-full max-w-5xl rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Bulk Add Rows</h2>
            <p className="mt-1 text-sm text-slate-600">
              Paste rows (tab-separated) or upload an Excel/CSV file with up to 6 columns:
              <span className="font-medium text-slate-800"> Raw Vendor SKU/Code, Cleaned SKU, Discount (%), Vendor List Price (New), Margin/Divisor, Notes</span>.
              Optional columns may be left blank. The same SKU matching, discount defaults, pricing and Nearest 9 rounding used by Add Row are applied.
            </p>
          </div>
          <button type="button" className="text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {step === "input" && (
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Upload Excel/CSV (optional)
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setText(""); setMsg(""); }}
              />
            </label>
            <div className="text-center text-xs text-slate-400">— or —</div>
            <label className="flex flex-col gap-1 text-sm" htmlFor="bulk-paste">
              Paste rows copied from Excel (tab-separated)
              <textarea
                id="bulk-paste"
                className="min-h-40 rounded border px-3 py-2 font-mono text-xs"
                placeholder={
                  "624-917-74008-0\t\t10\t24.50\t0.605\t\n" +
                  "0 58854 04522 7\t05885404522\t\t12.00\t\tSome note"
                }
                value={text}
                onChange={(e) => { setText(e.target.value); setFile(null); setMsg(""); }}
              />
            </label>
            {msg && <div className="text-sm text-slate-600" role="status">{msg}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={onClose}>
                Cancel
              </button>
              <LoadingButton busy={previewBusy} busyLabel="Previewing..." disabled={!hasInput || previewBusy} onClick={() => void doPreview()}>
                Preview Rows
              </LoadingButton>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">{matchedCount} matched</span>
              <span className="rounded bg-red-100 px-2 py-0.5 text-red-800">{notFoundCount} not found</span>
              {invalidCount > 0 && <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">{invalidCount} skipped</span>}
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Status</th>
                    <th className="px-2 py-1.5 text-left font-medium">Raw SKU</th>
                    <th className="px-2 py-1.5 text-left font-medium">Cleaned SKU</th>
                    <th className="px-2 py-1.5 text-right font-medium">Disc %</th>
                    <th className="px-2 py-1.5 text-right font-medium">Vend List Price</th>
                    <th className="px-2 py-1.5 text-right font-medium">Our New List</th>
                    <th className="px-2 py-1.5 text-right font-medium">Our Retail</th>
                    <th className="px-2 py-1.5 text-right font-medium">Nearest 9</th>
                    <th className="px-2 py-1.5 text-left font-medium">Product</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => (
                    <tr key={r.index} className={r.invalid ? "bg-amber-50" : !r.matched ? "bg-red-50" : ""}>
                      <td className="px-2 py-1.5 align-top">
                        {r.invalid ? (
                          <span className="rounded bg-amber-600 px-1.5 py-0.5 text-white">Invalid</span>
                        ) : r.matched ? (
                          <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-white">Found</span>
                        ) : (
                          <span className="rounded bg-red-600 px-1.5 py-0.5 text-white">Not Found</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-top font-mono">{r.rawVendorSku || "—"}</td>
                      <td className="px-2 py-1.5 align-top font-mono">{r.cleanedSku || "—"}</td>
                      <td className="px-2 py-1.5 text-right align-top">{r.discount || "—"}</td>
                      <td className="px-2 py-1.5 text-right align-top">{money(r.vendorListPriceNew)}</td>
                      <td className="px-2 py-1.5 text-right align-top">{money(r.ourNewListPrice)}</td>
                      <td className="px-2 py-1.5 text-right align-top">{money(r.ourNewRetailPrice)}</td>
                      <td className="px-2 py-1.5 text-right align-top font-semibold">{money(r.nearest9)}</td>
                      <td className="px-2 py-1.5 align-top">
                        {r.matched ? (
                          <span className="block max-w-xs truncate" title={r.productName || undefined}>
                            {r.productName || r.productNumber || ""}
                          </span>
                        ) : r.invalid ? (
                          <span className="text-amber-700">{r.invalidReason}</span>
                        ) : (
                          <span className="text-red-700">SKU not in inventory</span>
                        )}
                        {r.isInactive && <span className="block text-xs text-amber-700">(inactive)</span>}
                        {r.matched && r.brand && <span className="block text-xs text-slate-500">{r.brand} / {r.vendor}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {msg && <div className="text-sm text-slate-600" role="status">{msg}</div>}

            <div className="flex justify-between gap-2">
              <button type="button" className="rounded border px-3 py-1.5 text-sm" disabled={addBusy} onClick={() => { setStep("input"); setPreviewRows([]); setMsg(""); }}>
                Back
              </button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">{addableRows.length} of {previewRows.length} rows will be added.</span>
                <LoadingButton
                  busy={addBusy}
                  busyLabel="Adding..."
                  disabled={addBusy || addableRows.length === 0}
                  onClick={() => void doAdd()}
                >
                  Add {addableRows.length} Row{addableRows.length === 1 ? "" : "s"}
                </LoadingButton>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
