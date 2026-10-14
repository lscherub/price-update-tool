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
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="text-base font-bold">{p.title}</h2>
      {p.sub && <p className="mt-1 text-sm text-slate-500">{p.sub}</p>}
      <div className="mt-4">{p.children}</div>
    </section>
  );
}

export function Field(p: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">{p.label}</span>
      {p.children}
      {p.hint && <span className="text-xs text-slate-500">{p.hint}</span>}
    </label>
  );
}

export const inputCls = "rounded border px-3 py-1.5";

export function SourceBadge(p: { source: DiscountSource }) {
  const c =
    p.source === "brand"
      ? "bg-violet-100 text-violet-800"
      : p.source === "vendor"
        ? "bg-sky-100 text-sky-800"
        : p.source === "manual"
          ? "bg-amber-100 text-amber-800"
          : "bg-slate-100 text-slate-600";
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
