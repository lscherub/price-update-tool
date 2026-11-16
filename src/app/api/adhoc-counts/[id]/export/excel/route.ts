import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbUnreachableResponse, getPrisma, isDbConnectionError, productionDbGuard } from "@/lib/db";
import { getAdHocSheet } from "@/lib/adhocCountServer";
import { buildAdHocCountWorkbook } from "@/lib/adhocCountExcel";
import { generateTeamsCountFilename } from "@/lib/adhocCount";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const prisma = getPrisma();
  const prodErr = productionDbGuard(prisma);
  if (prodErr) return prodErr;

  try {
    const sheet = await getAdHocSheet(id);
    if (!sheet) {
      return NextResponse.json({ error: "Count sheet not found" }, { status: 404 });
    }

    const now = new Date();
    const buffer = buildAdHocCountWorkbook(sheet.items, {
      sheetName: sheet.name,
      date: now,
    });

    const filename = generateTeamsCountFilename(sheet.name, now);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (e: any) {
    if (isDbConnectionError(e)) return dbUnreachableResponse();
    console.error("Failed to export Excel count sheet:", e);
    return NextResponse.json({ error: e?.message || "Could not generate Excel export." }, { status: 500 });
  }
}
