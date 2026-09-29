import Decimal from "decimal.js";
import {
  calcOurNewListPrice,
  calcOurNewRetailPrice,
  DEFAULT_DIVISOR,
  normalizeSku,
} from "./pricing";

/**
 * Nearest-9 rounding (matches spec examples + legacy Excel behavior).
 * Rule: exact .09-cent hits (58.09) move down one candidate (-> 57.99);
 * otherwise round(value + 0.02, 1dp, half-up) - 0.01.
 * Verified: 58.03->58.09, 58.07->58.09, 58.09->57.99, 58.12->58.09,
 * 58.15->58.19, 14.09->13.99, 77.09->76.99.
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
  const cents = v.times(100);
  const isWholeCent = cents.minus(cents.round()).abs().lt(0.0001);
  if (isWholeCent && cents.toNumber() % 10 === 9) {
    return cents.minus(10).dividedBy(100).toDecimalPlaces(2).toFixed(2);
  }
  return v
    .plus(0.02)
    .times(10)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .dividedBy(10)
    .minus(0.01)
    .toDecimalPlaces(2)
    .toFixed(2);
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
