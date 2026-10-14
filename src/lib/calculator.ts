import Decimal from "decimal.js";
import { calcNearest9 } from "./nearest9";
import {
  calcOurNewListPrice,
  calcOurNewRetailPrice,
  DEFAULT_DIVISOR,
  normalizeBrand,
  normalizeVendor,
} from "./pricing";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type DiscountSource = "brand" | "vendor" | "none" | "manual";

export type DiscountResolution = {
  discount: string;
  source: DiscountSource;
};

export type RoundingMethod = "nearest9" | "99" | "95" | "exact";

export function discountSourceLabel(source: DiscountSource): string {
  switch (source) {
    case "brand":
      return "Brand-specific rule";
    case "vendor":
      return "Vendor default";
    case "manual":
      return "Manual override";
    default:
      return "No discount found (0%)";
  }
}

export function calculatorDiscountKey(
  vendor: string | null | undefined,
  brand: string | null | undefined,
): string {
  return `${normalizeVendor(vendor)}|${normalizeBrand(brand)}`;
}

export function resolveDiscountWithSource(
  vendorMap: ReadonlyMap<string, string>,
  brandMap: ReadonlyMap<string, string>,
  vendor: string | null | undefined,
  brand: string | null | undefined,
): DiscountResolution {
  const nv = normalizeVendor(vendor);
  if (nv && normalizeBrand(brand)) {
    const hit = brandMap.get(calculatorDiscountKey(vendor, brand));
    if (hit !== undefined) return { discount: new Decimal(hit).toFixed(2), source: "brand" };
  }
  const vHit = nv ? vendorMap.get(nv) : undefined;
  if (vHit !== undefined) return { discount: new Decimal(vHit).toFixed(2), source: "vendor" };
  return { discount: "0.00", source: "none" };
}

export function buildDiscountMaps(
  vendors: { vendor: string; discount: string }[],
  brands: { vendor: string; brand: string; discount: string }[],
): { vendors: Map<string, string>; brands: Map<string, string> } {
  const v = new Map<string, string>();
  for (const r of vendors) {
    const nv = normalizeVendor(r.vendor);
    if (nv) v.set(nv, new Decimal(r.discount || "0").toFixed(2));
  }
  const b = new Map<string, string>();
  for (const r of brands) {
    const nv = normalizeVendor(r.vendor);
    const nb = normalizeBrand(r.brand);
    if (nv && nb) b.set(`${nv}|${nb}`, new Decimal(r.discount || "0").toFixed(2));
  }
  return { vendors: v, brands: b };
}

function toDec(v: string | number | null | undefined): Decimal | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  try {
    const d = new Decimal(String(v).replace(/[$,]/g, "").trim());
    if (!d.isFinite()) return null;
    return d;
  } catch {
    return null;
  }
}

export function calcPerUnitList(
  boxPrice: string | number | null | undefined,
  qtyPerBox: string | number | null | undefined,
): string | null {
  const box = toDec(boxPrice);
  const qty = toDec(qtyPerBox);
  if (box === null || qty === null || qty.lte(0) || box.lt(0)) return null;
  return box.dividedBy(qty).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function roundRetailPrice(
  exactRetail: string | number | null | undefined,
  method: RoundingMethod,
): string | null {
  if (method === "nearest9") return calcNearest9(exactRetail);
  const d = toDec(exactRetail);
  if (d === null) return null;
  if (method === "99") return d.floor().plus(0.99).toDecimalPlaces(2).toFixed(2);
  if (method === "95") return d.floor().plus(0.95).toDecimalPlaces(2).toFixed(2);
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export type SingleCalcResult = {
  netCost: string | null;
  retailExact: string | null;
  retailRounded: string | null;
  divisor: string;
  margin: string | null;
  markup: string | null;
};

export function calculateSingleItem(opts: {
  listCost: string | number | null | undefined;
  discountPct: string | number | null | undefined;
  divisor?: string | number | null | undefined;
  rounding?: RoundingMethod;
}): SingleCalcResult {
  const divisorStr =
    opts.divisor !== null && opts.divisor !== undefined && String(opts.divisor).trim() !== ""
      ? String(opts.divisor).trim()
      : DEFAULT_DIVISOR;
  const net = calcOurNewListPrice(opts.listCost, opts.discountPct);
  const exact = net !== null ? calcOurNewRetailPrice(net, divisorStr) : null;
  const rounded = exact !== null ? roundRetailPrice(exact, opts.rounding ?? "nearest9") : null;
  let margin: string | null = null;
  let markup: string | null = null;
  try {
    const n = net !== null ? new Decimal(net) : null;
    const r = rounded !== null ? new Decimal(rounded) : null;
    if (n && r && r.gt(0)) margin = r.minus(n).dividedBy(r).times(100).toDecimalPlaces(1).toFixed(1);
    if (n && r && n.gt(0)) markup = r.minus(n).dividedBy(n).times(100).toDecimalPlaces(1).toFixed(1);
  } catch {
    margin = null;
    markup = null;
  }
  return { netCost: net, retailExact: exact, retailRounded: rounded, divisor: divisorStr, margin, markup };
}

export type BoxCalcResult = SingleCalcResult & {
  perUnitList: string | null;
};

export function calculateUnitFromBox(opts: {
  boxPrice: string | number | null | undefined;
  qtyPerBox: string | number | null | undefined;
  discountPct: string | number | null | undefined;
  divisor?: string | number | null | undefined;
}): BoxCalcResult {
  const perUnitList = calcPerUnitList(opts.boxPrice, opts.qtyPerBox);
  const single = calculateSingleItem({
    listCost: perUnitList,
    discountPct: opts.discountPct,
    divisor: opts.divisor,
    rounding: "nearest9",
  });
  return { ...single, perUnitList };
}

export function divisorFromMargin(marginPct: string | number | null | undefined): string | null {
  const m = toDec(marginPct);
  if (m === null || m.lte(0) || m.gte(100)) return null;
  return new Decimal(1).minus(m.dividedBy(100)).toDecimalPlaces(4).toFixed(4);
}

export function divisorFromMarkup(markupPct: string | number | null | undefined): string | null {
  const m = toDec(markupPct);
  if (m === null) return null;
  try {
    const d = new Decimal(1).dividedBy(new Decimal(1).plus(m.dividedBy(100)));
    if (!d.isFinite() || d.lte(0) || d.gt(1)) return null;
    return d.toDecimalPlaces(4).toFixed(4);
  } catch {
    return null;
  }
}

export function validateListCost(v: string | number | null | undefined): string | null {
  const s = String(v ?? "").trim();
  if (!s) return "Enter a vendor list cost.";
  const d = toDec(v);
  if (d === null) return "Cost must be a number.";
  if (d.lt(0)) return "Cost cannot be negative.";
  if (d.isZero()) return "Cost is zero — the result will be $0.00.";
  return null;
}

export function validateBoxInputs(
  boxPrice: string | number | null | undefined,
  qtyPerBox: string | number | null | undefined,
): string | null {
  const q = toDec(qtyPerBox);
  if (String(qtyPerBox ?? "").trim() === "" || q === null) return "Enter the quantity per box/case.";
  if (!q.isInteger() || q.lte(0)) return "Quantity per box must be a whole number of 1 or more.";
  const b = toDec(boxPrice);
  if (String(boxPrice ?? "").trim() === "" || b === null) return "Enter the box/case list price.";
  if (b.lt(0)) return "Box price cannot be negative.";
  return null;
}

