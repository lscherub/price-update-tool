"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorText } from "@/lib/apiError";
import { chunk } from "@/lib/inventoryImport";
import { parseInventoryArrayBuffer } from "@/lib/importers";
import { LoadingButton, Spinner } from "@/components/LoadingButton";
import { useToast } from "@/components/Toast";

/** Rows per server request. Mirrors the server's MAX_BATCH_ROWS. */
const BATCH_SIZE = 1000;
/** Retry a batch a few times before giving up on it (transient DB/network). */
const MAX_ATTEMPTS = 3;

type Failure = { row: number; sku: string; reason: string };

type Progress = {
  total: number;
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: Failure[];
  batchIndex: number;
  batchCount: number;
};

type Report = Progress & {
  status: "complete" | "failed";
  error?: string;
  startedAt: number;
  finishedAt: number;
};

const emptyProgress = (total: number, batchCount: number): Progress => ({
  total, processed: 0, inserted: 0, updated: 0, skipped: 0, failed: [],
  batchIndex: 0, batchCount,
});

export default function InventoryPage() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<unknown[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [markMissingInactive, setMarkMissingInactive] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [showFailures, setShowFailures] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inactiveRef = useRef<HTMLInputElement>(null);

  const fetchPage = useCallback(async (query: string, p: number) => {
    try {
      const r = await fetch(`/api/inventory?q=${encodeURIComponent(query)}&page=${p}&pageSize=100`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(apiErrorText(d, "Could not load inventory.")); setRows([]); setTotal(0); return; }
      setMsg("");
      setRows(d.rows ?? []); setTotal(d.total ?? 0);
    } catch {
      setMsg("Could not reach the server. Check your connection and try again.");
    }
  }, []);

  // Re-fetch when the page changes; searching is an explicit action. setState
  // happens in the fetch callbacks, not synchronously in the effect body.
  useEffect(() => {
    let active = true;
    fetch(`/api/inventory?q=${encodeURIComponent(q)}&page=${page}&pageSize=100`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!active) return;
        if (!r.ok) { setMsg(apiErrorText(d, "Could not load inventory.")); setRows([]); setTotal(0); return; }
        setMsg(""); setRows(d.rows ?? []); setTotal(d.total ?? 0);
      })
      .catch(() => { if (active) setMsg("Could not reach the server. Check your connection and try again."); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const search = () => { setPage(1); void fetchPage(q, 1); };

  /** Send one batch, retrying transient failures (pooler cold start, blips). */
  const sendBatch = async (rows: unknown[], startRow: number) => {
    let lastError = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const r = await fetch("/api/inventory/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows, startRow }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          lastError = apiErrorText(d, "the server rejected this batch.");
          if (r.status >= 400 && r.status < 500) break; // 4xx will not improve
        } else {
          return d as { processed?: number; total?: number; inserted: number; updated: number; skipped: number; failed: Failure[] };
        }
      } catch {
        lastError = "Could not reach the server.";
      }
      if (attempt < MAX_ATTEMPTS) await new Promise((res) => setTimeout(res, 800 * attempt));
    }
    throw new Error(lastError || "Batch failed.");
  };

  /**
   * Bulk import: file -> parsed in browser -> 1,000-row JSON batches -> one
   * bulk upsert statement per batch -> progress reported after every batch.
   * Each batch is independent and idempotent (upsert by sku), so a failure
   * never corrupts what was already committed.
   */
  const runImport = async () => {
    if (importing) return;
    if (!file) { toast.warning("Choose an Excel or CSV file first."); return; }
    setImporting(true);
    setReport(null);
    setShowFailures(false);
    setMsg("");
    const startedAt = Date.now();

    try {
      toast.info("Reading spreadsheet...");
      const { products, columns } = parseInventoryArrayBuffer(await file.arrayBuffer());
      if (!products.length) {
        const detail = `Detected columns: ${columns.join(", ") || "(none)"}. Make sure the file has a SKU column plus product details.`;
        toast.error("No inventory rows found in the file.", detail);
        setMsg(`No inventory rows found. ${detail}`);
        return;
      }

      const batches = chunk(products, BATCH_SIZE);
      const acc = emptyProgress(products.length, batches.length);
      setProgress(acc);
      toast.info(`Importing ${products.length.toLocaleString()} products in ${batches.length} batches...`);
for (let i = 0; i < batches.length; i++) {
        setProgress({ ...acc, batchIndex: i + 1 });
        const startRow = 2 + i * BATCH_SIZE;
        try {
          const d = await sendBatch(batches[i], startRow);
          acc.processed += d.processed ?? batches[i].length;
          acc.inserted += d.inserted ?? 0;
          acc.updated += d.updated ?? 0;
          acc.skipped += d.skipped ?? 0;
          acc.failed.push(...((d.failed ?? []) as Failure[]));
          if (typeof d.total === "number") setTotal(d.total);
        } catch (e) {
          // Record this batch's rows as failed, then CONTINUE with the next
          // batch: one bad request must never silently stop the import.
          const reason = e instanceof Error ? e.message : "Batch failed.";
          acc.processed += batches[i].length;
          acc.failed.push(
            ...batches[i].map((r, j) => ({
              row: startRow + j,
              sku: String((r as { sku?: string })?.sku ?? ""),
              reason,
            })),
          );
          toast.error(`Batch ${i + 1} of ${batches.length} failed.`, reason);
        }
        setProgress({ ...acc });
      }

      if (markMissingInactive) {
        toast.info("Flagging products missing from this export...");
        try {
          const r = await fetch("/api/inventory/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ finalize: true, skus: products.map((p) => p.sku) }),
          });
          const d = await r.json().catch(() => ({}));
          if (r.ok && typeof d.total === "number") setTotal(d.total);
        } catch {
          toast.warning("Could not flag products missing from the export.", "You can re-run this from the Inactive SKU list import.");
        }
      }

      const finishedAt = Date.now();
      const seconds = ((finishedAt - startedAt) / 1000).toFixed(1);
      setReport({ ...acc, status: "complete", startedAt, finishedAt });
      setProgress(null);

      const summary = `${acc.processed.toLocaleString()} of ${products.length.toLocaleString()} rows processed in ${seconds}s — ${acc.inserted.toLocaleString()} inserted, ${acc.updated.toLocaleString()} updated${acc.failed.length ? `, ${acc.failed.length} failed` : ""}.`;
      if (acc.failed.length) toast.warning("Inventory import finished with errors.", summary);
      else toast.success("Inventory import completed successfully.", summary);
    } catch (e) {
      const error = e instanceof Error ? e.message : "Inventory import failed.";
      setReport({ ...(progress ?? emptyProgress(0, 0)), status: "failed", error, startedAt, finishedAt: Date.now() });
      setProgress(null);
      toast.error("Inventory import failed.", error);
    } finally {
      setImporting(false);
      // Refresh counts automatically — no manual browser refresh needed.
      setPage(1);
      await fetchPage(q, 1);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const uploadInactive = async (f: File) => {
    if (importing) return;
    setImporting(true);
    toast.info("Importing inactive SKU list...");
    try {
      const fd = new FormData();
      fd.append("file", f); fd.append("mode", "inactive");
      const r = await fetch("/api/inventory/import", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) toast.error("Inactive import failed.", apiErrorText(d, "unknown error"));
      else {
        setMsg(`Inactive list applied: ${(d.inactive ?? 0).toLocaleString()} of ${(d.total ?? 0).toLocaleString()} products inactive.`);
        toast.success("Inactive SKU list imported.", `${(d.inactive ?? 0).toLocaleString()} of ${(d.total ?? 0).toLocaleString()} products are now inactive.`);
      }
    } catch {
      toast.error("Inactive import failed.", "Could not reach the server.");
    } finally {
      setImporting(false);
      setPage(1);
      await fetchPage(q, 1);
      if (inactiveRef.current) inactiveRef.current.value = "";
    }
  };

  const pct = progress && progress.total ? Math.floor((progress.processed / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Inventory</h1>

      <div className="flex flex-col gap-3 rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            POS inventory file (Excel/CSV)
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={importing}
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }}
            />
          </label>
          <LoadingButton busy={importing} busyLabel="Importing..." stableWidth onClick={runImport}>
            Import Inventory
          </LoadingButton>
          <label className="flex flex-col gap-1 text-sm">
            Inactive SKU list
            <input
              ref={inactiveRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={importing}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadInactive(f); }}
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={markMissingInactive}
            disabled={importing}
            onChange={(e) => setMarkMissingInactive(e.target.checked)}
          />
          After importing, mark products missing from this export as inactive (never deletes — price history is preserved)
        </label>

        {file && !importing && !report && (
          <div className="text-xs text-slate-500">Ready to import: {file.name}</div>
        )}
        {msg && <div className="text-sm text-slate-600" role="status">{msg}</div>}
      </div>

      {progress && (
        <div className="rounded-xl border bg-white p-4" role="status" aria-live="polite">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 font-semibold"><Spinner /> Importing Inventory...</span>
            <span className="font-mono">{progress.processed.toLocaleString()} / {progress.total.toLocaleString()} rows ({pct}%)</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded bg-slate-200">
            <div className="h-full bg-slate-900 transition-[width] duration-200" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
            <span>Inserted: {progress.inserted.toLocaleString()}</span>
            <span>Updated: {progress.updated.toLocaleString()}</span>
            <span>Skipped: {progress.skipped.toLocaleString()}</span>
            <span>Failed: {progress.failed.length.toLocaleString()}</span>
            <span>Current batch: {progress.batchIndex} of {progress.batchCount}</span>
          </div>
        </div>
      )}
{report && (
        <div className="rounded-xl border bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">{report.status === "complete" ? "Import Complete" : "Import Failed"}</h2>
            <button className="text-xs text-blue-600 underline" onClick={() => setReport(null)}>Dismiss</button>
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {report.processed.toLocaleString()} / {report.total.toLocaleString()} rows processed
            {report.finishedAt && report.startedAt ? ` in ${((report.finishedAt - report.startedAt) / 1000).toFixed(1)}s` : ""}
          </div>
          {report.error && <div className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">Error: {report.error}</div>}
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div className="rounded border px-3 py-2"><div className="text-xs text-slate-500">Total rows in file</div><div className="text-lg font-bold">{report.total.toLocaleString()}</div></div>
            <div className="rounded border px-3 py-2"><div className="text-xs text-slate-500">Inserted</div><div className="text-lg font-bold text-emerald-700">{report.inserted.toLocaleString()}</div></div>
            <div className="rounded border px-3 py-2"><div className="text-xs text-slate-500">Updated</div><div className="text-lg font-bold text-blue-700">{report.updated.toLocaleString()}</div></div>
            <div className="rounded border px-3 py-2"><div className="text-xs text-slate-500">Skipped / Failed</div><div className="text-lg font-bold">{report.skipped.toLocaleString()} / {report.failed.length.toLocaleString()}</div></div>
          </div>
          {report.failed.length > 0 && (
            <div className="mt-3">
              <button className="text-sm font-medium text-blue-600 underline" onClick={() => setShowFailures((s) => !s)}>
                {showFailures ? "Hide failed rows" : `View Failed Rows (${report.failed.length})`}
              </button>
              {showFailures && (
                <div className="mt-2 max-h-64 overflow-auto rounded border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-50"><tr className="text-left"><th className="px-2 py-1">Row</th><th className="px-2 py-1">SKU</th><th className="px-2 py-1">Reason</th></tr></thead>
                    <tbody>
                      {report.failed.slice(0, 500).map((f, i) => (
                        <tr key={`${f.row}-${i}`} className="border-t">
                          <td className="px-2 py-1 font-mono">{f.row}</td>
                          <td className="px-2 py-1 font-mono">{f.sku || "(blank)"}</td>
                          <td className="px-2 py-1 text-red-700">{f.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {report.failed.length > 500 && (
                    <div className="border-t px-2 py-1 text-xs text-slate-500">Showing the first 500 of {report.failed.length.toLocaleString()} failed rows.</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <input className="w-full max-w-md rounded border px-3 py-2" placeholder="Search SKU, product #, description, brand..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
        <button className="rounded bg-slate-900 px-4 py-2 text-sm text-white" onClick={search}>Search</button>
      </div>
      <div className="text-sm text-slate-500">{total.toLocaleString()} products</div>
      <div className="overflow-auto rounded-xl border bg-white">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-slate-50">
            <tr className="text-left">
              {["Sku", "Product Number", "Description", "Vendor", "Brand", "List Cost", "Price", "Size Desc", "Status"].map((h) => (
                <th key={h} className="px-2 py-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(rows as Record<string, string | boolean>[]).map((r, i) => (
              <tr key={i} className="border-t">
                <td className="px-2 py-1 font-mono">{String(r.sku)}</td>
                <td className="px-2 py-1">{String(r.productNumber)}</td>
                <td className="px-2 py-1">{String(r.description)}</td>
                <td className="px-2 py-1">{String(r.vendor)}</td>
                <td className="px-2 py-1">{String(r.brand)}</td>
                <td className="px-2 py-1 text-right">{String(r.listCost)}</td>
                <td className="px-2 py-1 text-right">{String(r.price)}</td>
                <td className="px-2 py-1">{String(r.sizeDesc)}</td>
                <td className="px-2 py-1">{r.isInactive ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Inactive</span> : <span className="text-slate-400">Active</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button disabled={page <= 1} className="rounded border px-3 py-1 text-sm disabled:opacity-40" onClick={() => setPage(page - 1)}>Prev</button>
        <span className="text-sm">Page {page}</span>
        <button className="rounded border px-3 py-1 text-sm" onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
