import { NextResponse } from "next/server";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { requireHelpAdmin } from "@/lib/helpAuth";
import { listHelpImages, uploadHelpImage } from "@/lib/helpImageStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireHelpAdmin();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const images = await listHelpImages(prisma);
    return NextResponse.json({ images }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not list uploaded images." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireHelpAdmin();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Select an image file to upload." }, { status: 400 });
    }
    const altText = typeof form.get("altText") === "string" ? String(form.get("altText")) : "";
    const caption = typeof form.get("caption") === "string" ? String(form.get("caption")) : "";
    const buffer = Buffer.from(await file.arrayBuffer());

    const res = await uploadHelpImage(prisma, {
      buffer,
      mimeType: file.type || "application/octet-stream",
      originalFilename: file.name || "screenshot.png",
      altText,
      caption,
      uploadedBy: auth.session.email,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ ok: true, image: res.image }, { status: 201 });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not upload image." }, { status: 500 });
  }
}
