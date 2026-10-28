import * as XLSX from "xlsx";
import { storeCountNewPrice } from "@/lib/storeCountPricing";

/**
 * Digital Store Count workbook for the Full Vendor Price Update.
 *
 * Written as raw OOXML (zipped with the CFB module that ships inside `xlsx`)
 * because the community `xlsx` build cannot write cell styles, locked/unlocked
 * cells or frozen panes. Nothing here is shared with the existing Store Count
 * PDF/Excel exports, which are untouched.
 */

export const FULL_VENDOR_COUNT_HEADER = [
  "SKU", "Description", "Size Desc.", "New Price", "QOH", "Layaway", "Prepaid", "Expiry", "Notes",
] as const;

export const FULL_VENDOR_COUNT_INSTRUCTIONS =
  "Please check all layaways, holds for transfers, overstock etc. Please note page # on each page.";
export const FULL_VENDOR_COUNT_NOTE =
  "If the New Price is empty, there is no price change. However, all items must still be counted for QOH and Expiry.";

/** Header row (1-based) of the table; rows above it are the sheet heading. */
export const FULL_VENDOR_HEADER_ROW = 6;

export type FullVendorCountRow = { sku: string; description: string; sizeDesc: string; newPrice: string };

/**
 * New Price = the final effective worksheet price (Nearest 9, which already
 * holds any custom override), blank when there is no actual change — the
 * exact rule of the existing Store Count PDF (`storeCountNewPrice`).
 */
export function fullVendorNewPrice(nearest9: string | null | undefined, oldRetailPrice: string | null | undefined): string {
  return storeCountNewPrice(nearest9 ?? null, oldRetailPrice ?? null);
}

/** "October 28, 2026" */
export function formatCountDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function esc(v: string): string {
  return String(v ?? "")
    // Strip characters that are illegal in XML 1.0.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

/* Style indexes into cellXfs below. */
const S = {
  title: 1, label: 2, staffInput: 3, instructions: 4, note: 5, header: 6,
  lockedText: 7, lockedPrice: 8, editable: 9, info: 10,
} as const;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts>
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="16"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="12"/><color rgb="FF9C0006"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="12"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>
<border><left/><right/><top/><bottom style="medium"><color rgb="FF000000"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyProtection="1"><protection locked="0"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="1" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyProtection="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/><protection locked="0"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function strCell(ref: string, v: string, s: number): string {
  return v === "" ? `<c r="${ref}" s="${s}"/>` : `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function priceCell(ref: string, v: string, s: number): string {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  if (v === "" || !Number.isFinite(n)) return `<c r="${ref}" s="${s}"/>`;
  return `<c r="${ref}" s="${s}"><v>${n}</v></c>`;
}

function sheetXml(rows: FullVendorCountRow[], opts: { dateLabel: string; vendor: string }): string {
  const H = FULL_VENDOR_HEADER_ROW;
  const last = H + Math.max(rows.length, 1);
  const out: string[] = [];
  out.push(`<row r="1" ht="24" customHeight="1">${strCell("A1", opts.dateLabel, S.title)}</row>`);
  out.push(
    `<row r="2" ht="22" customHeight="1">${strCell("A2", "Staff:", S.label)}` +
    ["B2", "C2", "D2"].map((r) => strCell(r, "", S.staffInput)).join("") + `</row>`,
  );
  out.push(`<row r="3" ht="34" customHeight="1">${strCell("A3", FULL_VENDOR_COUNT_INSTRUCTIONS, S.instructions)}</row>`);
  out.push(`<row r="4" ht="38" customHeight="1">${strCell("A4", FULL_VENDOR_COUNT_NOTE, S.note)}${COLS.slice(1).map((c) => strCell(`${c}4`, "", S.note)).join("")}</row>`);
  out.push(`<row r="5">${strCell("A5", `Vendor: ${opts.vendor}   •   ${rows.length} item${rows.length === 1 ? "" : "s"}`, S.info)}</row>`);
  out.push(`<row r="${H}" ht="20" customHeight="1">${FULL_VENDOR_COUNT_HEADER.map((h, i) => strCell(`${COLS[i]}${H}`, h, S.header)).join("")}</row>`);
  rows.forEach((r, i) => {
    const n = H + 1 + i;
    out.push(
      `<row r="${n}">` +
      strCell(`A${n}`, r.sku, S.lockedText) +
      strCell(`B${n}`, r.description, S.lockedText) +
      strCell(`C${n}`, r.sizeDesc, S.lockedText) +
      priceCell(`D${n}`, r.newPrice, S.lockedPrice) +
      ["E", "F", "G", "H", "I"].map((c) => `<c r="${c}${n}" s="${S.editable}"/>`).join("") +
      `</row>`,
    );
  });

  const widths = [18, 46, 13, 11, 9, 10, 10, 13, 32];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr filterMode="0"><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:I${last}"/>
<sheetViews><sheetView workbookViewId="0" zoomScale="110" zoomScaleNormal="110"><pane ySplit="${H}" topLeftCell="A${H + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="E${H + 1}" sqref="E${H + 1}"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18" customHeight="1"/>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${out.join("")}</sheetData>
<sheetProtection sheet="1" objects="1" scenarios="1" formatColumns="0" formatRows="0" autoFilter="0" sort="0" selectLockedCells="0" selectUnlockedCells="0"/>
<autoFilter ref="A${H}:I${last}"/>
<mergeCells count="4"><mergeCell ref="A1:I1"/><mergeCell ref="B2:D2"/><mergeCell ref="A3:I3"/><mergeCell ref="A4:I4"/></mergeCells>
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
<headerFooter><oddFooter>&amp;LStore Count - ${esc(opts.vendor)}&amp;RPage &amp;P of &amp;N</oddFooter></headerFooter>
</worksheet>`;
}

/** Build the .xlsx (real OOXML workbook) as a Buffer. */
export function buildFullVendorCountWorkbook(
  rows: FullVendorCountRow[],
  opts: { date?: Date; vendor?: string } = {},
): Buffer {
  const dateLabel = formatCountDate(opts.date ?? new Date());
  const vendor = String(opts.vendor ?? "").trim();
  const H = FULL_VENDOR_HEADER_ROW;
  const last = H + Math.max(rows.length, 1);
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets><sheet name="Store Count" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Store Count'!$A$${H}:$I$${last}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'Store Count'!$${H}:$${H}</definedName></definedNames>
</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    "xl/styles.xml": STYLES_XML,
    "xl/worksheets/sheet1.xml": sheetXml(rows, { dateLabel, vendor }),
  };

  const CFB = XLSX.CFB as unknown as {
    utils: { cfb_new: () => unknown; cfb_add: (c: unknown, name: string, content: Buffer) => void; cfb_del: (c: unknown, name: string) => void };
    write: (c: unknown, o: { fileType: "zip"; type: "buffer"; compression?: boolean }) => Buffer | Uint8Array;
  };
  const zip = CFB.utils.cfb_new();
  // cfb_new seeds a placeholder entry used by the compound-file format; drop it.
  try { CFB.utils.cfb_del(zip, "\u0001Sh33tJ5"); } catch { /* not present */ }
  for (const [name, xml] of Object.entries(files)) CFB.utils.cfb_add(zip, name, Buffer.from(xml, "utf8"));
  const out = CFB.write(zip, { fileType: "zip", type: "buffer", compression: true });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

