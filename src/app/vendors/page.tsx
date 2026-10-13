"use client";
import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import { apiErrorText } from "@/lib/apiError";
import { LoadingButton } from "@/components/LoadingButton";
import { useToast, InlineSpinner } from "@/components/Toast";

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
