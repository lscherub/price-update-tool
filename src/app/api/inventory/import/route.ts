import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { cuid, loadFileStore, saveFileStore } from "@/lib/store";
import { parseInactiveFile, parseInventoryFile } from "@/lib/importers";
import { applyInactiveSkuList, importInventoryBatch, markMissingProductsInactive } from "@/lib/inventoryDb";
import { exactSkuList, MAX_BATCH_ROWS, chunk as chunkRows } from "@/lib/inventoryImport";

export const runtime = "nodejs";
// Each request handles ONE bounded batch, so this stays far below the limit
// and a failure can be retried independently by the client.
export const maxDuration = 60;

const MAX_FILE_BYTES = 8 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });

  const contentType = req.headers.get("content-type") ?? "";
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  // ---------------------------------------------------------------- batch mode
  // The browser parses the workbook and POSTs small JSON batches. Each call is
  // independent: one statement, one round-trip, its own progress report.
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    if (Array.isArray(body.rows)) {
      const startRow = Number.isFinite(body.startRow) ? Number(body.startRow) : 2;
      if (!prisma) {
        return NextResponse.json(
          { error: "DatabaseUnavailable", message: "DATABASE_URL is not configured." },
          { status: 503 },
        );
      }
      try {
        const outcome = await importInventoryBatch(prisma, body.rows, startRow);
        const total = await prisma.product.count();
        return NextResponse.json({ ok: true, ...outcome, total });
      } catch (e) {
        if (isDbConnectionError(e)) return dbUnreachableResponse();
        return NextResponse.json({ error: "Inventory import batch failed. Please retry this batch." }, { status: 500 });
      }
    }
    // Optional post-pass: flag products missing from the newest export.
    if (body.finalize && Array.isArray(body.skus)) {
      if (!prisma) {
        return NextResponse.json({ error: "DatabaseUnavailable", message: "DATABASE_URL is not configured." }, { status: 503 });
      }
      try {
        const { markedInactive } = await markMissingProductsInactive(prisma, body.skus);
        const total = await prisma.product.count();
        return NextResponse.json({ ok: true, markedInactive, total });
      } catch (e) {
        if (isDbConnectionError(e)) return dbUnreachableResponse();
        return NextResponse.json({ error: "Could not flag products missing from the export." }, { status: 500 });
      }
    }
    return NextResponse.json({ error: "Expected { rows: [...] } or { finalize: true, skus: [...] }." }, { status: 400 });
  }

  // ------------------------------------------------------------- legacy upload
  // Whole-file multipart upload, kept working: now driven by the same bulk
  // upsert helper so it is fast too.
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const mode = String(form.get("mode") ?? "inventory");
  if (!file) return NextResponse.json({ error: "No file selected. Choose an Excel or CSV file to upload." }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "File is too large (max 8 MB). Split the file and try again." }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  if (!buf.length) return NextResponse.json({ error: "The uploaded file is empty." }, { status: 400 });

  if (mode === "inactive") {
    const skus = parseInactiveFile(buf);
    if (!skus.length) return NextResponse.json({ error: "No SKUs found in the uploaded file. Make sure the first column (or a SKU column) contains SKU values." }, { status: 400 });
    // EXACT matching only. This used to expand every SKU into fuzzy variants
    // (spaceless, leading-zero-stripped, and normalizeSku() with its last
    // character removed) and match them against BOTH `sku` and `normalizedSku`.
    // For a 16,071-row list that produced 29,024 keys and marked 16,559
    // products Inactive — 488 products that were still on sale were flagged by
    // coincidence. The file is now the sole source of truth: only a product
    // whose `sku` appears verbatim is marked Inactive.
    const keys = exactSkuList(skus);
    if (!prisma) {
      const store = loadFileStore();
      const listed = new Set(keys);
      let inactive = 0;
      for (const p of store.products) {
        p.isInactive = listed.has(p.sku);
        if (p.isInactive) inactive++;
      }
      saveFileStore(store);
      return NextResponse.json({ ok: true, skus: keys.length, fileRows: skus.length, total: store.products.length, inactive });
    }
    try {
      const { markedInactive } = await applyInactiveSkuList(prisma, skus);
      const total = await prisma.product.count();
      return NextResponse.json({ ok: true, skus: keys.length, fileRows: skus.length, total, inactive: markedInactive });
    } catch (e) {
      if (isDbConnectionError(e)) return dbUnreachableResponse();
      return NextResponse.json({ error: "Inactive import failed. Check the database connection and try again." }, { status: 500 });
    }
  }

  const { products, columns } = parseInventoryFile(buf);
  if (!products.length) {
    return NextResponse.json(
      { error: `No inventory rows found. Detected columns: ${columns.join(", ") || "(none)"}. Make sure the file has a SKU column plus product details.` },
      { status: 400 },
    );
  }
  if (!prisma) {
    const store = loadFileStore();
    const bySku = new Map(store.products.map((p) => [p.sku, p]));
    let created = 0, updated = 0;
    for (const p of products) {
      const normKey = String(p.sku).trim().replace(/[\s-]+/g, "");
      const ex = bySku.get(p.sku);
      if (ex) {
        ex.productNumber = p.productNumber; ex.description = p.description;
        ex.vendor = p.vendor; ex.brand = p.brand;
        ex.listCost = p.listCost || "0"; ex.price = p.price || "0";
        ex.sizeDesc = p.sizeDesc; ex.normalizedSku = normKey;
        // A full inventory import defines status: rows in the file come back
        // Active, matching the ON CONFLICT clause used by the Prisma path.
        ex.isInactive = false;
        updated++;
      } else {
        const row = {
          id: cuid(), sku: p.sku, normalizedSku: normKey,
          productNumber: p.productNumber, description: p.description, vendor: p.vendor,
          brand: p.brand, listCost: p.listCost || "0", price: p.price || "0",
          sizeDesc: p.sizeDesc, isInactive: false,
        };
        store.products.push(row); bySku.set(p.sku, row); created++;
      }
    }
    saveFileStore(store);
    return NextResponse.json({ ok: true, detected: products.length, created, updated, total: store.products.length });
  }

  // Bulk upsert: one INSERT ... ON CONFLICT ("sku") DO UPDATE per 1,000-row
  // batch. This replaces the old `$transaction([...50 update()])` loop, which
  // issued one statement per product (~21,000 round-trips for a weekly file,
  // guaranteed to hit the 60s serverless cap and leave a partial import).
  try {
    let inserted = 0, updated = 0, processed = 0, skipped = 0;
    const failed: { row: number; sku: string; reason: string }[] = [];
    for (const [i, batch] of chunkRows(products, MAX_BATCH_ROWS).entries()) {
      const outcome = await importInventoryBatch(prisma, batch, 2 + i * MAX_BATCH_ROWS);
      inserted += outcome.inserted;
      updated += outcome.updated;
      processed += outcome.processed;
      skipped += outcome.skipped;
      failed.push(...outcome.failed);
    }
    const total = await prisma.product.count();
    return NextResponse.json({
      ok: true, detected: products.length, created: inserted, inserted, updated,
      processed, skipped, failed, total,
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Inventory import failed. Check the database connection and try again." }, { status: 500 });
  }
}
