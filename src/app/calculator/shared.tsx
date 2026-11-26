"use client";
import { useEffect, useState } from "react";
import { apiErrorText } from "@/lib/apiError";
import { buildDiscountMaps } from "@/lib/calculator";
import { discountSourceLabel } from "@/lib/calculator";
import type { DiscountSource, RoundingMethod } from "@/lib/calculator";

export type VendorOpt = { vendor: string; discount: string };
export type BrandOpt = { vendor: string; brand: string; discount: string };
export type DiscountState = {
  vendorMap: Map<string, string>;
  brandMap: Map<string, string>;
  vendors: VendorOpt[];
  brands: BrandOpt[];
};

export const ROUND_OPTS: { v: RoundingMethod; label: string }[] = [
  { v: "nearest9", label: "Nearest $_.X9 (worksheet)" },
  { v: "99", label: "Nearest $0.99" },
  { v: "95", label: "Nearest $0.95" },
  { v: "exact", label: "Exact cents" },
];

export function numOk(v: string, min: number, max: number): boolean {
  const n = Number(String(v).replace(/[$,%]/g, "").trim());
  return Number.isFinite(n) && n >= min && n <= max;
}

export function Section(p: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-base font-bold text-slate-900 dark:text-white">{p.title}</h2>
      {p.sub && <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">{p.sub}</p>}
      <div className="mt-4">{p.children}</div>
    </section>
  );
}

export function Field(p: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700 dark:text-zinc-300">{p.label}</span>
      {p.children}
      {p.hint && <span className="text-xs text-slate-500 dark:text-zinc-400">{p.hint}</span>}
    </label>
  );
}

export const inputCls =
  "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-indigo-400";

export function SourceBadge(p: { source: DiscountSource }) {
  const c =
    p.source === "brand"
      ? "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300"
      : p.source === "vendor"
        ? "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
        : p.source === "manual"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
          : "bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c}`}>
      {discountSourceLabel(p.source)}
    </span>
  );
}

export function useDiscountData() {
  const [data, setData] = useState<DiscountState>({
    vendorMap: new Map(),
    brandMap: new Map(),
    vendors: [],
    brands: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/calculator/discounts");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(apiErrorText(d, "Could not load discounts."));
      const vendors: VendorOpt[] = Array.isArray(d.vendors) ? d.vendors : [];
      const brands: BrandOpt[] = Array.isArray(d.brands) ? d.brands : [];
      const maps = buildDiscountMaps(
        vendors.map((x) => ({ vendor: x.vendor, discount: x.discount })),
        brands.map((x) => ({ vendor: x.vendor, brand: x.brand, discount: x.discount })),
      );
      setData({ vendors, brands, vendorMap: maps.vendors, brandMap: maps.brands });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load discounts.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    // Promise-chain form (same as Shell's session fetch): setState happens in
    // the fetch callbacks, never synchronously in the effect body.
    fetch("/api/calculator/discounts")
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(apiErrorText(d, "Could not load discounts."));
        const vendors: VendorOpt[] = Array.isArray(d.vendors) ? d.vendors : [];
        const brands: BrandOpt[] = Array.isArray(d.brands) ? d.brands : [];
        const maps = buildDiscountMaps(
          vendors.map((x) => ({ vendor: x.vendor, discount: x.discount })),
          brands.map((x) => ({ vendor: x.vendor, brand: x.brand, discount: x.discount })),
        );
        setData({ vendors, brands, vendorMap: maps.vendors, brandMap: maps.brands });
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Could not load discounts.");
        setLoading(false);
      });
  }, []);
  return { ...data, loading, error, reload: load };
}
