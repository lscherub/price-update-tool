"use client";
import { useMemo, useState } from "react";
import { calculateSingleItem, resolveDiscountWithSource } from "@/lib/calculator";
import type { DiscountSource, RoundingMethod } from "@/lib/calculator";
import { DEFAULT_DIVISOR } from "@/lib/pricing";
import { Field, Section, SourceBadge, inputCls, numOk, ROUND_OPTS } from "./shared";
import type { DiscountState } from "./shared";

export function BatchCalc(p: { disc: DiscountState }) {
  const [vendor, setVendor] = useState("");
  const [brand, setBrand] = useState("");
  const [dIn, setDIn] = useState("");
  const [touched, setTouched] = useState(false);
  const [divisor, setDivisor] = useState(DEFAULT_DIVISOR);
  const [rounding, setRounding] = useState<RoundingMethod>("nearest9");
  const [text, setText] = useState("11.49\n19.99\n32.99");
  const auto = useMemo(
    () => resolveDiscountWithSource(p.disc.vendorMap, p.disc.brandMap, vendor, brand),
    [p.disc, vendor, brand],
  );
  const manual = touched && dIn.trim() !== "";
  const discount = manual ? dIn.replace(/[%$,]/g, "").trim() : auto.discount;
  const source: DiscountSource = manual ? "manual" : auto.source;
  const rows = useMemo(() => {
    if (!numOk(discount || "0", 0, 100)) return [];
    if (!numOk(divisor || DEFAULT_DIVISOR, 0.0001, 5)) return [];
    return text
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/[$,]/g, ""))
      .filter((l) => l !== "")
      .map((raw, i) => {
        const ok = numOk(raw, 0, 10000000);
        if (!ok) return { i, raw, error: "Invalid cost" as string | null, net: null, retail: null };
        const r = calculateSingleItem({ listCost: raw, discountPct: discount, divisor, rounding });
        return { i, raw, error: null, net: r.netCost, retail: r.retailRounded };
      });
  }, [text, discount, divisor, rounding]);
  return (
    <Section title="Batch cost calculator" sub="Paste vendor costs vertically; saved vendor rules apply.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Vendor">
          <input list="calc-v2" className={inputCls} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor" />
          <datalist id="calc-v2">
            {p.disc.vendors.map((v) => (
              <option key={v.vendor} value={v.vendor} />
            ))}
          </datalist>
        </Field>
        <Field label="Brand (optional)">
          <input className={inputCls} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand" />
        </Field>
        <Field label="Divisor">
          <input className={inputCls} value={divisor} onChange={(e) => setDivisor(e.target.value)} />
        </Field>
        <Field label="Rounding">
          <select className={inputCls} value={rounding} onChange={(e) => setRounding(e.target.value as RoundingMethod)}>
            {ROUND_OPTS.map((o) => (
              <option key={o.v} value={o.v}>{o.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span>Discount:</span>
        <input
          className="w-24 rounded border px-2 py-1"
          value={manual ? dIn : auto.discount}
          onChange={(e) => {
            setTouched(true);
            setDIn(e.target.value);
          }}
        />
        <SourceBadge source={source} />
      </div>
      <div className="mt-3">
        <Field label="Paste vendor list costs (one per line)">
          <textarea className={`${inputCls} font-mono text-xs`} rows={5} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 max-h-64 overflow-auto rounded border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs text-slate-500">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Raw cost</th>
              <th className="px-3 py-2">Net cost</th>
              <th className="px-3 py-2">Retail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.i} className="border-t">
                <td className="px-3 py-1.5">{r.i + 1}</td>
                <td className="px-3 py-1.5">${r.raw}</td>
                <td className="px-3 py-1.5 font-semibold">{r.error ? <span className="text-red-600">{r.error}</span> : `$${r.net}`}</td>
                <td className="px-3 py-1.5 font-semibold text-emerald-700">{r.retail ? `$${r.retail}` : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-500">Paste costs above.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
