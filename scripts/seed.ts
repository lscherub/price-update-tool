import { hashPassword } from "../src/lib/auth";
import { cuid, emptyStore, saveFileStore } from "../src/lib/store";
import { normalizeSku, normalizeVendor } from "../src/lib/pricing";

async function main() {
  const store = emptyStore();
  const products = [
    { sku: "62491794416", productNumber: "", description: "NA LAVAROX ORAL-BIOTIC SINGLE SCHT", vendor: "A.O.R. INC.", brand: "AOR", listCost: "1.63", price: "2.63", sizeDesc: "1SCHT" },
    { sku: "62491774008", productNumber: "AOR74008", description: "NA VIT K2 SOFTGEL", vendor: "A.O.R. INC.", brand: "AOR", listCost: "19.66", price: "31.70", sizeDesc: "60VSG" },
    { sku: "62491774007", productNumber: "AOR74007", description: "NA VIT D3", vendor: "A.O.R. INC.", brand: "AOR", listCost: "20.70", price: "33.39", sizeDesc: "120VSG" },
  ];
  for (const p of products) {
    store.products.push({ id: cuid(), ...p, normalizedSku: p.sku.replace(/[\s-]+/g, ""), isInactive: false });
  }
  store.vendorDiscounts.push(
    { id: cuid(), vendor: "ADVANTAGE HEALTH (AHM )", normalizedVendor: normalizeVendor("ADVANTAGE HEALTH (AHM )"), defaultDiscount: "10.00" },
    { id: cuid(), vendor: "AFRICAN FAIR TRADE CO. (AFT)", normalizedVendor: normalizeVendor("AFRICAN FAIR TRADE CO. (AFT)"), defaultDiscount: "0.00" },
    { id: cuid(), vendor: "A.O.R. INC.", normalizedVendor: normalizeVendor("A.O.R. INC."), defaultDiscount: "10.00" },
  );
  void normalizeSku;
  store.users.push({ id: cuid(), email: "admin@example.com", passwordHash: await hashPassword("admin123"), role: "admin" });
  saveFileStore(store);
  console.log("Seeded data/store.json (admin@example.com / admin123)");
}

main();
