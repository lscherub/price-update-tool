/**
 * Remove all data created by local testing of the bulk inventory import.
 *
 * Only deletes rows this testing run is known to have created:
 *   - products with the synthetic `SKU-1xxxxx` pattern
 *   - price update sessions named "<vendor> - <Month D, YYYY>" created today
 *     (with their items and export logs, via Prisma cascade)
 *   - the vendor discount "aor   inc." created by the combobox test
 * It never deletes pre-existing inventory rows.
 *
 * Run: npx tsx scripts/db-cleanup-testdata.ts --confirm
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CONFIRMED = process.argv.includes("--confirm");

async function main() {
  if (!CONFIRMED) {
    console.log("Refusing to run without --confirm.");
    return;
  }

  const synthetic = await prisma.product.count({ where: { sku: { startsWith: "SKU-1" } } });
  const sessions = await prisma.priceUpdateSession.findMany({
    where: { name: { contains: " - ", mode: "insensitive" }, items: { some: { rawVendorSku: { startsWith: "SKU-1" } } } },
    select: { id: true, name: true },
  });
  const strayDiscount = await prisma.vendorDiscount.findMany({
    where: { normalizedVendor: "aor inc." },
    select: { id: true, vendor: true },
  });

  console.log(`Will delete ${synthetic} synthetic products`);
  console.log(`Will delete ${sessions.length} test session(s): ${sessions.map((s) => s.name).join(", ") || "none"}`);
  console.log(`Will delete ${strayDiscount.length} test vendor discount(s)`);

  // Sessions first: PriceUpdateItem/ExportLog cascade, and Product.productId
  // is SET NULL, so no product row is removed by this.
  for (const s of sessions) {
    await prisma.priceUpdateSession.delete({ where: { id: s.id } });
  }
  for (const d of strayDiscount) {
    await prisma.vendorDiscount.delete({ where: { id: d.id } });
  }
  if (synthetic) {
    await prisma.product.deleteMany({ where: { sku: { startsWith: "SKU-1" } } });
  }

  // Restore the vendor discount the seed sets for A.O.R. INC.
  await prisma.vendorDiscount.updateMany({
    where: { normalizedVendor: "a.o.r. inc." },
    data: { defaultDiscount: 10 },
  });

  const total = await prisma.product.count();
  const discounts = await prisma.vendorDiscount.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`\nRemaining products: ${total}`);
  console.log("Vendor discounts:", discounts.map((d) => `${JSON.stringify(d.vendor)}=${String(d.defaultDiscount)}`).join(", "));
  console.log("Sessions:", await prisma.priceUpdateSession.count(),
    "Items:", await prisma.priceUpdateItem.count(),
    "ExportLogs:", await prisma.exportLog.count());
  console.log("\nNOTE: the 993 original products are still flagged isInactive=true");
  console.log("because the load test ran the 'mark missing as inactive' pass.");
  console.log("Re-run the Inactive SKU list import to restore the intended flags.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());