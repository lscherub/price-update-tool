import Decimal from "decimal.js";
import { normalizeSku, skuCandidates } from "./pricing";
import { parsePastedVendorData } from "./importers";

/**
 * Full Vendor Price Update — pure planning helpers (no database access).
 *
 * A full-vendor sheet contains EXACTLY ONE row per inventory product of the
 * selected vendor. Pasted vendor prices are matched onto those products using
 * the same SKU cleaning + candidate order as the existing price update import
 * (`skuCandidates` / `findProductsByRawSkus`: normalizedSku, then sku, then
 * leading-zero-stripped variants). Differences, all on the safe side:
 *   - matching is scoped to the selected vendor's products;
 *   - a pasted SKU that resolves to more than one product is flagged as
 *     ambiguous instead of silently taking the first hit;
 *   - a product hit by several pasted lines with different prices is flagged
 *     as a conflict and receives no price.
 * Products without a usable vendor price keep a blank Vendor List Price (New)
 * and are never given a fabricated price.
 */

export const FULL_VENDOR_KIND = "fullvendor-created";

export type FvProduct = {
  id: string;
  sku: string;
  normalizedSku: string;
  productNumber: string;
  description: string;
  vendor: string;
  brand: string;
  listCost: string;
  price: string;
  sizeDesc: string;
  isInactive: boolean;
};

export type FvPasted = { raw: string; price: string | null; line: number };

export type FvStatus = "priced" | "missing" | "ambiguous" | "conflict" | "no-price";

export type FvRowPlan = {
  product: FvProduct;
  rawVendorSku: string;
  cleanedSku: string;
  /** true = row is pinned to its inventory SKU (recalc looks it up by that SKU). */
  cleanedOverridden: boolean;
  vendorListPriceNew: string | null;
  status: FvStatus;
  note: string;
};

export type FvPlan = {
  rows: FvRowPlan[];
  /** Pasted lines whose SKU matched no product of this vendor. */
  unmatchedPasted: FvPasted[];
  /** Pasted lines whose SKU matched several products. */
  ambiguousPasted: { raw: string; line: number; skus: string[] }[];
  /** Pasted lines skipped because the price cell was not a valid number. */
  invalidPrice: FvPasted[];
  counts: { total: number; priced: number; missing: number; ambiguous: number; conflict: number; noPrice: number; inactive: number };
};

const stripZeros = (v: string) => v.replace(/^0+/, "") || "0";
const spaceless = (v: string) => String(v ?? "").trim().replace(/[\s-]+/g, "");

/** Validated price string (2dp) or null for blank/invalid/negative. */
export function cleanPrice(v: string | null | undefined): { ok: true; value: string | null } | { ok: false } {
  const s = String(v ?? "").trim().replace(/[$,\s]/g, "");
  if (!s) return { ok: true, value: null };
  try {
    const d = new Decimal(s);
    if (!d.isFinite() || d.isNegative()) return { ok: false };
    return { ok: true, value: d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2) };
  } catch {
    return { ok: false };
  }
}

const SKU_HEADER = /(sku|code|item|upc|product|part|article|ref)/i;
const PRICE_HEADER = /(price|cost|list|new|amount|msrp|wholesale)/i;

function isNumericCell(v: string): boolean {
  const s = v.trim().replace(/[$,\s]/g, "");
  return s !== "" && Number.isFinite(Number(s));
}

/**
 * Parse text copied from Excel. Accepts:
 *   - two columns (SKU, price) — delegated to the existing paste parser;
 *   - more columns with a header row: SKU/code + price columns are detected
 *     by name (a header containing "new" wins for the price);
 *   - more columns without a header: first column = SKU, last numeric column = price.
 * A leading header row is skipped. Raw SKUs are kept verbatim (leading zeros,
 * spaces and hyphens included) — cleaning happens during matching.
 */
