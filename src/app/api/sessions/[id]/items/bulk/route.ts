import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPrisma, dbUnreachableResponse, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { computeItemsBulk, persistItemsBulk, type AddItemInput, type ComputedItem } from "@/lib/addItem";
import { parseBulkPaste, parseBulkFile } from "@/lib/importers";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 20000;

function cleanNum(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).replace(/[$,%]/g, "").trim();
}
function cleanText(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}

/** Normalise one parsed row into the server-side input the compute expects. */
function toInput(r: Record<string, unknown>): AddItemInput {
  return {
    rawVendorSku: cleanText(r.rawVendorSku),
    cleanedSku: cleanText(r.cleanedSku),
    discount: cleanNum(r.discount),
    // blank price -> "" (compute treats "" as no price, i.e. null)
    vendorListPriceNew: cleanNum(r.vendorListPriceNew) || "",
    marginDivisor: cleanNum(r.marginDivisor),
    notes: cleanText(r.notes),
  };
}

/** Projection consumed by the client preview table. */
function toPreview(c: ComputedItem) {
  return {
    index: c.index,
    rawVendorSku: c.rawVendorSku,
    cleanedSku: c.cleanedSku,
    discount: c.discount,
    vendorListPriceNew: c.vendorListPriceNew,
    marginDivisor: c.marginDivisor,
    notes: c.notes,
    matched: c.matched,
    isInactive: c.isInactive,
    productNumber: c.productNumber,
    productName: c.productName,
    brand: c.brand,
    vendor: c.vendor,
    currentListPrice: c.currentListPrice,
    ourNewListPrice: c.ourNewListPrice,
    ourNewRetailPrice: c.ourNewRetailPrice,
    oldRetailPrice: c.oldRetailPrice,
    nearest9: c.nearest9,
    invalid: c.invalid,
    invalidReason: c.invalidReason,
  };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const ct = req.headers.get("content-type") ?? "";
  let action = "";
  let inputs: AddItemInput[] = [];

  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    action = String(form.get("action") ?? "").trim();
    if (action === "preview") {
      const file = form.get("file") as File | null;
      if (!file) return NextResponse.json({ error: "No file selected. Choose an Excel or CSV file to upload." }, { status: 400 });
      if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "File is too large (max 8 MB). Split the file and try again." }, { status: 413 });
      const buf = Buffer.from(await file.arrayBuffer());
      if (!buf.length) return NextResponse.json({ error: "The uploaded file is empty." }, { status: 400 });
      inputs = parseBulkFile(buf, file.name).map((r) =>
        toInput({ rawVendorSku: r.rawVendorSku, cleanedSku: r.cleanedSku, discount: r.discount, vendorListPriceNew: r.vendorListPriceNew, marginDivisor: r.marginDivisor, notes: r.notes }),
      );
    } else {
      return NextResponse.json({ error: "multipart/form-data is only supported for action=preview with a file." }, { status: 400 });
    }
  } else {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    action = String(body.action ?? "").trim();
    if (Array.isArray(body.rows)) {
      inputs = (body.rows as Record<string, unknown>[]).map(toInput);
    } else if (body.text) {
      inputs = parseBulkPaste(String(body.text)).map((r) =>
        toInput({ rawVendorSku: r.rawVendorSku, cleanedSku: r.cleanedSku, discount: r.discount, vendorListPriceNew: r.vendorListPriceNew, marginDivisor: r.marginDivisor, notes: r.notes }),
      );
    }
  }

  if (action !== "preview" && action !== "add") {
    return NextResponse.json({ error: "action must be 'preview' or 'add'." }, { status: 400 });
  }
  if (!inputs.length) {
    return NextResponse.json({
      error: action === "preview"
        ? "No rows to process. Paste data or upload a file first."
        : "No rows to add.",
    }, { status: 400 });
  }
  if (inputs.length > MAX_ROWS) return NextResponse.json({ error: `Too many rows (max ${MAX_ROWS}). Split the file and try again.` }, { status: 400 });

  let computed: ComputedItem[];
  try {
    computed = await computeItemsBulk(inputs);
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Price matching failed. Check the database connection and try again." }, { status: 500 });
  }

  if (action === "preview") {
    return NextResponse.json({ ok: true, rows: computed.map(toPreview) });
  }

  // action === "add": recompute (never trust the client's computed prices) + persist.
  try {
    const created = await persistItemsBulk(id, computed);
    const matched = created.filter((r) => r.matched).length;
    const unmatched = created.filter((r) => !r.matched).length;
    const skipped = computed.length - created.length;
    return NextResponse.json({
      ok: true,
      added: created.length,
      ids: created.map((r) => r.id),
      matched,
      unmatched,
      skipped,
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    if (/price update not found/i.test(String((e as { message?: string })?.message ?? ""))) {
      return NextResponse.json({ error: "Price update not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not save the rows." }, { status: 500 });
  }
}
