import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { loadFileStore } from "@/lib/store";
import { normalizeSku, skuCandidates } from "@/lib/pricing";
import { rankProductMatches, type Price99Item } from "@/lib/price99";

export const runtime = "nodejs";

/**
 * Product search for 99 Price Manager.
 * Searches All Inventory by SKU, product number, description, brand, or vendor.
 * Ranks exact SKU match FIRST, then partial SKU matches, then description/brand/vendor.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!q) return NextResponse.json({ rows: [] });

  const limit = Math.min(50, Math.max(5, parseInt(searchParams.get("limit") ?? "20", 10) || 20));
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  if (!prisma) {
    const store = loadFileStore();
    const needle = q.toLowerCase();
    const matched = store.products
      .filter((p) =>
        [p.sku, p.normalizedSku, p.productNumber, p.description, p.vendor, p.brand]
          .join(" ")
          .toLowerCase()
          .includes(needle)
      )
      .map((p) => ({
        id: p.id,
        sku: p.sku,
        productNumber: p.productNumber,
        description: p.description,
        vendor: p.vendor,
        brand: p.brand,
        listCost: p.listCost,
        price: p.price,
        sizeDesc: p.sizeDesc,
        isInactive: p.isInactive,
      }));

    const ranked = rankProductMatches(matched, q).slice(0, limit);
    return NextResponse.json({ rows: ranked });
  }

  try {
    const cands = skuCandidates(q);
    const candidateRows = await prisma.product.findMany({
      where: {
        OR: [
          { sku: { contains: q, mode: "insensitive" } },
          { normalizedSku: { in: cands } },
          { productNumber: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
          { brand: { contains: q, mode: "insensitive" } },
          { vendor: { contains: q, mode: "insensitive" } },
        ],
      },
      take: 100, // Fetch candidate pool to guarantee exact matches are included
    });

    const formatted: (Price99Item & { id: string; isInactive: boolean; sizeDesc: string })[] =
      candidateRows.map((p) => ({
        id: p.id,
        sku: p.sku,
        productNumber: p.productNumber,
        description: p.description,
        vendor: p.vendor,
        brand: p.brand,
        listCost: String(p.listCost),
        price: String(p.price),
        sizeDesc: p.sizeDesc,
        isInactive: p.isInactive,
      }));

    const ranked = rankProductMatches(formatted, q).slice(0, limit);

    return NextResponse.json({ rows: ranked });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not search products." }, { status: 500 });
  }
}

/**
 * Bulk SKU lookup for 99 Price Manager.
 * Accepts { skus: string[] } and looks up all products against All Inventory.
 * Returns { found: Price99Item[], notFoundSkus: string[] }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const inputSkus = Array.isArray(body?.skus)
    ? (body.skus as string[])
        .map((s) => String(s ?? "").trim())
        .filter(Boolean)
    : [];

  if (!inputSkus.length) {
    return NextResponse.json(
      { error: "At least one SKU is required for bulk lookup." },
      { status: 400 }
    );
  }

  // Deduplicate input SKUs while preserving order
  const uniqueInputSkus = Array.from(new Set(inputSkus));
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  if (!prisma) {
    const store = loadFileStore();
    const found: Price99Item[] = [];
    const notFoundSkus: string[] = [];

    for (const inputSku of uniqueInputSkus) {
      const norm = normalizeSku(inputSku);
      const cands = skuCandidates(inputSku);
      const hit = store.products.find(
        (p) =>
          p.sku.toLowerCase() === inputSku.toLowerCase() ||
          p.normalizedSku === norm ||
          cands.includes(p.normalizedSku)
      );

      if (hit) {
        if (!found.some((f) => f.sku === hit.sku)) {
          found.push({
            sku: hit.sku,
            productNumber: hit.productNumber,
            description: hit.description,
            vendor: hit.vendor,
            brand: hit.brand,
            listCost: hit.listCost,
            price: hit.price,
          });
        }
      } else {
        notFoundSkus.push(inputSku);
      }
    }

    return NextResponse.json({ found, notFoundSkus });
  }

  try {
    const allCands = uniqueInputSkus.flatMap((s) => skuCandidates(s));
    const products = await prisma.product.findMany({
      where: {
        OR: [
          { sku: { in: uniqueInputSkus } },
          { normalizedSku: { in: allCands } },
        ],
      },
    });

    const found: Price99Item[] = [];
    const notFoundSkus: string[] = [];

    for (const inputSku of uniqueInputSkus) {
      const norm = normalizeSku(inputSku);
      const cands = skuCandidates(inputSku);
      const hit = products.find(
        (p) =>
          p.sku.toLowerCase() === inputSku.toLowerCase() ||
          p.normalizedSku === norm ||
          cands.includes(p.normalizedSku)
      );

      if (hit) {
        if (!found.some((f) => f.sku === hit.sku)) {
          found.push({
            sku: hit.sku,
            productNumber: hit.productNumber,
            description: hit.description,
            vendor: hit.vendor,
            brand: hit.brand,
            listCost: String(hit.listCost),
            price: String(hit.price),
          });
        }
      } else {
        notFoundSkus.push(inputSku);
      }
    }

    return NextResponse.json({ found, notFoundSkus });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    console.error("Bulk SKU lookup error:", e);
    return NextResponse.json({ error: "Could not look up bulk SKUs." }, { status: 500 });
  }
}
