import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth";
import { cuid, emptyStore, saveFileStore } from "../src/lib/store";
import { normalizeSku, normalizeVendor } from "../src/lib/pricing";

const SAMPLE_PRODUCTS = [
  { sku: "62491794416", productNumber: "", description: "NA LAVAROX ORAL-BIOTIC SINGLE SCHT", vendor: "A.O.R. INC.", brand: "AOR", listCost: "1.63", price: "2.63", sizeDesc: "1SCHT" },
  { sku: "62491774008", productNumber: "AOR74008", description: "NA VIT K2 SOFTGEL", vendor: "A.O.R. INC.", brand: "AOR", listCost: "19.66", price: "31.70", sizeDesc: "60VSG" },
  { sku: "62491774007", productNumber: "AOR74007", description: "NA VIT D3", vendor: "A.O.R. INC.", brand: "AOR", listCost: "20.70", price: "33.39", sizeDesc: "120VSG" },
];

const SAMPLE_DISCOUNTS = [
  { vendor: "ADVANTAGE HEALTH (AHM )", defaultDiscount: "10.00" },
  { vendor: "AFRICAN FAIR TRADE CO. (AFT)", defaultDiscount: "0.00" },
  { vendor: "A.O.R. INC.", defaultDiscount: "10.00" },
];

async function seedPostgres(adminEmail: string | undefined, adminPassword: string | undefined) {
  // Production database seeding. Uses the Prisma schema (migrations must run first).
  // Admin credentials come ONLY from env vars — never hardcoded.
  if (!adminEmail || !adminPassword) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD env vars to seed the production database.");
  }
  const prisma = new PrismaClient();
  try {
    for (const p of SAMPLE_PRODUCTS) {
      await prisma.product.upsert({
        where: { sku: p.sku },
        update: {
          normalizedSku: normalizeSku(p.sku) || p.sku,
          productNumber: p.productNumber, description: p.description,
          vendor: p.vendor, brand: p.brand, listCost: p.listCost, price: p.price,
          sizeDesc: p.sizeDesc,
        },
        create: {
          sku: p.sku, normalizedSku: normalizeSku(p.sku) || p.sku,
          productNumber: p.productNumber, description: p.description,
          vendor: p.vendor, brand: p.brand, listCost: p.listCost, price: p.price,
          sizeDesc: p.sizeDesc,
        },
      });
    }
    for (const d of SAMPLE_DISCOUNTS) {
      await prisma.vendorDiscount.upsert({
        where: { normalizedVendor: normalizeVendor(d.vendor) },
        update: { vendor: d.vendor, defaultDiscount: d.defaultDiscount },
        create: { vendor: d.vendor, normalizedVendor: normalizeVendor(d.vendor), defaultDiscount: d.defaultDiscount },
      });
    }
    const existing = await prisma.appUser.findUnique({ where: { email: adminEmail.trim().toLowerCase() } });
    if (!existing) {
      await prisma.appUser.create({
        data: { email: adminEmail.trim().toLowerCase(), passwordHash: await hashPassword(adminPassword), role: "admin" },
      });
      console.log(`Seeded Postgres (created admin ${adminEmail.trim().toLowerCase()})`);
    } else {
      console.log(`Seeded Postgres (admin ${adminEmail.trim().toLowerCase()} already exists, left unchanged)`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function seedFileStore() {
  // Local development only. Never runs in production (productionDbGuard + saveFileStore
  // guard both refuse file-store writes on Vercel).
  const store = emptyStore();
  for (const p of SAMPLE_PRODUCTS) {
    store.products.push({ id: cuid(), ...p, normalizedSku: normalizeSku(p.sku) || p.sku, isInactive: false });
  }
  for (const d of SAMPLE_DISCOUNTS) {
    store.vendorDiscounts.push({ id: cuid(), vendor: d.vendor, normalizedVendor: normalizeVendor(d.vendor), defaultDiscount: d.defaultDiscount });
  }
  store.users.push({ id: cuid(), email: "admin@example.com", passwordHash: await hashPassword("admin123"), role: "admin" });
  saveFileStore(store);
  console.log("Seeded data/store.json (dev only: admin@example.com / admin123)");
}

async function main() {
  // If DATABASE_URL is set, seed Postgres (production path). Otherwise fall back
  // to the local JSON file store for development.
  if (process.env.DATABASE_URL) {
    await seedPostgres(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  } else {
    await seedFileStore();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
