"use client";
import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import { apiErrorText } from "@/lib/apiError";
import { LoadingButton } from "@/components/LoadingButton";
import { useToast, InlineSpinner } from "@/components/Toast";
import { useUiMode } from "@/contexts/UiModeContext";

type VendorRow = { id: string; vendor: string; defaultDiscount: string };
type BrandRow = { id: string; brand: string; vendor: string; defaultDiscount: string };

const norm = (v: string) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const numOf = (v: string) => {
  const n = Number(String(v ?? "").trim().replace(/[%$,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-900">
      {label}
      <button aria-label={`Clear filter ${label}`} className="rounded px-0.5 hover:bg-sky-200" onClick={onClear}>x</button>
    </span>
  );
}

type SuggestRow = { name: string; count: number };

function NameSuggest({ label, value, onPick, endpoint, kind, disabled }: {
  label: string; value: string; onPick: (v: string) => void;
  endpoint: string; kind: "vendor" | "brand"; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SuggestRow[]>([]);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
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
        const list: SuggestRow[] = (Array.isArray(d.rows) ? d.rows : []).map((x: { vendor?: string; brand?: string; count?: number }) => ({
          name: String(kind === "vendor" ? (x.vendor ?? "") : (x.brand ?? "")),
          count: Number(x.count ?? 0),
        })).filter((x: SuggestRow) => x.name);
        setRows(list);
      } catch { /* aborted or offline — keep previous */ }
    }, 250);
    return () => { c.abort(); clearTimeout(t); };
  }, [value, open, endpoint, kind]);
  return (
    <div ref={boxRef} className="relative">
      <input
        aria-label={label}
        className="rounded border px-2 py-1 disabled:opacity-60"
        value={value}
        disabled={disabled}
        onChange={(e) => { onPick(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={kind === "vendor" ? "e.g. Ecotrend" : "e.g. Provita"}
        required
      />
      {open && (
        <div className="absolute z-40 mt-1 max-h-56 w-64 overflow-auto rounded-lg border bg-white shadow-lg">
          {rows.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-500">No match — your typed {kind} will be used as-is.</div>
          )}
          {rows.map((r) => (
            <button
              key={r.name}
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-100"
              onMouseDown={(e) => { e.preventDefault(); onPick(r.name); setOpen(false); }}
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


export default function VendorsPage() {
  const toast = useToast();
  const { mode } = useUiMode();
  const [activeFormTab, setActiveFormTab] = useState<"vendor" | "brand">("vendor");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<VendorRow[]>([]);
  const [brandRows, setBrandRows] = useState<BrandRow[]>([]);
  const [vendor, setVendor] = useState("");
  const [discount, setDiscount] = useState("");
  const [brand, setBrand] = useState("");
  const [brandVendor, setBrandVendor] = useState("");
  const [brandDiscount, setBrandDiscount] = useState("");
  const [editing, setEditing] = useState<{ kind: "vendor" | "brand"; id: string } | null>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingBrand, setSavingBrand] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<"name" | "discount" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [fVendor, setFVendor] = useState("");
  const [fBrand, setFBrand] = useState("");
  const [fDiscount, setFDiscount] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

  const fetchAll = useCallback(async (query: string, showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const [rv, rb] = await Promise.all([
        fetch(`/api/vendors?q=${encodeURIComponent(query)}`),
        fetch(`/api/vendors/brands?q=${encodeURIComponent(query)}`),
      ]);
      const dv = await rv.json().catch(() => ({}));
      const db = await rb.json().catch(() => ({}));
      if (!rv.ok) { setMsg(apiErrorText(dv, "Could not load vendor discounts.")); setRows([]); }
      else { setMsg(""); setRows(dv.rows ?? []); }
      setBrandRows(rb.ok ? (db.rows ?? []) : []);
    } catch {
      setMsg("Could not reach the server. Check your connection and try again.");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenMenu(null); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [openMenu]);

  // Initial load. The setState calls happen in the fetch callbacks, not
  // synchronously in the effect body.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [rv, rb] = await Promise.all([
          fetch(`/api/vendors?q=`),
          fetch(`/api/vendors/brands?q=`),
        ]);
        const dv = await rv.json().catch(() => ({}));
        const db = await rb.json().catch(() => ({}));
        if (!active) return;
        if (!rv.ok) { setMsg(apiErrorText(dv, "Could not load vendor discounts.")); setRows([]); }
        else { setMsg(""); setRows(dv.rows ?? []); }
        if (!active) return;
        setBrandRows(rb.ok ? (db.rows ?? []) : []);
      } catch {
        if (active) setMsg("Could not reach the server. Check your connection and try again.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  const search = () => { void fetchAll(q, true); };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMsg("");
    try {
      const r = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor, defaultDiscount: discount || "0" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, "Could not save the vendor discount.");
        setMsg(t);
        toast.error("Could not save the vendor discount.", t);
        return;
      }
      // Clear inputs and refresh the table automatically after a successful save.
      setVendor(""); setDiscount(""); setEditing(null);
      toast.success("Vendor discount saved.", vendor);
      await fetchAll(q);
    } catch {
      toast.error("Could not save the vendor discount.", "Could not reach the server while saving.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      const r = await fetch(`/api/vendors?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, "Could not delete the vendor discount.");
        setMsg(t);
        toast.error("Could not delete the vendor discount.", t);
        return;
      }
      toast.success("Vendor discount deleted.", name);
      await fetchAll(q);
    } catch {
      toast.error("Could not delete the vendor discount.", "Could not reach the server while deleting.");
    } finally {
      setDeletingId(null);
    }
  };

  const removeBrand = async (id: string, name: string) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      const r = await fetch(`/api/vendors/brands?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, "Could not delete the brand discount.");
        setMsg(t);
        toast.error("Could not delete the brand discount.", t);
        return;
      }
      toast.success("Brand discount deleted.", name);
      await fetchAll(q);
    } catch {
      toast.error("Could not delete the brand discount.", "Could not reach the server while deleting.");
    } finally {
      setDeletingId(null);
    }
  };

  const saveBrand = async () => {
    if (savingBrand) return;
    setSavingBrand(true);
    setMsg("");
    try {
      const r = await fetch("/api/vendors/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editing?.kind === "brand" ? editing.id : undefined, brand, vendor: brandVendor, defaultDiscount: brandDiscount || "0" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, "Could not save the brand discount.");
        setMsg(t);
        toast.error("Could not save the brand discount.", t);
        return;
      }
      setBrand(""); setBrandVendor(""); setBrandDiscount(""); setEditing(null);
      toast.success("Brand discount saved.", `${brand} / ${brandVendor}`);
      await fetchAll(q);
    } catch {
      toast.error("Could not save the brand discount.", "Could not reach the server while saving.");
    } finally {
      setSavingBrand(false);
    }
  };

  const groups = useMemo(() => {
    const byVendor = new Map<string, { vendor: VendorRow | null; brands: BrandRow[] }>();
    for (const v of rows) byVendor.set(norm(v.vendor), { vendor: v, brands: [] });
    for (const b of brandRows) {
      const k = norm(b.vendor);
      const g = byVendor.get(k);
      if (g) g.brands.push(b);
      else byVendor.set(k, { vendor: null, brands: [b] });
    }
    let list = [...byVendor.values()].map((g) => ({
      vendor: g.vendor,
      brands: [...g.brands].sort((a, b) => a.brand.localeCompare(b.brand)),
    }));
    const fv = fVendor.trim().toLowerCase();
    const fb = fBrand.trim().toLowerCase();
    const fd = fDiscount.trim().replace(/[%$,]/g, "");
    if (fv) {
      const vHit = (name: string) => name.toLowerCase().includes(fv);
      list = list
        .map((g) => ({
          vendor: g.vendor,
          // A matching vendor keeps its whole group; otherwise keep only
          // brand rows whose linked vendor matches.
          brands: g.vendor && vHit(g.vendor.vendor) ? g.brands : g.brands.filter((b) => vHit(b.vendor)),
          keep: (!!g.vendor && vHit(g.vendor.vendor)) || g.brands.some((b) => vHit(b.vendor)),
        }))
        .filter((g) => g.keep)
        .map((g) => ({ vendor: g.vendor, brands: g.brands }));
    }
    if (fb) {
      list = list
        .map((g) => ({ vendor: g.vendor, brands: g.brands.filter((b) => b.brand.toLowerCase().includes(fb)) }))
        .filter((g) => g.brands.length > 0);
    }
    if (fd) {
      const dHit = (d: string) => String(d).includes(fd);
      list = list
        .map((g) => ({
          vendor: null as VendorRow | null,
          brands: g.brands.filter((b) => dHit(b.defaultDiscount)),
          keepV: !!g.vendor && dHit(g.vendor.defaultDiscount),
          keepVendor: g.vendor,
        }))
        .filter((g) => g.keepV || g.brands.length > 0)
        .map((g) => ({ vendor: g.keepV ? g.keepVendor : null, brands: g.brands }));
    }
    if (sortKey && sortDir) {
      const mul = sortDir === "asc" ? 1 : -1;
      list.sort((a, b) => {
        if (sortKey === "name") return (a.vendor?.vendor ?? a.brands[0]?.vendor ?? "").localeCompare(b.vendor?.vendor ?? b.brands[0]?.vendor ?? "") * mul;
        const an = numOf(a.vendor?.defaultDiscount ?? a.brands[0]?.defaultDiscount ?? "") ?? 0;
        const bn = numOf(b.vendor?.defaultDiscount ?? b.brands[0]?.defaultDiscount ?? "") ?? 0;
        return (an - bn) * mul;
      });
      for (const g of list) {
        if (sortKey === "name") g.brands.sort((a, b) => a.brand.localeCompare(b.brand) * mul);
        else {
          const av = (x: BrandRow) => numOf(x.defaultDiscount) ?? 0;
          g.brands.sort((a, b) => (av(a) - av(b)) * mul);
        }
      }
    } else {
      list.sort((a, b) => (a.vendor?.vendor ?? a.brands[0]?.vendor ?? "").localeCompare(b.vendor?.vendor ?? b.brands[0]?.vendor ?? ""));
    }
    return list;
  }, [rows, brandRows, fVendor, fBrand, fDiscount, sortKey, sortDir]);

  const activeFilters: { label: string; clear: () => void }[] = [];
  if (fVendor.trim()) activeFilters.push({ label: `Vendor: ${fVendor.trim()}`, clear: () => setFVendor("") });
  if (fBrand.trim()) activeFilters.push({ label: `Brand: ${fBrand.trim()}`, clear: () => setFBrand("") });
  if (fDiscount.trim()) activeFilters.push({ label: `Discount: ${fDiscount.trim()}`, clear: () => setFDiscount("") });
  if (q.trim()) activeFilters.push({ label: `Search: ${q.trim()}`, clear: () => { setQ(""); void fetchAll(""); } });

  const startVendorEdit = (r: VendorRow) => {
    setEditing({ kind: "vendor", id: r.id });
    setVendor(r.vendor); setDiscount(String(r.defaultDiscount));
  };
  const startBrandEdit = (r: BrandRow) => {
    setEditing({ kind: "brand", id: r.id });
    setBrand(r.brand); setBrandVendor(r.vendor); setBrandDiscount(String(r.defaultDiscount));
  };
  const cancelEditing = () => {
    setEditing(null);
    setVendor(""); setDiscount(""); setBrand(""); setBrandVendor(""); setBrandDiscount("");
  };

  // ==========================================
  // CLASSIC UI MODE (Preserved pixel-perfect)
  // ==========================================
  if (mode === "classic") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Vendor Discounts</h1>
        <div className="flex gap-2">
          <input className="w-full max-w-md rounded border px-3 py-2 disabled:opacity-60" placeholder="Search vendors..." disabled={loading || saving} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
          <LoadingButton busy={loading} busyLabel="Searching..." onClick={search} className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60">
            Search
          </LoadingButton>
        </div>
        {msg && <div className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{msg}</div>}
        {loading && <InlineSpinner label="Loading vendor discounts..." />}
        <form
          className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await save();
          }}
        >
          <label className="flex flex-col text-sm">Vendor
            <NameSuggest label="Vendor" value={vendor} onPick={setVendor} endpoint="/api/vendors/options" kind="vendor" disabled={saving} />
          </label>
          <datalist id="vendor-discount-vendors">
            {rows.map((r) => <option key={r.id} value={r.vendor} />)}
          </datalist>
          <label className="flex flex-col text-sm">Default Discount (%)<input className="rounded border px-2 py-1 disabled:opacity-60" value={discount} disabled={saving} onChange={(e) => setDiscount(e.target.value)} placeholder="10" /></label>
          <LoadingButton type="submit" busy={saving} busyLabel="Saving..." className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60">
            Add / Update
          </LoadingButton>
          {editing?.kind === "vendor" && (
            <button type="button" className="rounded border px-3 py-2 text-sm" onClick={cancelEditing}>Cancel edit</button>
          )}
        </form>
        <form
          className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await saveBrand();
          }}
        >
          <label className="flex flex-col text-sm">Brand
            <NameSuggest label="Brand" value={brand} onPick={setBrand} endpoint="/api/vendors/brands/options" kind="brand" disabled={savingBrand} />
          </label>
          <datalist id="brand-discount-brands">
            {[...new Set(brandRows.map((b) => b.brand))].sort((a, b) => a.localeCompare(b)).map((b) => <option key={b} value={b} />)}
          </datalist>
          <label className="flex flex-col text-sm">Vendor (link the brand to a vendor)
            <NameSuggest label="Vendor" value={brandVendor} onPick={setBrandVendor} endpoint="/api/vendors/options" kind="vendor" disabled={savingBrand} />
          </label>
          <label className="flex flex-col text-sm">Default Discount (%)<input className="rounded border px-2 py-1 disabled:opacity-60" value={brandDiscount} disabled={savingBrand} onChange={(e) => setBrandDiscount(e.target.value)} placeholder="5" /></label>
          <LoadingButton type="submit" busy={savingBrand} busyLabel="Saving..." className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60">
            Add / Update
          </LoadingButton>
          {editing?.kind === "brand" && (
            <button type="button" className="rounded border px-3 py-2 text-sm" onClick={cancelEditing}>Cancel edit</button>
          )}
        </form>
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-600">Active filters:</span>
            {activeFilters.map((f) => <FilterChip key={f.label} label={f.label} onClear={f.clear} />)}
            <button
              className="rounded border px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-100"
              onClick={() => { setFVendor(""); setFBrand(""); setFDiscount(""); setQ(""); void fetchAll(""); }}
            >
              Clear all
            </button>
          </div>
        )}
        <div className="overflow-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left">
                <th className="relative px-4 py-2">
                  <span className="inline-flex items-center gap-1">
                    Vendor / Brand
                    {sortKey === "name" && sortDir && <span aria-hidden="true">{sortDir === "asc" ? "A" : "Z"}</span>}
                    <button type="button" aria-label="Sort Vendor / Brand" className="rounded px-1 text-slate-500 hover:bg-slate-200" onClick={() => setOpenMenu(openMenu === "name" ? null : "name")}>v</button>
                  </span>
                  {openMenu === "name" && (
                    <div ref={menuRef} role="menu" aria-label="Sort Vendor / Brand" className="absolute left-0 top-full z-30 min-w-60 rounded-lg border bg-white py-1 text-xs font-normal shadow-lg">
                      <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-100" onClick={() => { setSortKey("name"); setSortDir("asc"); setOpenMenu(null); }}>Sort A to Z</button>
                      <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-100" onClick={() => { setSortKey("name"); setSortDir("desc"); setOpenMenu(null); }}>Sort Z to A</button>
                      <button type="button" className="block w-full px-3 py-1.5 text-left text-slate-500 hover:bg-slate-100" onClick={() => { setSortKey(null); setSortDir(null); setOpenMenu(null); }}>Clear sort</button>
                      <div className="border-t px-3 py-2">
                        <label className="mb-1 block font-semibold">Filter Vendor</label>
                        <input className="w-full rounded border px-2 py-1" placeholder="Search vendor..." value={fVendor} onChange={(e) => setFVendor(e.target.value)} />
                      </div>
                      <div className="border-t px-3 py-2">
                        <label className="mb-1 block font-semibold">Filter Brand</label>
                        <input className="w-full rounded border px-2 py-1" placeholder="Search brand..." value={fBrand} onChange={(e) => setFBrand(e.target.value)} />
                      </div>
                    </div>
                  )}
                </th>
                <th className="relative px-4 py-2">
                  <span className="inline-flex items-center gap-1">
                    Default Discount
                    {sortKey === "discount" && sortDir && <span aria-hidden="true">{sortDir === "asc" ? "lo" : "hi"}</span>}
                    <button type="button" aria-label="Sort Default Discount" className="rounded px-1 text-slate-500 hover:bg-slate-200" onClick={() => setOpenMenu(openMenu === "discount" ? null : "discount")}>v</button>
                  </span>
                  {openMenu === "discount" && (
                    <div ref={menuRef} role="menu" aria-label="Sort Default Discount" className="absolute left-0 top-full z-30 min-w-60 rounded-lg border bg-white py-1 text-xs font-normal shadow-lg">
                      <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-100" onClick={() => { setSortKey("discount"); setSortDir("asc"); setOpenMenu(null); }}>Sort Smallest to Largest</button>
                      <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-100" onClick={() => { setSortKey("discount"); setSortDir("desc"); setOpenMenu(null); }}>Sort Largest to Smallest</button>
                      <button type="button" className="block w-full px-3 py-1.5 text-left text-slate-500 hover:bg-slate-100" onClick={() => { setSortKey(null); setSortDir(null); setOpenMenu(null); }}>Clear sort</button>
                      <div className="border-t px-3 py-2">
                        <label className="mb-1 block font-semibold">Filter Discount</label>
                        <input className="w-full rounded border px-2 py-1" placeholder="e.g. 10" value={fDiscount} onChange={(e) => setFDiscount(e.target.value)} />
                      </div>
                    </div>
                  )}
                </th>
                <th className="px-4 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.vendor?.id ?? `novendor:${norm(g.brands[0]?.vendor ?? "")}`}>
                  {g.vendor ? (
                    <tr key={g.vendor.id} className="border-t bg-slate-50 font-semibold">
                      <td className="px-4 py-2">{g.vendor.vendor}</td>
                      <td className="px-4 py-2">{g.vendor.defaultDiscount}%</td>
                      <td className="px-4 py-2 text-right">
                        <button disabled={!!deletingId} onClick={() => startVendorEdit(g.vendor!)} className="mr-3 text-xs text-blue-700 underline disabled:opacity-40">Edit</button>
                        <button disabled={!!deletingId} onClick={() => remove(g.vendor!.id, g.vendor!.vendor)} className="text-xs text-red-600 underline disabled:opacity-40">
                          {deletingId === g.vendor!.id ? "Deleting..." : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={`novendor:${norm(g.brands[0]?.vendor ?? "")}`} className="border-t bg-slate-50 font-semibold">
                      <td className="px-4 py-2">{g.brands[0]?.vendor} <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">no vendor default</span></td>
                      <td className="px-4 py-2 text-slate-400">-</td>
                      <td className="px-4 py-2" />
                    </tr>
                  )}
                  {g.brands.map((b) => (
                    <tr key={b.id} className="border-t border-slate-100 bg-white">
                      <td className="px-4 py-2 pl-8 text-slate-700">{b.brand}</td>
                      <td className="px-4 py-2 text-slate-700">{b.defaultDiscount}%</td>
                      <td className="px-4 py-2 text-right">
                        <button disabled={!!deletingId} onClick={() => startBrandEdit(b)} className="mr-3 text-xs text-blue-700 underline disabled:opacity-40">Edit</button>
                        <button disabled={!!deletingId} onClick={() => removeBrand(b.id, `${b.brand} / ${b.vendor}`)} className="text-xs text-red-600 underline disabled:opacity-40">
                          {deletingId === b.id ? "Deleting..." : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              {groups.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-500">No discounts found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ==========================================
  // NEW UI MODE (Modernized layout)
  // ==========================================
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              Vendor Discounts & Brand Rules
            </h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700 dark:bg-zinc-800 dark:text-zinc-300">
              {rows.length} Vendors • {brandRows.length} Brand Overrides
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
            Define default vendor discounts and brand-specific overrides applied across all price worksheets and calculations.
          </p>
        </div>
      </div>

      {msg && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {msg}
        </div>
      )}

      {/* Add / Edit Form Card with Tabs */}
      <div className="flex flex-col rounded-xl border border-slate-200/90 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
        <div className="flex border-b border-slate-100 bg-slate-50/50 p-1.5 dark:border-zinc-800 dark:bg-zinc-800/40">
          <button
            type="button"
            onClick={() => { setActiveFormTab("vendor"); if (editing?.kind === "brand") cancelEditing(); }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
              activeFormTab === "vendor"
                ? "bg-white text-slate-900 shadow-xs dark:bg-zinc-800 dark:text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
            }`}
          >
            <svg className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            Vendor Default Discount
          </button>
          <button
            type="button"
            onClick={() => { setActiveFormTab("brand"); if (editing?.kind === "vendor") cancelEditing(); }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
              activeFormTab === "brand"
                ? "bg-white text-slate-900 shadow-xs dark:bg-zinc-800 dark:text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
            }`}
          >
            <svg className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            Brand-Specific Override
          </button>
        </div>

        <div className="p-4">
          {activeFormTab === "vendor" ? (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                await save();
              }}
            >
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-700 dark:text-zinc-300">
                Vendor Name
                <NameSuggest label="Vendor" value={vendor} onPick={setVendor} endpoint="/api/vendors/options" kind="vendor" disabled={saving} />
              </label>
              <datalist id="vendor-discount-vendors">
                {rows.map((r) => <option key={r.id} value={r.vendor} />)}
              </datalist>

              <label className="flex flex-col gap-1 text-xs font-medium text-slate-700 dark:text-zinc-300">
                Default Discount (%)
                <div className="relative">
                  <input
                    className="h-8.5 rounded-lg border border-slate-200 bg-slate-50/50 pl-2.5 pr-6 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    value={discount}
                    disabled={saving}
                    onChange={(e) => setDiscount(e.target.value)}
                    placeholder="e.g. 15"
                  />
                  <span className="absolute inset-y-0 right-0 flex items-center pr-2 text-xs text-slate-400">%</span>
                </div>
              </label>

              <LoadingButton
                type="submit"
                busy={saving}
                busyLabel="Saving..."
                className="h-8.5 rounded-lg bg-slate-900 px-4 text-xs font-bold text-white shadow-xs hover:bg-slate-800 dark:bg-white dark:text-slate-900"
              >
                {editing?.kind === "vendor" ? "Update Vendor Discount" : "+ Add Vendor Discount"}
              </LoadingButton>

              {editing?.kind === "vendor" && (
                <button
                  type="button"
                  className="h-8.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300"
                  onClick={cancelEditing}
                >
                  Cancel Edit
                </button>
              )}
            </form>
          ) : (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                await saveBrand();
              }}
            >
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-700 dark:text-zinc-300">
                Brand Name
                <NameSuggest label="Brand" value={brand} onPick={setBrand} endpoint="/api/vendors/brands/options" kind="brand" disabled={savingBrand} />
              </label>
              <datalist id="brand-discount-brands">
                {[...new Set(brandRows.map((b) => b.brand))].sort((a, b) => a.localeCompare(b)).map((b) => <option key={b} value={b} />)}
              </datalist>

              <label className="flex flex-col gap-1 text-xs font-medium text-slate-700 dark:text-zinc-300">
                Parent Vendor
                <NameSuggest label="Vendor" value={brandVendor} onPick={setBrandVendor} endpoint="/api/vendors/options" kind="vendor" disabled={savingBrand} />
              </label>

              <label className="flex flex-col gap-1 text-xs font-medium text-slate-700 dark:text-zinc-300">
                Brand Discount (%)
                <div className="relative">
                  <input
                    className="h-8.5 rounded-lg border border-slate-200 bg-slate-50/50 pl-2.5 pr-6 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    value={brandDiscount}
                    disabled={savingBrand}
                    onChange={(e) => setBrandDiscount(e.target.value)}
                    placeholder="e.g. 20"
                  />
                  <span className="absolute inset-y-0 right-0 flex items-center pr-2 text-xs text-slate-400">%</span>
                </div>
              </label>

              <LoadingButton
                type="submit"
                busy={savingBrand}
                busyLabel="Saving..."
                className="h-8.5 rounded-lg bg-slate-900 px-4 text-xs font-bold text-white shadow-xs hover:bg-slate-800 dark:bg-white dark:text-slate-900"
              >
                {editing?.kind === "brand" ? "Update Brand Override" : "+ Add Brand Override"}
              </LoadingButton>

              {editing?.kind === "brand" && (
                <button
                  type="button"
                  className="h-8.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300"
                  onClick={cancelEditing}
                >
                  Cancel Edit
                </button>
              )}
            </form>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-white p-3 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-1 items-center gap-2 max-w-md">
          <input
            className="h-8.5 w-full rounded-lg border border-slate-200 bg-slate-50/60 px-3 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            placeholder="Search vendors..."
            disabled={loading || saving}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
          <LoadingButton
            busy={loading}
            busyLabel="Searching..."
            onClick={search}
            className="h-8.5 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white shadow-xs hover:bg-slate-800 dark:bg-white dark:text-slate-900"
          >
            Search
          </LoadingButton>
        </div>

        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {activeFilters.map((f) => (
              <FilterChip key={f.label} label={f.label} onClear={f.clear} />
            ))}
            <button
              className="text-[11px] text-slate-500 hover:underline"
              onClick={() => { setFVendor(""); setFBrand(""); setFDiscount(""); setQ(""); void fetchAll(""); }}
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {loading && <InlineSpinner label="Loading vendor discounts..." />}

      {/* Hierarchy Table */}
      <div className="overflow-auto rounded-xl border border-slate-200/90 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-300">
              <th className="relative px-5 py-3">
                <span className="inline-flex items-center gap-1">
                  Vendor / Brand
                  {sortKey === "name" && sortDir && <span aria-hidden="true">{sortDir === "asc" ? " (A-Z)" : " (Z-A)"}</span>}
                  <button
                    type="button"
                    aria-label="Sort Vendor / Brand"
                    className="rounded px-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-zinc-700"
                    onClick={() => setOpenMenu(openMenu === "name" ? null : "name")}
                  >
                    ▾
                  </button>
                </span>
                {openMenu === "name" && (
                  <div
                    ref={menuRef}
                    role="menu"
                    aria-label="Sort Vendor / Brand"
                    className="absolute left-0 top-full z-30 min-w-60 rounded-xl border border-slate-200 bg-white py-1.5 text-xs font-normal shadow-xl dark:border-zinc-700 dark:bg-zinc-800"
                  >
                    <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-700" onClick={() => { setSortKey("name"); setSortDir("asc"); setOpenMenu(null); }}>Sort A to Z</button>
                    <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-700" onClick={() => { setSortKey("name"); setSortDir("desc"); setOpenMenu(null); }}>Sort Z to A</button>
                    <button type="button" className="block w-full px-3 py-1.5 text-left text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-700" onClick={() => { setSortKey(null); setSortDir(null); setOpenMenu(null); }}>Clear sort</button>
                    <div className="border-t border-slate-100 px-3 py-2 dark:border-zinc-700">
                      <label className="mb-1 block font-semibold text-[11px]">Filter Vendor</label>
                      <input className="w-full rounded border px-2 py-1 text-xs dark:bg-zinc-900" placeholder="Search vendor..." value={fVendor} onChange={(e) => setFVendor(e.target.value)} />
                    </div>
                    <div className="border-t border-slate-100 px-3 py-2 dark:border-zinc-700">
                      <label className="mb-1 block font-semibold text-[11px]">Filter Brand</label>
                      <input className="w-full rounded border px-2 py-1 text-xs dark:bg-zinc-900" placeholder="Search brand..." value={fBrand} onChange={(e) => setFBrand(e.target.value)} />
                    </div>
                  </div>
                )}
              </th>
              <th className="relative px-5 py-3">
                <span className="inline-flex items-center gap-1">
                  Default Discount
                  {sortKey === "discount" && sortDir && <span aria-hidden="true">{sortDir === "asc" ? " (Low-High)" : " (High-Low)"}</span>}
                  <button
                    type="button"
                    aria-label="Sort Default Discount"
                    className="rounded px-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-zinc-700"
                    onClick={() => setOpenMenu(openMenu === "discount" ? null : "discount")}
                  >
                    ▾
                  </button>
                </span>
                {openMenu === "discount" && (
                  <div
                    ref={menuRef}
                    role="menu"
                    aria-label="Sort Default Discount"
                    className="absolute left-0 top-full z-30 min-w-60 rounded-xl border border-slate-200 bg-white py-1.5 text-xs font-normal shadow-xl dark:border-zinc-700 dark:bg-zinc-800"
                  >
                    <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-700" onClick={() => { setSortKey("discount"); setSortDir("asc"); setOpenMenu(null); }}>Sort Smallest to Largest</button>
                    <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-700" onClick={() => { setSortKey("discount"); setSortDir("desc"); setOpenMenu(null); }}>Sort Largest to Smallest</button>
                    <button type="button" className="block w-full px-3 py-1.5 text-left text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-700" onClick={() => { setSortKey(null); setSortDir(null); setOpenMenu(null); }}>Clear sort</button>
                    <div className="border-t border-slate-100 px-3 py-2 dark:border-zinc-700">
                      <label className="mb-1 block font-semibold text-[11px]">Filter Discount</label>
                      <input className="w-full rounded border px-2 py-1 text-xs dark:bg-zinc-900" placeholder="e.g. 10" value={fDiscount} onChange={(e) => setFDiscount(e.target.value)} />
                    </div>
                  </div>
                )}
              </th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
            {groups.map((g) => (
              <Fragment key={g.vendor?.id ?? `novendor:${norm(g.brands[0]?.vendor ?? "")}`}>
                {g.vendor ? (
                  <tr key={g.vendor.id} className="bg-slate-50/70 font-semibold dark:bg-zinc-800/40">
                    <td className="px-5 py-3 text-slate-900 dark:text-white">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-slate-400 dark:text-zinc-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        <span>{g.vendor.vendor}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 text-xs font-bold text-indigo-700 dark:bg-indigo-950 dark:border-indigo-800 dark:text-indigo-300">
                        {g.vendor.defaultDiscount}%
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          disabled={!!deletingId}
                          onClick={() => { startVendorEdit(g.vendor!); setActiveFormTab("vendor"); }}
                          className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                        >
                          Edit
                        </button>
                        <button
                          disabled={!!deletingId}
                          onClick={() => remove(g.vendor!.id, g.vendor!.vendor)}
                          className="rounded border border-red-200 bg-red-50/60 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
                        >
                          {deletingId === g.vendor!.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={`novendor:${norm(g.brands[0]?.vendor ?? "")}`} className="bg-slate-50/70 font-semibold dark:bg-zinc-800/40">
                    <td className="px-5 py-3 text-slate-900 dark:text-white">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-slate-400 dark:text-zinc-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        <span>{g.brands[0]?.vendor}</span>
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          No Vendor Default Set
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-400">—</td>
                    <td className="px-5 py-3 text-right" />
                  </tr>
                )}
                {g.brands.map((b) => (
                  <tr key={b.id} className="transition-colors hover:bg-slate-50/50 dark:hover:bg-zinc-800/30">
                    <td className="px-5 py-2.5 pl-12 text-slate-700 dark:text-zinc-300">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">└─</span>
                        <span className="font-medium">{b.brand}</span>
                      </div>
                    </td>
                    <td className="px-5 py-2.5">
                      <span className="inline-flex rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-300">
                        {b.defaultDiscount}% override
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          disabled={!!deletingId}
                          onClick={() => { startBrandEdit(b); setActiveFormTab("brand"); }}
                          className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        >
                          Edit
                        </button>
                        <button
                          disabled={!!deletingId}
                          onClick={() => removeBrand(b.id, `${b.brand} / ${b.vendor}`)}
                          className="rounded border border-red-200 bg-red-50/60 px-2 py-0.5 text-xs text-red-600 hover:bg-red-100 disabled:opacity-40 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
                        >
                          {deletingId === b.id ? "..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {groups.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-8 text-center text-slate-600 dark:text-zinc-300">
                  No discounts found. Add your first vendor discount above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
