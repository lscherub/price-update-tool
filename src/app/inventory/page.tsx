"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorText } from "@/lib/apiError";
import { chunk } from "@/lib/inventoryImport";
import { parseInventoryArrayBuffer } from "@/lib/importers";
import { LoadingButton, Spinner } from "@/components/LoadingButton";
import { useToast } from "@/components/Toast";
import { AddProductDialog, type AddProductInput } from "@/components/AddProductDialog";
import { useUiMode } from "@/contexts/UiModeContext";

/** Rows per server request. Mirrors the server's MAX_BATCH_ROWS. */
const BATCH_SIZE = 1000;
/** Retry a batch a few times before giving up on it (transient DB/network). */
const MAX_ATTEMPTS = 3;

/** Small "active filter" chip with an × to clear just that filter. */
function FilterChip({ label, onClear, onApply }: { label: string; onClear: () => void; onApply: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 font-medium text-sky-900">
      {label}
      <button
        aria-label={`Clear filter ${label}`}
        className="rounded px-0.5 hover:bg-sky-200"
        onClick={() => { onClear(); onApply(); }}
      >
        ×
      </button>
    </span>
  );
}

/** Column dropdown (PriceGrid visual language): sort actions + custom body. */
function InvHeader({ label, colKey, sortKey, sortDir, filtered, openMenu, onToggle, onSort, onClearSort, sortAscLabel, sortDescLabel, menuRef, children }: {
  label: string; colKey: string;
  sortKey: string | null; sortDir: "asc" | "desc" | null; filtered: boolean;
  openMenu: string | null; onToggle: (key: string) => void;
  onSort: (dir: "asc" | "desc") => void; onClearSort: () => void;
  sortAscLabel: string; sortDescLabel: string;
  menuRef: React.RefObject<HTMLDivElement | null>; children?: React.ReactNode;
}) {
  const active = sortKey === colKey && !!sortDir;
  return (
    <th className="relative px-2 py-2 text-left font-semibold">
      <span className="inline-flex items-center gap-0.5">
        {label}
        {filtered && <span aria-label="Filtered" title="This column is filtered" className="text-sky-600">●</span>}
        {active && <span aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span>}
        <button
          type="button"
          aria-label={`Sort ${label}`}
          aria-haspopup="menu"
          aria-expanded={openMenu === colKey}
          className="rounded px-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
          onClick={() => onToggle(colKey)}
        >
          ▾
        </button>
      </span>
      {openMenu === colKey && (
        <div ref={menuRef} role="menu" aria-label={`Sort ${label}`} className="absolute left-0 top-full z-30 min-w-52 rounded-lg border bg-white py-1 text-xs font-normal shadow-lg">
          <button type="button" role="menuitemradio" aria-checked={active && sortDir === "asc"}
            className={`block w-full px-3 py-1.5 text-left hover:bg-slate-100 ${active && sortDir === "asc" ? "font-bold" : ""}`}
            onClick={() => onSort("asc")}>
            {sortAscLabel}
          </button>
          <button type="button" role="menuitemradio" aria-checked={active && sortDir === "desc"}
            className={`block w-full px-3 py-1.5 text-left hover:bg-slate-100 ${active && sortDir === "desc" ? "font-bold" : ""}`}
            onClick={() => onSort("desc")}>
            {sortDescLabel}
          </button>
          <button type="button" role="menuitemradio" aria-checked={!active || !sortDir}
            className="block w-full px-3 py-1.5 text-left text-slate-500 hover:bg-slate-100"
            onClick={onClearSort}>
            Clear sort
          </button>
          {children}
        </div>
      )}
    </th>
  );
}

/** "Search THIS column only" box used inside each column menu. */
function ColumnSearchBox({ label, placeholder, value, onChange, onApply, onClear }: {
  label: string; placeholder: string; value: string;
  onChange: (v: string) => void; onApply: () => void; onClear: () => void;
}) {
  return (
    <div className="border-t px-3 py-2">
      <div className="mb-1 font-semibold text-slate-600">{label}</div>
      <div className="flex gap-1">
        <input
          className="w-full min-w-36 rounded border px-2 py-1"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onApply(); } e.stopPropagation(); }}
        />
        {value && (
          <button
            aria-label={`Clear ${label}`}
            className="rounded border px-2 hover:bg-slate-100"
            onClick={onClear}
          >
            ×
          </button>
        )}
      </div>
      <button className="mt-1 rounded bg-slate-900 px-2 py-1 text-xs text-white" onClick={onApply}>
        Apply
      </button>
    </div>
  );
}

/** Scrollable distinct-value picker for Vendor/Brand. */
function FacetList({ title, loading, rows, search, selected, onSearch, onPick }: {
  title: string; loading: boolean; rows: { value: string; count: number }[];
  search: string; selected: string;
  onSearch: (v: string) => void; onPick: (v: string) => void;
}) {
  return (
    <div className="border-t px-3 py-2">
      <div className="mb-1 font-semibold text-slate-600">{title}</div>
      <input
        className="mb-1 w-full min-w-36 rounded border px-2 py-1"
        placeholder="Type to narrow..."
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      {loading && <div className="py-1 text-slate-500">Loading...</div>}
      {!loading && (
        <div className="max-h-44 overflow-auto">
          {rows.map((r) => (
            <button
              key={r.value}
              className={`flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left hover:bg-slate-100 ${selected === r.value ? "font-bold" : ""}`}
              onClick={() => onPick(r.value)}
            >
              <span className="truncate">{r.value}</span>
              <span className="text-slate-400">{r.count.toLocaleString()}</span>
            </button>
          ))}
          {!rows.length && <div className="py-1 text-slate-500">No matches.</div>}
        </div>
      )}
    </div>
  );
}

type Failure = { row: number; sku: string; reason: string };

