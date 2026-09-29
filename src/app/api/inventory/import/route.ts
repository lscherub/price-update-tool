import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { getSession } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { cuid, loadFileStore, saveFileStore } from "@/lib/store";
import { parseInactiveFile, parseInventoryFile } from "@/lib/importers";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const mode = String(form.get("mode") ?? "inventory");
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const prisma = getPrisma();

  if (mode === "inactive") {
    const { normalizeSku } = await import("@/lib/pricing");
    const skus = parseInactiveFile(buf);
    const normSet = new Set<string>();
    const strip = (v: string) => v.replace(/^0+/, "") || "0";
    for (const s of skus) {
      const t = String(s).trim();
      if (!t) continue;
      const spaceless = t.replace(/[\s-]+/g, "");
      normSet.add(t);
      normSet.add(spaceless);
      normSet.add(strip(t));
      normSet.add(strip(spaceless));
      const n = normalizeSku(t);
      if (n) { normSet.add(n); normSet.add(strip(n)); }
    }
    const keys = [...normSet];
    if (!prisma) {
      const store = loadFileStore();
      for (const p of store.products) {
        p.isInactive = normSet.has(p.normalizedSku) || normSet.has(p.sku)
          || normSet.has(strip(p.normalizedSku)) || normSet.has(strip(p.sku));
      }
      saveFileStore(store);
      return NextResponse.json({ ok: true, keys: keys.length, total: store.products.length });
    }
    await prisma.product.updateMany({ data: { isInactive: false } });
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      await prisma.product.updateMany({ where: { normalizedSku: { in: chunk } }, data: { isInactive: true } });
      await prisma.product.updateMany({ where: { sku: { in: chunk } }, data: { isInactive: true } });
    }
    const total = await prisma.product.count();
    return NextResponse.json({ ok: true, keys: keys.length, total });
  }

  const { products } = parseInventoryFile(buf);
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
        ex.sizeDesc = p.sizeDesc; ex.normalizedSku = normKey; updated++;
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

  let created = 0, updated = 0;
  for (let i = 0; i < products.length; i += 500) {
    const chunk = products.slice(i, i + 500);
    const existing = await prisma.product.findMany({ where: { sku: { in: chunk.map((p) => p.sku) } } });
    const existMap = new Map(existing.map((e) => [e.sku, e]));
    for (const p of chunk) {
      const data = {
        normalizedSku: String(p.sku).trim().replace(/[\s-]+/g, ""),
        productNumber: p.productNumber, description: p.description,
        vendor: p.vendor, brand: p.brand,
        listCost: new Decimal(p.listCost || "0"), price: new Decimal(p.price || "0"),
        sizeDesc: p.sizeDesc,
      };
      const ex = existMap.get(p.sku);
      if (ex) { await prisma.product.update({ where: { id: ex.id }, data }); updated++; }
      else { await prisma.product.create({ data: { sku: p.sku, ...data } }); created++; }
    }
  }
  const total = await prisma.product.count();
  return NextResponse.json({ ok: true, detected: products.length, created, updated, total });
}