export function parseFullVendorPaste(text: string): FvPasted[] {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const nonEmpty = lines.map((l, i) => ({ l, i })).filter((x) => x.l.trim() !== "");
  if (!nonEmpty.length) return [];
  const maxCols = Math.max(...nonEmpty.map((x) => (x.l.includes("\t") ? x.l.split("\t").length : 1)));

  if (maxCols <= 2) {
    // Same parser as the existing New Price Update paste box.
    const out: FvPasted[] = [];
    nonEmpty.forEach(({ l, i }, idx) => {
      const [p] = parsePastedVendorData(l);
      if (!p) return;
      // Header row ("SKU<TAB>Price") — skip it.
      if (idx === 0 && p.price !== null && !isNumericCell(p.price) && (SKU_HEADER.test(p.raw) || PRICE_HEADER.test(p.price))) return;
      out.push({ raw: p.raw, price: p.price, line: i + 1 });
    });
    return out;
  }

  // Multi-column tab-separated paste.
  const first = nonEmpty[0].l.split("\t").map((c) => c.trim());
  const hasHeader = first.some((c) => SKU_HEADER.test(c)) && first.some((c) => PRICE_HEADER.test(c)) && !first.some(isNumericCell);
  let skuCol = 0;
  let priceCol = -1;
  if (hasHeader) {
    const s = first.findIndex((c) => SKU_HEADER.test(c));
    skuCol = s >= 0 ? s : 0;
    const priceIdx = first.map((c, i) => ({ c, i })).filter((x) => x.i !== skuCol && PRICE_HEADER.test(x.c));
    priceCol = (priceIdx.find((x) => /new/i.test(x.c)) ?? priceIdx[priceIdx.length - 1])?.i ?? -1;
  }
  const out: FvPasted[] = [];
  nonEmpty.forEach(({ l, i }, idx) => {
    if (hasHeader && idx === 0) return;
    const cells = l.split("\t");
    const raw = (cells[skuCol] ?? "").trim();
    if (!raw) return;
    let price = "";
    if (priceCol >= 0) price = (cells[priceCol] ?? "").trim();
    else {
      for (let c = cells.length - 1; c > skuCol; c--) {
        if (isNumericCell(cells[c] ?? "")) { price = cells[c].trim(); break; }
      }
    }
    price = price.replace(/[$,]/g, "");
    out.push({ raw, price: price === "" ? null : price, line: i + 1 });
  });
  return out;
}

type Index = { byNorm: Map<string, FvProduct[]>; bySku: Map<string, FvProduct[]>; byStripped: Map<string, FvProduct[]> };

function push(map: Map<string, FvProduct[]>, key: string, p: FvProduct) {
  if (!key) return;
  const list = map.get(key);
  if (!list) map.set(key, [p]);
  else if (!list.some((x) => x.id === p.id)) list.push(p);
}

function buildIndex(products: FvProduct[]): Index {
  const idx: Index = { byNorm: new Map(), bySku: new Map(), byStripped: new Map() };
  for (const p of products) {
    push(idx.byNorm, p.normalizedSku, p);
    push(idx.bySku, p.sku, p);
    push(idx.byStripped, stripZeros(p.normalizedSku), p);
    push(idx.byStripped, stripZeros(p.sku), p);
  }
  return idx;
}

/**
 * Resolve one pasted SKU against the vendor's products.
 * Candidate/tier order mirrors `findProductsByRawSkus`; the first non-empty
 * tier decides. When a tier holds several products, an exact match on the
 * full (spaceless) vendor code is used to disambiguate; otherwise ambiguous.
 */
export function resolvePastedSku(raw: string, idx: Index): FvProduct[] {
  const full = spaceless(raw);
  for (const c of skuCandidates(raw)) {
    for (const hits of [idx.byNorm.get(c), idx.bySku.get(c), idx.byStripped.get(stripZeros(c))]) {
      if (!hits || !hits.length) continue;
      if (hits.length === 1) return hits;
      const exact = hits.filter((p) => p.sku === full || stripZeros(p.sku) === stripZeros(full));
      return exact.length === 1 ? exact : hits;
    }
  }
  return [];
}

/** True when the existing recalc lookup (by cleaned SKU) lands on this product's own keys. */
function cleanedPointsAt(cleaned: string, p: FvProduct): boolean {
  if (!cleaned) return false;
  if (cleaned === p.normalizedSku || cleaned === p.sku) return true;
  const s = stripZeros(cleaned);
  return s === stripZeros(p.normalizedSku) || s === stripZeros(p.sku);
}