type ProductRow = {
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
  /** ISO timestamp of the last successful Full/All Inventory import (null = never). */
  const [lastImportedAt, setLastImportedAt] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  // --- Excel-style column sort/filter (PriceGrid visual language) ---
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [fSku, setFSku] = useState("");
  const [fNum, setFNum] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fVendorContains, setFVendorContains] = useState("");
  const [fBrandContains, setFBrandContains] = useState("");
  const [fVendorExact, setFVendorExact] = useState("");
  const [fBrandExact, setFBrandExact] = useState("");
  /** "" = All, "false" = Active only, "true" = Inactive only. */
  const [fInactive, setFInactive] = useState("");
  const [facetQ, setFacetQ] = useState("");
  const [facetRows, setFacetRows] = useState<{ value: string; count: number }[]>([]);
  const [facetLoading, setFacetLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [markMissingInactive, setMarkMissingInactive] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [showFailures, setShowFailures] = useState(false);
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  /** Id of the row currently being saved, so only that cell shows a spinner. */
  const [savingId, setSavingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inactiveRef = useRef<HTMLInputElement>(null);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [addProductBusy, setAddProductBusy] = useState(false);
  const { mode } = useUiMode();
  const [showImportCard, setShowImportCard] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  type Filters = {
    q: string; sku: string; num: string; desc: string;
    vendorContains: string; brandContains: string;
    vendorExact: string; brandExact: string; inactive: string;
    sortKey: string | null; sortDir: "asc" | "desc" | null;
  };
  const buildQuery = (f: Filters, p: number) => {
    const sp = new URLSearchParams();
    sp.set("q", f.q); sp.set("page", String(p)); sp.set("pageSize", "100");
    if (f.sku) sp.set("sku", f.sku);
    if (f.num) sp.set("productNumber", f.num);
    if (f.desc) sp.set("description", f.desc);
    if (f.vendorContains) sp.set("vendorFilter", f.vendorContains);
    if (f.brandContains) sp.set("brandFilter", f.brandContains);
    if (f.vendorExact) sp.set("vendorExact", f.vendorExact);
    if (f.brandExact) sp.set("brandExact", f.brandExact);
    if (f.inactive) sp.set("inactive", f.inactive);
    if (f.sortKey && f.sortDir) { sp.set("sort", f.sortKey); sp.set("sortDir", f.sortDir); }
    return sp.toString();
  };
  const snapshotFilters = (): Filters => ({
    q, sku: fSku, num: fNum, desc: fDesc,
    vendorContains: fVendorContains, brandContains: fBrandContains,
    vendorExact: fVendorExact, brandExact: fBrandExact, inactive: fInactive,
    sortKey, sortDir,
  });
  const fetchPage = useCallback(async (query: string) => {
    try {
      // query is a fully-built query string (global search + column filters +
      // sort); callers own building it via buildQuery()/snapshotFilters().
      const r = await fetch(`/api/inventory?${query}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(apiErrorText(d, "Could not load inventory.")); setRows([]); setTotal(0); return; }
      setMsg("");
      setRows(d.rows ?? []); setTotal(d.total ?? 0);
      if (typeof d.lastImportedAt === "string" || d.lastImportedAt === null) setLastImportedAt(d.lastImportedAt ?? null);
      if (typeof d.lastUpdatedAt === "string" || d.lastUpdatedAt === null) setLastUpdatedAt(d.lastUpdatedAt ?? null);
    } catch {
      setMsg("Could not reach the server. Check your connection and try again.");
    }
  }, []);

  // Re-fetch when the page changes; searching is an explicit action. setState
  // happens in the fetch callbacks, not synchronously in the effect body.
  useEffect(() => {
    let active = true;
    const qs = buildQuery(snapshotFilters(), page);
    fetch(`/api/inventory?${qs}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!active) return;
        if (!r.ok) { setMsg(apiErrorText(d, "Could not load inventory.")); setRows([]); setTotal(0); return; }
        setMsg(""); setRows(d.rows ?? []); setTotal(d.total ?? 0);
        if (typeof d.lastImportedAt === "string" || d.lastImportedAt === null) setLastImportedAt(d.lastImportedAt ?? null);
        if (typeof d.lastUpdatedAt === "string" || d.lastUpdatedAt === null) setLastUpdatedAt(d.lastUpdatedAt ?? null);
      })
      .catch(() => { if (active) setMsg("Could not reach the server. Check your connection and try again."); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const search = () => { setPage(1); void fetchPage(buildQuery(snapshotFilters(), 1)); };
  /** Re-fetch page 1 with the CURRENT global search + column filters + sort. */
  const refreshWithFilters = () => {
    setPage(1);
    return fetchPage(buildQuery(snapshotFilters(), 1));
  };

  /** Fetch the "Last imported"/"Last updated" timestamps on load (read-only). */
  useEffect(() => {
    let active = true;
    fetch("/api/inventory/last-import")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!active || !r.ok) return;
        if (typeof d.lastImportedAt === "string" || d.lastImportedAt === null) {
          setLastImportedAt(d.lastImportedAt ?? null);
        }
        if (typeof d.lastUpdatedAt === "string" || d.lastUpdatedAt === null) {
          setLastUpdatedAt(d.lastUpdatedAt ?? null);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  /** Close the open column menu on outside click (PriceGrid pattern). */
  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [openMenu]);

  /** Load distinct Vendor/Brand values when that column menu opens. */
  const loadFacets = async (column: "vendor" | "brand", needle: string) => {
    setFacetLoading(true);
    try {
      const r = await fetch(`/api/inventory/facets?column=${column}&q=${encodeURIComponent(needle)}&limit=30`);
      const d = await r.json().catch(() => ({}));
      if (r.ok) setFacetRows(Array.isArray(d.rows) ? d.rows : []);
    } catch {
      setFacetRows([]);
    } finally {
      setFacetLoading(false);
    }
  };
  const openColumnMenu = (key: string) => {
    if (openMenu === key) { setOpenMenu(null); return; }
    setOpenMenu(key);
    setFacetQ("");
    if (key === "vendor" || key === "brand") void loadFacets(key, "");
  };

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

      // Record the "Last imported" timestamp ONLY when the whole Full/All
      // Inventory import succeeded (zero failed rows). A failed import keeps
      // the previous successful timestamp unchanged.
      if (!acc.failed.length) {
        try {
          const r = await fetch("/api/inventory/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ completeFullImport: true }),
          });
          const d = await r.json().catch(() => ({}));
          if (r.ok && typeof d.lastImportedAt === "string") setLastImportedAt(d.lastImportedAt);
        } catch {
          // Import itself succeeded; the timestamp just stays stale until the
          // next successful import. Never fail the import UI over this.
        }
      }

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
      await refreshWithFilters();
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
      await refreshWithFilters();
      if (inactiveRef.current) inactiveRef.current.value = "";
    }
  };

  /**
   * Delete all inventory products. Guarded by an explicit confirmation dialog
   * that spells out what is removed and what is kept, and the count is shown so
   * the user knows what they are about to lose.
   */
  const clearInventory = async () => {
    if (clearing) return;
    const confirmed = window.confirm(
      `Clear ALL inventory data?\n\n` +
        `This permanently deletes all ${total.toLocaleString()} inventory products ` +
        `(Active and Inactive alike).\n\n` +
        `Price update history, price update sessions, exports and vendor discounts ` +
        `are NOT deleted.\n\n` +
        `You will need to re-import your full inventory file afterwards.`,
    );
    if (!confirmed) return;
    setClearing(true);
    setMsg("");
    try {
      const r = await fetch("/api/inventory/clear", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = apiErrorText(d, "Could not clear the inventory.");
        toast.error("Clear Inventory failed.", detail);
        setMsg(`Clear Inventory failed. ${detail}`);
      } else {
        const removed = Number(d.deletedProducts ?? 0);
        setMsg(`Inventory cleared: ${removed.toLocaleString()} products removed. Price update history was kept.`);
        toast.success("Inventory cleared.", `${removed.toLocaleString()} products removed. Price update history was kept.`);
        // Refresh the count and table automatically.
        await refreshWithFilters();
      }
    } catch {
      toast.error("Clear Inventory failed.", "Could not reach the server.");
    } finally {
      setClearing(false);
    }
  };

  /**
   * Manual Active/Inactive change for a single product.
   *
   * Optimistic, then confirmed by the server: only the affected row is patched
   * locally, so the page, count and other rows are never re-fetched.
   */
  const updateStatus = async (row: ProductRow, isInactive: boolean) => {
    if (savingId) return;
    if (row.isInactive === isInactive) return;
    const previous = row.isInactive;
    setSavingId(row.id);
    setRows((prev) =>
      prev.map((r) => ((r as ProductRow).id === row.id ? { ...(r as ProductRow), isInactive } : r)),
    );
    try {
      const r = await fetch("/api/inventory/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, isInactive }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(apiErrorText(d, "Could not update the status."));
      const saved = (d.product ?? {}) as { id?: string; isInactive?: boolean };
      // Refresh just this row with the value the database actually stored.
      setRows((prev) =>
        prev.map((x) => {
          const r2 = x as ProductRow;
          if (r2.id !== row.id) return r2;
          return { ...r2, isInactive: typeof saved.isInactive === "boolean" ? saved.isInactive : isInactive };
        }),
      );
      toast.success(
        `${row.sku} set to ${isInactive ? "Inactive" : "Active"}.`,
      );
    } catch (e) {
      // Roll the row back to its previous value so the UI never lies.
      const detail = e instanceof Error ? e.message : "Could not update the status.";
      setRows((prev) =>
        prev.map((x) => ((x as ProductRow).id === row.id ? { ...(x as ProductRow), isInactive: previous } : x)),
      );
      toast.error(`Could not update ${row.sku}.`, detail);
    } finally {
      setSavingId(null);
    }
  };


  /**
   * Add a single product manually, without a full POS import.
   * Sends to /api/inventory/product which validates SKU uniqueness.
   */
  const addProduct = async (v: AddProductInput) => {
    if (addProductBusy) return;
    setAddProductBusy(true);
    try {
      const r = await fetch("/api/inventory/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: v.sku,
          productNumber: v.productNumber,
          description: v.description,
          vendor: v.vendor,
          brand: v.brand,
          listCost: v.listCost || "0",
          price: v.price || "0",
          sizeDesc: v.sizeDesc,
          status: v.status,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error("Could not add product.", apiErrorText(d, "Could not add product."));
        return;
      }
      setShowAddProduct(false);
      toast.success(`Product "${v.sku}" added to inventory.`);
      await refreshWithFilters();
    } catch {
      toast.error("Could not add product.", "Could not reach the server. Check your connection and try again.");
    } finally {
      setAddProductBusy(false);
    }
  };
  const pct = progress && progress.total ? Math.floor((progress.processed / progress.total) * 100) : 0;

  /** "Oct 7, 2026, 10:42 AM" or "Never" when no successful full import yet. */
  const formatLastImported = (iso: string | null): string => {
    if (!iso) return "Never";
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return "Never";
    return t.toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  };
  const hasActiveFilters = !!(
    fSku || fNum || fDesc || fVendorContains || fBrandContains ||
    fVendorExact || fBrandExact || fInactive
  );
  const headerLabel = (key: string): string => {
    const m: Record<string, string> = {
      sku: "Sku", productNumber: "Product Number", description: "Description",
      vendor: "Vendor", brand: "Brand", listCost: "List Cost", price: "Price",
      sizeDesc: "Size Desc", status: "Status",
    };
    return m[key] ?? key;
  };
  /** Re-run the search immediately with optional one-off filter overrides. */
  const applyNow = (overrides?: Partial<Filters>) => {
    setPage(1);
    const f = snapshotFilters();
    if (overrides) Object.assign(f, overrides);
    void fetchPage(buildQuery(f, 1));
  };
  const changeSort = (key: string, dir: "asc" | "desc" | null) => {
    const nextKey = dir ? key : null;
    setSortKey(nextKey); setSortDir(dir);
    setOpenMenu(null);
    setPage(1);
    const f = snapshotFilters();
    f.sortKey = nextKey; f.sortDir = dir;
    void fetchPage(buildQuery(f, 1));
  };
  const clearSort = () => changeSort(sortKey ?? "", null);

  // ==========================================
  // CLASSIC UI MODE (Preserved pixel-perfect)
  // ==========================================
  if (mode === "classic") {
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
          <LoadingButton
            busy={clearing}
            busyLabel="Clearing..."
            className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
            onClick={clearInventory}
            title="Delete all inventory products. Price update history is kept."
          >
            Clear Inventory
          </LoadingButton>
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
      <div className="flex flex-wrap gap-2">
        <input className="w-full max-w-md rounded border px-3 py-2" placeholder="Search SKU, product #, description, brand..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
        <button className="rounded bg-slate-900 px-4 py-2 text-sm text-white" onClick={search}>Search</button>
        <button
          type="button"
          className="rounded border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
          onClick={() => setShowAddProduct(true)}
          disabled={importing}
        >
          + Add Product
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 text-sm text-slate-500">
        <span>{total.toLocaleString()} products</span>
        <span aria-hidden="true">·</span>
        <span title={lastImportedAt ? `Last successful Full/All Inventory import: ${new Date(lastImportedAt).toISOString()}` : "No successful full inventory import recorded yet"}>
          Last imported: {formatLastImported(lastImportedAt)}
        </span>
        <span aria-hidden="true">·</span>
        <span title={lastUpdatedAt ? `Last successful Export-for-POS price sync: ${new Date(lastUpdatedAt).toISOString()}` : "No successful price synchronization recorded yet"}>
          Last updated: {formatLastImported(lastUpdatedAt)}
        </span>
      </div>
      {(hasActiveFilters || sortKey) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-slate-600">Filters:</span>
          {fSku && <FilterChip label={`SKU contains "${fSku}"`} onClear={() => setFSku("")} onApply={() => applyNow({ sku: "" })} />}
          {fNum && <FilterChip label={`Product # contains "${fNum}"`} onClear={() => setFNum("")} onApply={() => applyNow({ num: "" })} />}
          {fDesc && <FilterChip label={`Description contains "${fDesc}"`} onClear={() => setFDesc("")} onApply={() => applyNow({ desc: "" })} />}
          {fVendorContains && <FilterChip label={`Vendor contains "${fVendorContains}"`} onClear={() => setFVendorContains("")} onApply={() => applyNow({ vendorContains: "" })} />}
          {fBrandContains && <FilterChip label={`Brand contains "${fBrandContains}"`} onClear={() => setFBrandContains("")} onApply={() => applyNow({ brandContains: "" })} />}
          {fVendorExact && <FilterChip label={`Vendor = ${fVendorExact}`} onClear={() => setFVendorExact("")} onApply={() => applyNow({ vendorExact: "" })} />}
          {fBrandExact && <FilterChip label={`Brand = ${fBrandExact}`} onClear={() => setFBrandExact("")} onApply={() => applyNow({ brandExact: "" })} />}
          {fInactive && <FilterChip label={`Status = ${fInactive === "true" ? "Inactive" : "Active"}`} onClear={() => setFInactive("")} onApply={() => applyNow({ inactive: "" })} />}
          {sortKey && sortDir && <FilterChip label={`Sorted: ${headerLabel(sortKey)} ${sortDir === "asc" ? "↑" : "↓"}`} onClear={() => { setSortKey(null); setSortDir(null); }} onApply={applyNow} />}
          <button
            className="rounded border px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-100"
            onClick={() => {
              setFSku(""); setFNum(""); setFDesc("");
              setFVendorContains(""); setFBrandContains("");
              setFVendorExact(""); setFBrandExact(""); setFInactive("");
              setSortKey(null); setSortDir(null);
              setPage(1);
              const sp = new URLSearchParams();
              sp.set("q", q); sp.set("page", "1"); sp.set("pageSize", "100");
              void fetchPage(sp.toString());
            }}
          >
            Clear all
          </button>
        </div>
      )}
      <div className="overflow-auto rounded-xl border bg-white">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-slate-50">
            <tr className="text-left">
              <InvHeader label="Sku" colKey="sku" sortKey={sortKey} sortDir={sortDir} filtered={!!fSku}
                openMenu={openMenu} onToggle={openColumnMenu} sortAscLabel="Sort Smallest → Largest" sortDescLabel="Sort Largest → Smallest"
                onSort={(d) => changeSort("sku", d)} onClearSort={clearSort} menuRef={menuRef}>
                <ColumnSearchBox label="Filter SKU" placeholder="Search SKU..." value={fSku}
                  onChange={setFSku} onApply={applyNow} onClear={() => { setFSku(""); applyNow({ sku: "" }); }} />
              </InvHeader>
              <InvHeader label="Product Number" colKey="productNumber" sortKey={sortKey} sortDir={sortDir} filtered={!!fNum}
                openMenu={openMenu} onToggle={openColumnMenu} sortAscLabel="Sort Smallest → Largest" sortDescLabel="Sort Largest → Smallest"
                onSort={(d) => changeSort("productNumber", d)} onClearSort={clearSort} menuRef={menuRef}>
                <ColumnSearchBox label="Filter Product Number" placeholder="Search product #..." value={fNum}
                  onChange={setFNum} onApply={applyNow} onClear={() => { setFNum(""); applyNow({ num: "" }); }} />
              </InvHeader>
              <InvHeader label="Description" colKey="description" sortKey={sortKey} sortDir={sortDir} filtered={!!fDesc}
                openMenu={openMenu} onToggle={openColumnMenu} sortAscLabel="Sort A → Z" sortDescLabel="Sort Z → A"
                onSort={(d) => changeSort("description", d)} onClearSort={clearSort} menuRef={menuRef}>
                <ColumnSearchBox label="Filter Product Name" placeholder="Search product..." value={fDesc}
                  onChange={setFDesc} onApply={applyNow} onClear={() => { setFDesc(""); applyNow({ desc: "" }); }} />
              </InvHeader>
              <InvHeader label="Vendor" colKey="vendor" sortKey={sortKey} sortDir={sortDir} filtered={!!(fVendorContains || fVendorExact)}
                openMenu={openMenu} onToggle={openColumnMenu} sortAscLabel="Sort A → Z" sortDescLabel="Sort Z → A"
                onSort={(d) => changeSort("vendor", d)} onClearSort={clearSort} menuRef={menuRef}>
                <ColumnSearchBox label="Filter Vendor" placeholder="Search vendor..." value={fVendorContains}
                  onChange={setFVendorContains} onApply={applyNow} onClear={() => { setFVendorContains(""); applyNow({ vendorContains: "" }); }} />
                <FacetList
                  title="Filter by specific vendor"
                  loading={facetLoading} rows={facetRows} search={facetQ} selected={fVendorExact}
                  onSearch={(v) => { setFacetQ(v); void loadFacets("vendor", v); }}
                  onPick={(v) => { setFVendorExact(v); setOpenMenu(null); applyNow({ vendorExact: v }); }}
                />
                {fVendorExact && (
                  <button className="block w-full px-3 py-1.5 text-left text-slate-500 hover:bg-slate-100" onClick={() => { setFVendorExact(""); setOpenMenu(null); applyNow({ vendorExact: "" }); }}>
                    Clear vendor selection
                  </button>
                )}
              </InvHeader>
              <InvHeader label="Brand" colKey="brand" sortKey={sortKey} sortDir={sortDir} filtered={!!(fBrandContains || fBrandExact)}
                openMenu={openMenu} onToggle={openColumnMenu} sortAscLabel="Sort A → Z" sortDescLabel="Sort Z → A"
                onSort={(d) => changeSort("brand", d)} onClearSort={clearSort} menuRef={menuRef}>
                <ColumnSearchBox label="Filter Brand" placeholder="Search brand..." value={fBrandContains}
                  onChange={setFBrandContains} onApply={applyNow} onClear={() => { setFBrandContains(""); applyNow({ brandContains: "" }); }} />
                <FacetList
                  title="Filter by specific brand"
                  loading={facetLoading} rows={facetRows} search={facetQ} selected={fBrandExact}
                  onSearch={(v) => { setFacetQ(v); void loadFacets("brand", v); }}
                  onPick={(v) => { setFBrandExact(v); setOpenMenu(null); applyNow({ brandExact: v }); }}
                />
                {fBrandExact && (
                  <button className="block w-full px-3 py-1.5 text-left text-slate-500 hover:bg-slate-100" onClick={() => { setFBrandExact(""); setOpenMenu(null); applyNow({ brandExact: "" }); }}>
                    Clear brand selection
                  </button>
                )}
              </InvHeader>
              <InvHeader label="List Cost" colKey="listCost" sortKey={sortKey} sortDir={sortDir} filtered={false}
                openMenu={openMenu} onToggle={openColumnMenu} sortAscLabel="Sort Smallest → Largest" sortDescLabel="Sort Largest → Smallest"
                onSort={(d) => changeSort("listCost", d)} onClearSort={clearSort} menuRef={menuRef} />
              <InvHeader label="Price" colKey="price" sortKey={sortKey} sortDir={sortDir} filtered={false}
                openMenu={openMenu} onToggle={openColumnMenu} sortAscLabel="Sort Smallest → Largest" sortDescLabel="Sort Largest → Smallest"
                onSort={(d) => changeSort("price", d)} onClearSort={clearSort} menuRef={menuRef} />
              <InvHeader label="Size Desc" colKey="sizeDesc" sortKey={sortKey} sortDir={sortDir} filtered={false}
                openMenu={openMenu} onToggle={openColumnMenu} sortAscLabel="Sort A → Z" sortDescLabel="Sort Z → A"
                onSort={(d) => changeSort("sizeDesc", d)} onClearSort={clearSort} menuRef={menuRef} />
              <InvHeader label="Status" colKey="status" sortKey={sortKey} sortDir={sortDir} filtered={!!fInactive}
                openMenu={openMenu} onToggle={openColumnMenu} sortAscLabel="Sort A → Z" sortDescLabel="Sort Z → A"
                onSort={(d) => changeSort("status", d)} onClearSort={clearSort} menuRef={menuRef}>
                <div className="border-t px-3 py-2">
                  <div className="mb-1 font-semibold text-slate-600">Filter Status</div>
                  {(["", "false", "true"] as const).map((v) => (
                    <label key={v || "all"} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-slate-100">
                      <input
                        type="radio" name="inv-status-filter" checked={fInactive === v}
                        onChange={() => { setFInactive(v); setOpenMenu(null); applyNow({ inactive: v }); }}
                      />
                      <span>{v === "" ? "All" : v === "false" ? "Active" : "Inactive"}</span>
                    </label>
                  ))}
                </div>
              </InvHeader>
            </tr>
          </thead>
          <tbody>
            {(rows as ProductRow[]).map((r, i) => (
              <tr key={r.id || i} className="border-t">
                <td className="px-2 py-1 font-mono">{String(r.sku)}</td>
                <td className="px-2 py-1">{String(r.productNumber)}</td>
                <td className="px-2 py-1">{String(r.description)}</td>
                <td className="px-2 py-1">{String(r.vendor)}</td>
                <td className="px-2 py-1">{String(r.brand)}</td>
                <td className="px-2 py-1 text-right">{String(r.listCost)}</td>
                <td className="px-2 py-1 text-right">{String(r.price)}</td>
                <td className="px-2 py-1">{String(r.sizeDesc)}</td>
                <td className="px-2 py-1">
                  {/* Manual Active/Inactive override: saves one row at a time. */}
                  <span className="flex items-center gap-1.5">
                    <select
                      aria-label={`Status for ${r.sku}`}
                      value={r.isInactive ? "inactive" : "active"}
                      disabled={savingId === r.id || !r.id}
                      onChange={(e) => void updateStatus(r, e.target.value === "inactive")}
                      className={`rounded border px-1.5 py-0.5 text-xs font-medium disabled:opacity-60 ${
                        r.isInactive
                          ? "border-amber-300 bg-amber-50 text-amber-800"
                          : "border-emerald-300 bg-emerald-50 text-emerald-800"
                      }`}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                    {savingId === r.id && <Spinner />}
                  </span>
                </td>
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
      {showAddProduct && (
        <AddProductDialog
          busy={addProductBusy}
          onClose={() => { if (!addProductBusy) setShowAddProduct(false); }}
          onSubmit={addProduct}
        />
      )}
    </div>
  );
}

  // ==========================================
  // NEW UI MODE (Modernized layout)
  // ==========================================
  return (
    <div className="flex flex-col gap-5">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              All Inventory
            </h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700 dark:bg-zinc-800 dark:text-zinc-300">
              {total.toLocaleString()} products
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
            Master retail catalog database used for SKU matching, pricing rules, and digital store counts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowImportCard((v) => !v)}
            className={`rounded-lg border px-3.5 py-2 text-xs font-semibold shadow-2xs transition-colors ${
              showImportCard
                ? "border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950 dark:text-indigo-200"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            {showImportCard ? (
              <span className="inline-flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Close Import Panel
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import POS Inventory
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowAddProduct(true)}
            className="rounded-lg px-4 py-2 text-xs font-bold text-white shadow-xs hover:opacity-95"
            style={{ background: "var(--accent-primary, #4f46e5)" }}
          >
            + Add Product
          </button>
          <button
            type="button"
            onClick={() => setShowConfirmClear(true)}
            className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400"
            title="Safely clear inventory catalog"
          >
            Clear Catalog...
          </button>
        </div>
      </div>

      {/* Sync Metadata Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white p-3 text-xs shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-4 text-slate-600 dark:text-zinc-300">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span>
              Last POS Import: <strong className="text-slate-800 dark:text-white">{formatLastImported(lastImportedAt)}</strong>
            </span>
          </div>
          {lastUpdatedAt && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">•</span>
              <span>
                Last Modified: <strong className="text-slate-800 dark:text-white">{formatLastImported(lastUpdatedAt)}</strong>
              </span>
            </div>
          )}
        </div>
        <div className="text-[11px] text-slate-500 dark:text-zinc-400">
          Database: <span className="font-semibold text-slate-700 dark:text-zinc-300">PostgreSQL (1,000-row upsert batches)</span>
        </div>
      </div>

      {/* Import & Inactive SKU Panel (when expanded) */}
      {showImportCard && (
        <div className="flex flex-col gap-4 rounded-xl border border-indigo-200/80 bg-indigo-50/30 p-5 dark:border-indigo-900/60 dark:bg-indigo-950/20 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">POS Catalog Importer & Inactive SKU Tools</h2>
            <button
              type="button"
              onClick={() => setShowImportCard(false)}
              className="text-xs text-slate-500 hover:text-slate-800 dark:text-zinc-400"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {/* Box 1: Full POS Inventory */}
            <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div>
                <span className="font-bold text-xs text-slate-900 dark:text-white">1. POS Full Inventory File (Excel or CSV)</span>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">
                  Upload catalog export containing SKU, Description, Vendor, Brand, Cost, and Retail Price.
                </p>
                <div className="mt-3">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    disabled={importing}
                    onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }}
                    className="block w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-200 dark:file:bg-zinc-800 dark:file:text-zinc-200"
                  />
                </div>
                <label className="mt-3 flex items-start gap-2 text-[11px] text-slate-600 dark:text-zinc-400">
                  <input
                    type="checkbox"
                    checked={markMissingInactive}
                    disabled={importing}
                    onChange={(e) => setMarkMissingInactive(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Mark catalog products missing from this file as inactive (preserves historical price updates).</span>
                </label>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-zinc-800">
                <span className="text-[11px] text-slate-500">
                  {file ? `Ready: ${file.name}` : "Choose spreadsheet above"}
                </span>
                <LoadingButton
                  busy={importing}
                  busyLabel="Importing..."
                  stableWidth
                  onClick={runImport}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 dark:bg-white dark:text-slate-900"
                >
                  Import Inventory
                </LoadingButton>
              </div>
            </div>

            {/* Box 2: Inactive SKU Upload */}
            <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div>
                <span className="font-bold text-xs text-slate-900 dark:text-white">2. Inactive SKU List (Excel or CSV)</span>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">
                  Bulk mark products as inactive by uploading a list of discontinued SKUs. Inactive products are automatically excluded from store counts.
                </p>
                <div className="mt-3">
                  <input
                    ref={inactiveRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    disabled={importing}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadInactive(f); }}
                    className="block w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-amber-800 hover:file:bg-amber-200 dark:file:bg-amber-950 dark:file:text-amber-300"
                  />
                </div>
              </div>

              <div className="mt-4 text-[11px] text-slate-500 border-t border-slate-100 pt-3 dark:border-zinc-800">
                Uploaded SKUs immediately update without re-importing the full inventory catalog.
              </div>
            </div>
          </div>

          {msg && <div className="text-xs font-semibold text-slate-700 dark:text-zinc-300">{msg}</div>}
        </div>
      )}

      {/* Progress Bar during active import */}
      {progress && (
        <div className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm dark:border-indigo-900/50 dark:bg-zinc-900" role="status" aria-live="polite">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
            <span className="flex items-center gap-2 text-indigo-700 dark:text-indigo-400">
              <Spinner /> Processing Inventory Batches...
            </span>
            <span className="font-mono text-slate-700 dark:text-zinc-300">
              {progress.processed.toLocaleString()} / {progress.total.toLocaleString()} rows ({pct}%)
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600 dark:text-zinc-400">
            <span>Inserted: <strong className="text-emerald-600">{progress.inserted.toLocaleString()}</strong></span>
            <span>Updated: <strong className="text-blue-600">{progress.updated.toLocaleString()}</strong></span>
            <span>Skipped: <strong>{progress.skipped.toLocaleString()}</strong></span>
            <span>Failed: <strong className="text-red-600">{progress.failed.length.toLocaleString()}</strong></span>
            <span>Batch: {progress.batchIndex} of {progress.batchCount}</span>
          </div>
        </div>
      )}

      {/* Completion Report */}
      {report && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center justify-center ${report.status === "complete" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                {report.status === "complete" ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                )}
              </span>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                {report.status === "complete" ? "Inventory Import Complete" : "Import Stopped with Errors"}
              </h2>
            </div>
            <button className="text-xs text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setReport(null)}>
              Dismiss Report
            </button>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
            {report.processed.toLocaleString()} of {report.total.toLocaleString()} rows processed
            {report.finishedAt && report.startedAt ? ` in ${((report.finishedAt - report.startedAt) / 1000).toFixed(1)}s` : ""}
          </div>
          {report.error && <div className="mt-2 rounded bg-red-50 p-2.5 text-xs text-red-700">{report.error}</div>}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
              <div className="text-[11px] text-slate-500">File Total</div>
              <div className="mt-0.5 text-base font-bold text-slate-900 dark:text-white">{report.total.toLocaleString()}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-emerald-50/40 p-3 dark:border-zinc-800 dark:bg-emerald-950/20">
              <div className="text-[11px] text-emerald-800 dark:text-emerald-300">Inserted</div>
              <div className="mt-0.5 text-base font-bold text-emerald-700 dark:text-emerald-400">{report.inserted.toLocaleString()}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-blue-50/40 p-3 dark:border-zinc-800 dark:bg-blue-950/20">
              <div className="text-[11px] text-blue-800 dark:text-blue-300">Updated</div>
              <div className="mt-0.5 text-base font-bold text-blue-700 dark:text-blue-400">{report.updated.toLocaleString()}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
              <div className="text-[11px] text-slate-500">Skipped (no SKU)</div>
              <div className="mt-0.5 text-base font-bold text-slate-700 dark:text-zinc-300">{report.skipped.toLocaleString()}</div>
            </div>
          </div>
        </div>
      )}

      {/* Search and Filter Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-white p-3 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex min-w-64 flex-1 items-center gap-2 max-w-lg">
          <input
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/60 px-3 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            placeholder="Search SKU, product #, description, vendor, brand..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
          <button
            type="button"
            className="h-9 rounded-lg bg-slate-900 px-4 text-xs font-bold text-white shadow-xs hover:bg-slate-800 dark:bg-white dark:text-slate-900"
            onClick={search}
          >
            Search
          </button>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 text-xs">
          {(
            [
              ["", "All Products"],
              ["false", "Active Only"],
              ["true", "Inactive Only"],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => {
                setFInactive(val);
                applyNow({ inactive: val });
              }}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                fInactive === val
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Active Filter Chips */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold text-slate-600 dark:text-zinc-400">Active filters:</span>
          {fSku && <FilterChip label={`SKU: ${fSku}`} onClear={() => setFSku("")} onApply={() => applyNow({ sku: "" })} />}
          {fNum && <FilterChip label={`Product #: ${fNum}`} onClear={() => setFNum("")} onApply={() => applyNow({ num: "" })} />}
          {fDesc && <FilterChip label={`Desc: ${fDesc}`} onClear={() => setFDesc("")} onApply={() => applyNow({ desc: "" })} />}
          {fVendorContains && <FilterChip label={`Vendor: ${fVendorContains}`} onClear={() => setFVendorContains("")} onApply={() => applyNow({ vendorContains: "" })} />}
          {fBrandContains && <FilterChip label={`Brand: ${fBrandContains}`} onClear={() => setFBrandContains("")} onApply={() => applyNow({ brandContains: "" })} />}
          {fVendorExact && <FilterChip label={`Vendor = "${fVendorExact}"`} onClear={() => setFVendorExact("")} onApply={() => applyNow({ vendorExact: "" })} />}
          {fBrandExact && <FilterChip label={`Brand = "${fBrandExact}"`} onClear={() => setFBrandExact("")} onApply={() => applyNow({ brandExact: "" })} />}
          <button
            className="text-[11px] text-slate-500 hover:underline"
            onClick={() => {
              setFSku(""); setFNum(""); setFDesc("");
              setFVendorContains(""); setFBrandContains("");
              setFVendorExact(""); setFBrandExact(""); setFInactive("");
              applyNow({ sku: "", num: "", desc: "", vendorContains: "", brandContains: "", vendorExact: "", brandExact: "", inactive: "" });
            }}
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* Inventory Products Table */}
      <div className="flex flex-col rounded-xl border border-slate-200/90 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-300">
                <InvHeader
                  label="SKU" colKey="sku"
                  sortKey={sortKey} sortDir={sortDir} filtered={!!fSku}
                  openMenu={openMenu} onToggle={openColumnMenu}
                  onSort={(dir) => changeSort("sku", dir)} onClearSort={clearSort}
                  sortAscLabel="Sort SKU A to Z" sortDescLabel="Sort SKU Z to A"
                  menuRef={menuRef}
                >
                  <ColumnSearchBox label="Filter SKU" placeholder="e.g. 12345" value={fSku} onChange={setFSku} onApply={() => { setOpenMenu(null); applyNow({ sku: fSku }); }} onClear={() => { setFSku(""); applyNow({ sku: "" }); }} />
                </InvHeader>
                <InvHeader
                  label="Product Number" colKey="productNumber"
                  sortKey={sortKey} sortDir={sortDir} filtered={!!fNum}
                  openMenu={openMenu} onToggle={openColumnMenu}
                  onSort={(dir) => changeSort("productNumber", dir)} onClearSort={clearSort}
                  sortAscLabel="Sort Product # A to Z" sortDescLabel="Sort Product # Z to A"
                  menuRef={menuRef}
                >
                  <ColumnSearchBox label="Filter Product #" placeholder="e.g. PR-100" value={fNum} onChange={setFNum} onApply={() => { setOpenMenu(null); applyNow({ num: fNum }); }} onClear={() => { setFNum(""); applyNow({ num: "" }); }} />
                </InvHeader>
                <InvHeader
                  label="Description" colKey="description"
                  sortKey={sortKey} sortDir={sortDir} filtered={!!fDesc}
                  openMenu={openMenu} onToggle={openColumnMenu}
                  onSort={(dir) => changeSort("description", dir)} onClearSort={clearSort}
                  sortAscLabel="Sort Description A to Z" sortDescLabel="Sort Description Z to A"
                  menuRef={menuRef}
                >
                  <ColumnSearchBox label="Filter Description" placeholder="e.g. Vitamin C" value={fDesc} onChange={setFDesc} onApply={() => { setOpenMenu(null); applyNow({ desc: fDesc }); }} onClear={() => { setFDesc(""); applyNow({ desc: "" }); }} />
                </InvHeader>
                <InvHeader
                  label="Vendor" colKey="vendor"
                  sortKey={sortKey} sortDir={sortDir} filtered={!!fVendorContains || !!fVendorExact}
                  openMenu={openMenu} onToggle={openColumnMenu}
                  onSort={(dir) => changeSort("vendor", dir)} onClearSort={clearSort}
                  sortAscLabel="Sort Vendor A to Z" sortDescLabel="Sort Vendor Z to A"
                  menuRef={menuRef}
                >
                  <ColumnSearchBox label="Contains text" placeholder="e.g. Ecotrend" value={fVendorContains} onChange={setFVendorContains} onApply={() => { setOpenMenu(null); applyNow({ vendorContains: fVendorContains }); }} onClear={() => { setFVendorContains(""); applyNow({ vendorContains: "" }); }} />
                  <FacetList title="Match exact vendor" loading={facetLoading} rows={facetRows} search={facetQ} selected={fVendorExact} onSearch={(v) => { setFacetQ(v); void loadFacets("vendor", v); }} onPick={(v) => { const next = fVendorExact === v ? "" : v; setFVendorExact(next); setOpenMenu(null); applyNow({ vendorExact: next }); }} />
                </InvHeader>
                <InvHeader
                  label="Brand" colKey="brand"
                  sortKey={sortKey} sortDir={sortDir} filtered={!!fBrandContains || !!fBrandExact}
                  openMenu={openMenu} onToggle={openColumnMenu}
                  onSort={(dir) => changeSort("brand", dir)} onClearSort={clearSort}
                  sortAscLabel="Sort Brand A to Z" sortDescLabel="Sort Brand Z to A"
                  menuRef={menuRef}
                >
                  <ColumnSearchBox label="Contains text" placeholder="e.g. Provita" value={fBrandContains} onChange={setFBrandContains} onApply={() => { setOpenMenu(null); applyNow({ brandContains: fBrandContains }); }} onClear={() => { setFBrandContains(""); applyNow({ brandContains: "" }); }} />
                  <FacetList title="Match exact brand" loading={facetLoading} rows={facetRows} search={facetQ} selected={fBrandExact} onSearch={(v) => { setFacetQ(v); void loadFacets("brand", v); }} onPick={(v) => { const next = fBrandExact === v ? "" : v; setFBrandExact(next); setOpenMenu(null); applyNow({ brandExact: next }); }} />
                </InvHeader>
                <InvHeader
                  label="List Cost" colKey="listCost"
                  sortKey={sortKey} sortDir={sortDir} filtered={false}
                  openMenu={openMenu} onToggle={openColumnMenu}
                  onSort={(dir) => changeSort("listCost", dir)} onClearSort={clearSort}
                  sortAscLabel="Sort Low to High" sortDescLabel="Sort High to Low"
                  menuRef={menuRef}
                />
                <InvHeader
                  label="Price" colKey="price"
                  sortKey={sortKey} sortDir={sortDir} filtered={false}
                  openMenu={openMenu} onToggle={openColumnMenu}
                  onSort={(dir) => changeSort("price", dir)} onClearSort={clearSort}
                  sortAscLabel="Sort Low to High" sortDescLabel="Sort High to Low"
                  menuRef={menuRef}
                />
                <InvHeader
                  label="Size Desc" colKey="sizeDesc"
                  sortKey={sortKey} sortDir={sortDir} filtered={false}
                  openMenu={openMenu} onToggle={openColumnMenu}
                  onSort={(dir) => changeSort("sizeDesc", dir)} onClearSort={clearSort}
                  sortAscLabel="Sort A to Z" sortDescLabel="Sort Z to A"
                  menuRef={menuRef}
                />
                <InvHeader
                  label="Status" colKey="status"
                  sortKey={sortKey} sortDir={sortDir} filtered={!!fInactive}
                  openMenu={openMenu} onToggle={openColumnMenu}
                  onSort={(dir) => changeSort("status", dir)} onClearSort={clearSort}
                  sortAscLabel="Active first" sortDescLabel="Inactive first"
                  menuRef={menuRef}
                >
                  <div className="border-t border-slate-100 px-3 py-2 dark:border-zinc-700">
                    <div className="mb-1 font-semibold text-slate-700 dark:text-zinc-300">Filter Status</div>
                    {(
                      [
                        ["", "All products"],
                        ["false", "Active only"],
                        ["true", "Inactive only"],
                      ] as const
                    ).map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        className={`block w-full px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 ${fInactive === val ? "font-bold text-indigo-600 dark:text-indigo-400" : "text-slate-600 dark:text-zinc-300"}`}
                        onClick={() => {
                          setFInactive(val);
                          setOpenMenu(null);
                          applyNow({ inactive: val });
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </InvHeader>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
              {(rows as ProductRow[]).map((r, i) => (
                <tr key={r.id || i} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-zinc-800/40">
                  <td className="px-3 py-2 font-mono text-xs font-bold text-slate-900 dark:text-white">{r.sku}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-zinc-400">{r.productNumber || "—"}</td>
                  <td className="px-3 py-2 font-medium text-slate-800 dark:text-zinc-200">{r.description}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-zinc-300">
                    <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700 dark:bg-zinc-800 dark:text-zinc-300">
                      {r.vendor}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-zinc-300">{r.brand}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-900 dark:text-white">${r.listCost}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-slate-900 dark:text-white">${r.price}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-zinc-400">{r.sizeDesc || "—"}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <select
                        aria-label={`Status for ${r.sku}`}
                        value={r.isInactive ? "inactive" : "active"}
                        disabled={savingId === r.id}
                        onChange={(e) => void updateStatus(r, e.target.value === "inactive")}
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-bold shadow-2xs focus:outline-none disabled:opacity-60 ${
                          r.isInactive
                            ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                            : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        }`}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                      {savingId === r.id && <Spinner />}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-slate-500 dark:text-zinc-400">
                    No products found matching current criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="flex items-center justify-between border-t border-slate-100 p-3.5 dark:border-zinc-800">
          <span className="text-xs text-slate-500 dark:text-zinc-400">
            Showing Page <strong className="text-slate-800 dark:text-white">{page}</strong> (up to 100 per page)
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              onClick={() => setPage(page - 1)}
            >
              ← Previous
            </button>
            <button
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              onClick={() => setPage(page + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      {/* Add Product Modal */}
      {showAddProduct && (
        <AddProductDialog
          busy={addProductBusy}
          onClose={() => { if (!addProductBusy) setShowAddProduct(false); }}
          onSubmit={addProduct}
        />
      )}

      {/* Clear All Confirmation Modal */}
      {showConfirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-2xs p-4" role="dialog" aria-modal="true" aria-label="Confirm clear inventory">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:border dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/80 dark:text-red-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </span>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Clear All Master Inventory?</h2>
                <p className="text-xs text-slate-500 dark:text-zinc-400">
                  {total.toLocaleString()} catalog products will be deleted.
                </p>
              </div>
            </div>

            <p className="mt-4 text-xs text-slate-600 dark:text-zinc-300 leading-relaxed">
              This action removes all products from the main inventory. Historical price update sheets, saved notes, vendor discounts, and referral exports will remain intact. You will need to re-import a POS inventory file to match SKUs.
            </p>

            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                disabled={clearing}
                onClick={() => setShowConfirmClear(false)}
              >
                Cancel
              </button>
              <LoadingButton
                busy={clearing}
                busyLabel="Clearing catalog..."
                onClick={async () => {
                  await clearInventory();
                  setShowConfirmClear(false);
                }}
                className="rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-red-700"
              >
                Clear Inventory
              </LoadingButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
