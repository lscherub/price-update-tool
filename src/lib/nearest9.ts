import Decimal from "decimal.js";
import {
  calcOurNewListPrice,
  calcOurNewRetailPrice,
  DEFAULT_DIVISOR,
  normalizeSku,
} from "./pricing";

/**
 * Nearest-9 rounding: snap a price to the nearest value ending in 9 cents.
 *
 * The price points form the sequence ...33.69, 33.79, 33.89, 33.99, 34.19...
 * i.e. every 10 cents across a whole dollar, with the `.09` tier deliberately
 * absent (an exact `.09` resolves down to the previous `.99` instead).
 *
 * Implemented as two explicit steps rather than one offset expression:
 *
 *   1. `tenths = round_half_up(value * 10)` snaps the value onto the nearest
 *      tenth of a dollar. Because the lattice of `.x9` prices is the set of
 *      tenths shifted down by one cent, subtracting 1 cent afterwards lands on
 *      the nearest price ending in 9. Using a half-up rounding *of the tenths*
 *      is what makes the midpoint behave mathematically: 33.745 and above go up
 *      to 33.79, below go down to 33.69 (33.75 -> 33.79).
 *   2. If that result lands exactly on `.09`, step down one candidate to the
 *      previous `.99` (58.09 -> 57.99, 62.0992 -> 62.09 -> 61.99).
 *
 * The previous implementation folded both steps into `value + 0.02`, then
 * rounded and subtracted 0.01. That 2-cent pre-offset shifted every boundary by
 * two cents, so values were pushed to the wrong candidate: 33.7355 -> 33.79
 * (should be 33.69), 62.0992 -> 62.09 (should be 61.99), 63.24 -> 63.29
 * (should be 63.19) and 54.09 -> 54.09 (should be 53.99).
 */
export function calcNearest9(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  let v: Decimal;
  try {
    v = new Decimal(String(value).replace(/[$,]/g, "").trim());
  } catch {
    return null;
  }
  if (!v.isFinite()) return null;

  // Step 1: nearest tenth of a dollar, rounded half-up at the midpoint.
  const tenths = v.times(10).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  // Step 2a: that tenth shifted down one cent is the nearest `.x9` price.
  let cents = tenths.times(10).minus(1);
  // Step 2b: an exact `.09` moves down to the previous `.99`.
  if (cents.modulo(100).eq(9)) cents = cents.minus(10);
  // A price below $0.05 has no valid candidate; never emit a negative price.
  if (cents.isNegative()) cents = new Decimal(0);

  return cents.dividedBy(100).toDecimalPlaces(2).toFixed(2);
}

export type PriceRowInput = {
  rawVendorSku?: string;
  cleanedSku?: string;
  cleanedOverridden?: boolean;
  discount?: string | number | null;
  vendorListPriceNew?: string | number | null;
  marginDivisor?: string | number | null;
  product?: {
    productNumber?: string;
    description?: string;
    brand?: string;
    vendor?: string;
    listCost?: string | number | null;
    price?: string | number | null;
    isInactive?: boolean;
  } | null;
  defaultDiscount?: string | number | null;
};

export type PriceRowResult = {
  cleanedSku: string;
  productNumber: string;
  productName: string;
  brand: string;
  vendor: string;
  discount: string;
  currentListPrice: string | null;
  ourNewListPrice: string | null;
  marginDivisor: string;
  ourNewRetailPrice: string | null;
  oldRetailPrice: string | null;
  nearest9: string | null;
  matched: boolean;
  isInactive: boolean;
};

function decOrZero(v: string | number | null | undefined): Decimal {
  try {
    if (v === null || v === undefined || v === "") return new Decimal(0);
    return new Decimal(String(v).replace(/[$,]/g, "").trim());
  } catch {
    return new Decimal(0);
  }
}

/** Full server-side row calculation (pure, decimal-safe). */
export function calculateRow(input: PriceRowInput): PriceRowResult {
  const cleaned =
    input.cleanedOverridden && input.cleanedSku ? input.cleanedSku.trim() : normalizeSku(input.rawVendorSku ?? "");
  const p = input.product ?? null;
  const matched = !!p;
  const discount =
    input.discount !== null && input.discount !== undefined && String(input.discount) !== ""
      ? decOrZero(input.discount).toFixed(2)
      : decOrZero(input.defaultDiscount).toFixed(2);
  const ourNewList = calcOurNewListPrice(input.vendorListPriceNew, discount);
  const divisorStr =
    input.marginDivisor !== null && input.marginDivisor !== undefined && String(input.marginDivisor) !== ""
      ? String(input.marginDivisor)
      : DEFAULT_DIVISOR;
  const ourNewRetail = ourNewList !== null ? calcOurNewRetailPrice(ourNewList, divisorStr) : null;
  const nearest9 = ourNewRetail !== null ? calcNearest9(ourNewRetail) : null;
  const cur = p && p.listCost !== null && p.listCost !== undefined && String(p.listCost) !== ""
    ? decOrZero(p.listCost).toFixed(2) : null;
  const old = p && p.price !== null && p.price !== undefined && String(p.price) !== ""
    ? decOrZero(p.price).toFixed(2) : null;
  return {
    cleanedSku: cleaned,
    productNumber: p?.productNumber ?? "",
    productName: p?.description ?? "",
    brand: p?.brand ?? "",
    vendor: p?.vendor ?? "",
    discount,
    currentListPrice: cur,
    ourNewListPrice: ourNewList,
    marginDivisor: divisorStr,
    ourNewRetailPrice: ourNewRetail,
    oldRetailPrice: old,
    nearest9,
    matched,
    isInactive: !!p?.isInactive,
  };
}
