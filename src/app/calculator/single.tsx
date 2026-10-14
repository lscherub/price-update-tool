"use client";
import { useMemo, useState } from "react";
import {
  calculateSingleItem,
  calculateUnitFromBox,
  resolveDiscountWithSource,
  validateBoxInputs,
} from "@/lib/calculator";
import type { DiscountSource, RoundingMethod } from "@/lib/calculator";
import { DEFAULT_DIVISOR } from "@/lib/pricing";
import { Field, Section, SourceBadge, inputCls, numOk, ROUND_OPTS } from "./shared";
import type { DiscountState } from "./shared";

export function SingleCalc(p: { disc: DiscountState }) {
  const [vendor, setVendor] = useState("");
  const [brand, setBrand] = useState("");
  const [cost, setCost] = useState("");
  const [dIn, setDIn] = useState("");
  const [touched, setTouched] = useState(false);
  const [divisor, setDivisor] = useState(DEFAULT_DIVISOR);
  const [rounding, setRounding] = useState<RoundingMethod>("nearest9");
  const [boxMode, setBoxMode] = useState(false);
  const [qty, setQty] = useState("");
  const auto = useMemo(
    () => resolveDiscountWithSource(p.disc.vendorMap, p.disc.brandMap, vendor, brand),
    [p.disc, vendor, brand],
  );
  const manual = touched && dIn.trim() !== "";
  const discount = manual ? dIn.replace(/[%$,]/g, "").trim() : auto.discount;
  const source: DiscountSource = manual ? "manual" : auto.source;
  const boxErr = boxMode ? validateBoxInputs(cost, qty) : null;
  const result = useMemo(() => {
    if (!numOk(discount || "0", 0, 100)) return null;
    if (!numOk(divisor || DEFAULT_DIVISOR, 0.0001, 5)) return null;
    if (boxMode) {
      if (boxErr) return null;
      return calculateUnitFromBox({ boxPrice: cost, qtyPerBox: qty, discountPct: discount, divisor });
    }
    if (cost.trim() === "" || !numOk(cost, 0, 10000000)) return null;
    return calculateSingleItem({ listCost: cost, discountPct: discount, divisor, rounding });
  }, [boxErr, boxMode, cost, discount, divisor, qty, rounding]);
  const perUnit = boxMode && result && "perUnitList" in result ? result.perUnitList : null;
  function reset() {
    setVendor("");
    setBrand("");
    setCost("");
    setDIn("");
    setTouched(false);
    setDivisor(DEFAULT_DIVISOR);
    setRounding("nearest9");
    setBoxMode(false);
    setQty("");
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="1. Product & vendor" sub="Discounts load from Vendor Discounts.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Vendor">
            <input list="calc-v" className={inputCls} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Select or type vendor" />
            <datalist id="calc-v">
              {p.disc.vendors.map((v) => (
                <option key={v.vendor} value={v.vendor} />
              ))}
            </datalist>
          </Field>
          <Field label="Brand (optional)">
            <input list="calc-b" className={inputCls} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Provita" />
            <datalist id="calc-b">
              {p.disc.brands
                .filter((b) => !vendor || b.vendor.toLowerCase() === vendor.toLowerCase())
                .map((b) => (
                  <option key={`${b.vendor}|${b.brand}`} value={b.brand} />
                ))}
            </datalist>
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={boxMode} onChange={(e) => setBoxMode(e.target.checked)} />
            <span className="font-medium">Calculate from a box/case price</span>
          </label>
          {boxMode ? (
            <Field label="Quantity per box/case">
              <input className={inputCls} value={qty} inputMode="numeric" onChange={(e) => setQty(e.target.value)} placeholder="e.g. 24" />
            </Field>
          ) : null}
          <Field label={boxMode ? "List price per box/case ($)" : "List cost per unit ($)"}>
            <input className={inputCls} value={cost} inputMode="decimal" onChange={(e) => setCost(e.target.value)} placeholder="e.g. 27.00" />
          </Field>
          <Field label="Discount (%)" hint="Auto-filled; type over for override.">
            <input
              className={inputCls}
              value={manual ? dIn : auto.discount}
              inputMode="decimal"
              onChange={(e) => {
                setTouched(true);
                setDIn(e.target.value);
              }}
              placeholder={auto.discount}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <SourceBadge source={source} />
            {touched ? (
              <button
                type="button"
                className="text-xs text-blue-700 underline"
                onClick={() => {
                  setTouched(false);
                  setDIn("");
                }}
              >
                Restore saved rule ({auto.discount}%)
              </button>
            ) : null}
          </div>
        </div>
      </Section>
      <Section title="2. Retail pricing & result">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Pricing divisor">
            <input className={inputCls} value={divisor} inputMode="decimal" onChange={(e) => setDivisor(e.target.value)} />
          </Field>
          {!boxMode ? (
            <Field label="Round retail to">
              <select className={inputCls} value={rounding} onChange={(e) => setRounding(e.target.value as RoundingMethod)}>
                {ROUND_OPTS.map((o) => (
                  <option key={o.v} value={o.v}>{o.label}</option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
        <div className="mt-4 divide-y rounded-lg border text-sm">
          {boxMode ? (
            <div className="flex justify-between gap-4 px-3 py-2">
              <span className="text-slate-600">Per-unit list</span>
              <span className="font-semibold">{perUnit ? `$${perUnit}` : "—"}</span>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 px-3 py-2">
            <span className="text-slate-600">Discount</span>
            <span className="font-semibold">{discount || "0"}% <SourceBadge source={source} /></span>
          </div>
          <div className="flex justify-between gap-4 px-3 py-2">
            <span className="text-slate-600">Net cost</span>
            <span className="font-semibold">{result?.netCost ? `$${result.netCost}` : "—"}</span>
          </div>
          <div className="flex justify-between gap-4 px-3 py-2">
            <span className="text-slate-600">Suggested retail</span>
            <span className="text-xl font-bold text-emerald-700">{result?.retailRounded ? `$${result.retailRounded}` : "—"}</span>
          </div>
          <div className="flex justify-between gap-4 px-3 py-2 text-xs text-slate-500">
            <span>Margin {result?.margin ?? "—"}% / Markup {result?.markup ?? "—"}%</span>
            {result?.retailExact ? <span>exact ${result.retailExact}</span> : null}
          </div>
        </div>
        {boxErr ? <p className="mt-2 text-sm text-amber-700">{boxErr}</p> : null}
        {!result && !boxErr ? <p className="mt-2 text-sm text-slate-500">Enter a vendor list cost.</p> : null}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={!result}
            onClick={() => {
              if (result?.retailRounded) navigator.clipboard.writeText(`Net $${result.netCost} Retail $${result.retailRounded}`).catch(() => {});
            }}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Copy
          </button>
          <button type="button" onClick={reset} className="rounded border px-3 py-1.5 text-sm">Reset</button>
        </div>
      </Section>
    </div>
  );
}

