import { NextResponse } from "next/server";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { requireHelpAdmin, requireHelpReader } from "@/lib/helpAuth";
import { deleteHelpImage, readHelpImageBinary } from "@/lib/helpImageStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireHelpReader();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const { id } = await ctx.params;
  try {
    const bin = await readHelpImageBinary(prisma, id);
    if (!bin) return NextResponse.json({ error: "Image not found." }, { status: 404 });
    return new NextResponse(new Uint8Array(bin.buffer), {
      headers: {
        "Content-Type": bin.mimeType,
        "Content-Disposition": `inline; filename="${bin.filename.replace(/["\r\n\\]/g, "")}"`,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not load image." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireHelpAdmin();
  if (!auth.ok) return auth.response;

  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  const { id } = await ctx.params;
  try {
    const ok = await deleteHelpImage(prisma, id);
    if (!ok) return NextResponse.json({ error: "Image not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    return NextResponse.json({ error: "Could not delete image." }, { status: 500 });
  }
}
