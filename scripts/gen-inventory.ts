/** Generate a large synthetic inventory workbook for load testing. */
import * as XLSX from "xlsx";

const TOTAL = Number(process.argv[2] ?? 21000);
const OFFSET = Number(process.argv[3] ?? 0);
const out = process.argv[4] ?? "test-data/big-inventory.xlsx";

const vendors = [
  "A.O.R. INC.", "Flora Manufacturing & Distributing", "ABUNDANCE NATURALLY",
  "AC DISTRIBUTORS LTD.", "ADVANTAGE HEALTH (AHM )", "AFRICAN FAIR TRADE CO. (AFT)",
  "Benchmark Supplements", "Cornerstone Nutrition", "Delta Vitamin Co.",
];
const brands = ["AOR", "Flora", "Optimum", "Dymiti", "Nootropics Depot", "Bulk"];

const rows = Array.from({ length: TOTAL }, (_, i) => {
  const n = i + OFFSET;
  // Mix in deliberately bad values so the failure path is exercised too.
  const price = i % 5000 === 4999 ? "N/A" : (10 + (n % 9000) / 100).toFixed(2);
  const cost = i % 5000 === 4999 ? "12.00" : (5 + (n % 5000) / 100).toFixed(2);
  return {
    SKU: `SKU-${100000 + n}`,
    ProductNumber: `PN-${n}`,
    Description: `Supplement ${n} Whey Protein Isolate 2lb`,
    Vendor: vendors[n % vendors.length],
    Brand: brands[n % brands.length],
    ListCost: cost,
    Price: price,
    SizeDesc: `${1 + (n % 12)} LB`,
  };
});

const ws = XLSX.utils.json_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Inventory");
XLSX.writeFile(wb, out);
console.log(`wrote ${rows.length} rows to ${out}`);