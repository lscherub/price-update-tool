/**
 * Load test for the inventory import: drives the real API the same way the
 * browser does (parse locally -> 1,000-row JSON batches) and prints progress.
 *
 * ⚠️  THIS WRITES TO THE CONFIGURED DATABASE (DATABASE_URL), which in this
 * project is the live Supabase instance. It will overwrite real product rows.
 * Only run it against a throwaway database.
 *
 * Usage: npx tsx scripts/loadtest-import.ts <file.xlsx> --i-know-this-is-a-test-db
 */
import fs from "fs";
import { parseInventoryArrayBuffer } from "../src/lib/importers";
import { chunk, MAX_BATCH_ROWS } from "../src/lib/inventoryImport";

const ACK = "--i-know-this-is-a-test-db";
if (!process.argv.includes(ACK)) {
  console.error(
    `Refusing to run: this writes to DATABASE_URL (the live database).\n` +
    `Point DATABASE_URL at a throwaway database first, then re-run with ${ACK}.`,
  );
  process.exit(1);
}

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const COOKIE = process.env.SESSION_COOKIE ?? "";
const file = process.argv[2] ?? "test-data/big-inventory.xlsx";

type Failure = { row: number; sku: string; reason: string };

async function main() {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const t0 = Date.now();
  const { products } = parseInventoryArrayBuffer(ab);
  const parseMs = Date.now() - t0;

  const batches = chunk(products, MAX_BATCH_ROWS);
  console.log(`Parsed ${products.length.toLocaleString()} rows in ${parseMs}ms -> ${batches.length} batches of ${MAX_BATCH_ROWS}`);

  let processed = 0, inserted = 0, updated = 0, skipped = 0;
  const failed: Failure[] = [];
  const t1 = Date.now();
  for (const [i, rows] of batches.entries()) {
    const started = Date.now();
    const r = await fetch(`${BASE}/api/inventory/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: COOKIE },
      body: JSON.stringify({ rows, startRow: 2 + i * MAX_BATCH_ROWS }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.log(`  batch ${i + 1}: HTTP ${r.status} ${JSON.stringify(d)}`);
      failed.push(...rows.map((x, j) => ({ row: 2 + i * MAX_BATCH_ROWS + j, sku: x.sku, reason: `HTTP ${r.status}` })));
      processed += rows.length;
      continue;
    }
    processed += d.processed ?? rows.length;
    inserted += d.inserted ?? 0;
    updated += d.updated ?? 0;
    skipped += d.skipped ?? 0;
    failed.push(...(d.failed ?? []));
    console.log(
      `  batch ${String(i + 1).padStart(2)}/${batches.length}  ${String(processed).padStart(6)}/${products.length}` +
      `  ins=${inserted} upd=${updated} skip=${skipped} fail=${failed.length}  ${Date.now() - started}ms`,
    );
  }
  const total = await fetch(`${BASE}/api/dashboard`, { headers: { cookie: COOKIE } }).then((r) => r.json());

  console.log("\n=== IMPORT COMPLETE ===");
  console.log(`Processed: ${processed.toLocaleString()} / ${products.length.toLocaleString()}`);
  console.log(`Inserted: ${inserted.toLocaleString()}`);
  console.log(`Updated:  ${updated.toLocaleString()}`);
  console.log(`Skipped:  ${skipped.toLocaleString()}`);
  console.log(`Failed:   ${failed.length.toLocaleString()}`);
  console.log(`DB total products: ${(total.totals?.products ?? 0).toLocaleString()}`);
  console.log(`Wall clock: ${((Date.now() - t1) / 1000).toFixed(1)}s (import), ${parseMs}ms (parse)`);
  if (failed.length) console.log("First failures:", failed.slice(0, 5));
}

main().catch((e) => { console.error(e); process.exit(1); });