export function planFullVendorRows(products: FvProduct[], pasted: FvPasted[]): FvPlan {
  const idx = buildIndex(products);
  type Hit = { raw: string; line: number; price: string | null };
  const hitsByProduct = new Map<string, Hit[]>();
  const ambiguousByProduct = new Map<string, { raw: string; skus: string[] }>();
  const unmatchedPasted: FvPasted[] = [];
  const ambiguousPasted: FvPlan["ambiguousPasted"] = [];
  const invalidPrice: FvPasted[] = [];

  for (const row of pasted) {
    const matches = resolvePastedSku(row.raw, idx);
    if (!matches.length) { unmatchedPasted.push(row); continue; }
    if (matches.length > 1) {
      const skus = matches.map((m) => m.sku);
      ambiguousPasted.push({ raw: row.raw, line: row.line, skus });
      for (const m of matches) if (!ambiguousByProduct.has(m.id)) ambiguousByProduct.set(m.id, { raw: row.raw, skus });
      continue;
    }
    const price = cleanPrice(row.price);
    if (!price.ok) invalidPrice.push(row);
    const list = hitsByProduct.get(matches[0].id) ?? [];
    list.push({ raw: row.raw, line: row.line, price: price.ok ? price.value : null });
    hitsByProduct.set(matches[0].id, list);
  }

  const counts = { total: products.length, priced: 0, missing: 0, ambiguous: 0, conflict: 0, noPrice: 0, inactive: 0 };
  const pinned = (p: FvProduct) => ({ cleanedSku: p.sku, cleanedOverridden: true });

  const rows: FvRowPlan[] = products.map((p) => {
    if (p.isInactive) counts.inactive++;
    const hits = hitsByProduct.get(p.id) ?? [];
    const amb = ambiguousByProduct.get(p.id);

    if (!hits.length) {
      if (amb) {
        counts.ambiguous++;
        return {
          product: p, rawVendorSku: "", ...pinned(p), vendorListPriceNew: null, status: "ambiguous",
          note: `Review: vendor SKU "${amb.raw}" matches several products (${amb.skus.join(", ")}). No price applied.`,
        };
      }
      counts.missing++;
      return {
        product: p, rawVendorSku: "", ...pinned(p), vendorListPriceNew: null, status: "missing",
        note: "Review: not in vendor price list — no new price.",
      };
    }

    const priced = hits.filter((h) => h.price !== null);
    const distinct = [...new Set(priced.map((h) => h.price as string))];
    const first = priced[0] ?? hits[0];
    const cleaned = normalizeSku(first.raw);
    const keys = cleanedPointsAt(cleaned, p) ? { cleanedSku: cleaned, cleanedOverridden: false } : pinned(p);

    if (distinct.length > 1) {
      counts.conflict++;
      return {
        product: p, rawVendorSku: first.raw, ...keys, vendorListPriceNew: null, status: "conflict",
        note: `Review: conflicting vendor prices (${priced.map((h) => `${h.raw}: ${h.price}`).join("; ")}). No price applied.`,
      };
    }
    if (!distinct.length) {
      counts.noPrice++;
      return {
        product: p, rawVendorSku: first.raw, ...keys, vendorListPriceNew: null, status: "no-price",
        note: `Review: vendor SKU "${first.raw}" found but its price is blank or invalid.`,
      };
    }
    counts.priced++;
    return { product: p, rawVendorSku: first.raw, ...keys, vendorListPriceNew: distinct[0], status: "priced", note: "" };
  });

  return { rows, unmatchedPasted, ambiguousPasted, invalidPrice, counts };
}

/** Markdown summary placed in the sheet's (editable) Price Sheet Notes. */
export function planSummaryMarkdown(vendor: string, plan: FvPlan): string {
  const c = plan.counts;
  const lines = [
    `**Full Vendor Price Update — ${vendor}**`,
    "",
    `- Inventory products: ${c.total} (${c.inactive} inactive)`,
    `- With new vendor price: ${c.priced}`,
    `- Not in vendor list (no price): ${c.missing}`,
  ];
  if (c.noPrice) lines.push(`- Found but blank/invalid price: ${c.noPrice}`);
  if (c.ambiguous) lines.push(`- Ambiguous matches (no price applied): ${c.ambiguous}`);
  if (c.conflict) lines.push(`- Conflicting prices (no price applied): ${c.conflict}`);
  if (plan.unmatchedPasted.length) {
    const sample = plan.unmatchedPasted.slice(0, 50).map((r) => `${r.raw}${r.price ? ` (${r.price})` : ""}`).join(", ");
    lines.push(`- Vendor SKUs not found in this vendor's inventory: ${plan.unmatchedPasted.length}`);
    lines.push("", `Not found: ${sample}${plan.unmatchedPasted.length > 50 ? ", …" : ""}`);
  }
  return lines.join("\n").slice(0, 5000);
}

