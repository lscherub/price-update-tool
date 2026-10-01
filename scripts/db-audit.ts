/**
 * Inspect the live database so the damage from load testing can be scoped:
 * which products are synthetic, and what the original state looked like.
 * Read-only.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SEED_SKUS = ["62491794416", "62491774008", "62491774007"];

async function main() {
  const total = await prisma.product.count();
  const synthetic = await prisma.product.count({ where: { sku: { startsWith: "SKU-1" } } });
  const origInactive = await prisma.product.count({
    where: { NOT: { sku: { startsWith: "SKU-1" } }, isInactive: true },
  });
  const orig = total - synthetic;

  console.log("=== products ===");
  console.log(`total:            ${total}`);
  console.log(`synthetic SKU-1*: ${synthetic}`);
  console.log(`original:         ${orig}`);
  console.log(`original inactive: ${origInactive}  active: ${orig - origInactive}`);

  console.log("\n=== seed sample products (created by npm run seed) ===");
  const seedProducts = await prisma.product.findMany({
    where: { sku: { in: SEED_SKUS } },
    select: { sku: true, createdAt: true, updatedAt: true },
  });
  seedProducts.forEach((p) =>
    console.log(`${p.sku}  created=${p.createdAt.toISOString()}  updated=${p.updatedAt.toISOString()}`),
  );

  console.log("\n=== vendor discounts ===");
  const v = await prisma.vendorDiscount.findMany({ orderBy: { createdAt: "asc" } });
  v.forEach((d) => console.log(`${d.createdAt.toISOString()}  ${JSON.stringify(d.vendor)}  ${String(d.defaultDiscount)}`));

  console.log("\n=== sessions / items / export logs ===");
  const s = await prisma.priceUpdateSession.findMany({ select: { id: true, name: true, createdAt: true } });
  s.forEach((x) => console.log(`${x.createdAt.toISOString()}  ${x.id}  ${x.name}`));
  console.log("items:", await prisma.priceUpdateItem.count(), "exportLogs:", await prisma.exportLog.count());
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());