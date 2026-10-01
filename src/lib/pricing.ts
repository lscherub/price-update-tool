import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export const DEFAULT_DIVISOR = "0.605";

/** Normalize vendor SKU: trim, remove spaces+hyphens, remove final char. String-safe. */
export function normalizeSku(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return "";
  let s = String(input).trim();
  if (!s) return "";
  s = s.replace(/[\s-]+/g, "");
  if (s.length <= 1) return "";
  return s.slice(0, -1);
}

/** Candidate keys to try against inventory, in order (robust matching). */
export function skuCandidates(raw: string | number | null | undefined): string[] {
  if (raw === null || raw === undefined) return [];
  const s = String(raw).trim();
  if (!s) return [];
  const noSpaceHyphen = s.replace(/[\s-]+/g, "");
  const cleaned = normalizeSku(raw);
  const seen = new Set<string>();
  const out: string[] = [];
  // cleaned, cleaned w/o leading zeros, spaceless, spaceless w/o leading zeros, raw
  const stripped = (v: string) => v.replace(/^0+/, "") || "0";
  for (const c of [cleaned, stripped(cleaned), noSpaceHyphen, stripped(noSpaceHyphen), s]) {
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/**
 * Human-readable price-update name, e.g. "A.O.R. INC. - October 1, 2026".
 *
 * The New Price Update screen no longer asks the user to type a name: the
 * backend always derives one from the selected vendor and the current
 * date/time, which is also what the UI shows as a read-only preview.
 */
export function formatUpdateName(vendor: string | null | undefined, when: Date = new Date()): string {
  const v = String(vendor ?? "").trim().replace(/\s+/g, " ");
  const stamp = `${toMonthName(when)} ${when.getDate()}, ${when.getFullYear()}`;
  return v ? `${v} - ${stamp}` : stamp;
}

function toMonthName(d: Date): string {
  return d.toLocaleString("en-US", { month: "long" });
}

export function normalizeVendor(v: string | null | undefined): string {
  return String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function toDec(v: string | number | null | undefined): Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    const d = new Decimal(String(v).replace(/[$,]/g, "").trim());
    if (!d.isFinite()) return null;
    return d;
  } catch {
    return null;
  }
}

function round2(d: Decimal): string {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** Our New List Price = ROUND(vendor - vendor*discount/100, 2) */
export function calcOurNewListPrice(
  vendorListPriceNew: string | number | null | undefined,
  discountPct: string | number | null | undefined
): string | null {
  const v = toDec(vendorListPriceNew);
  if (v === null) return null;
  const disc = toDec(discountPct) ?? new Decimal(0);
  return round2(v.minus(v.times(disc).dividedBy(100)));
}

/** Our New Retail Price = ourNewListPrice / divisor (default 0.605). Returns 4dp. */
export function calcOurNewRetailPrice(
  ourNewListPrice: string | number | null | undefined,
  marginDivisor: string | number | null | undefined
): string | null {
  const p = toDec(ourNewListPrice);
  if (p === null) return null;
  let div = toDec(marginDivisor);
  if (div === null || div.isZero()) div = new Decimal(DEFAULT_DIVISOR);
  return p.dividedBy(div).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}
