import * as XLSX from "xlsx";
import { formatAdHocCountDate, type AdHocCountItemData } from "./adhocCount";

/**
 * Excel export for Ad Hoc Inventory Count Sheets ("Export for Teams").
 *
 * Generated as genuine OOXML (.xlsx) using CFB zip packaging.
 * Features:
 * - Exactly nine columns in specified order:
 *   SKU/UPC, Brand, Description, Size Desc., QQH, LAYWAY, PREPAID, Expiry, On Transfer
 * - Clean title, date, and editable Staff entry field
 * - Freeze panes: vertical (top 5 rows) AND horizontal (first 4 columns)
 * - Worksheet protection: locked first 4 columns, unlocked 5 count columns + staff field
 * - Leading zero preservation for UPC strings
 */

export const AD_HOC_EXCEL_HEADERS = [
  "SKU/UPC",
  "Brand",
  "Description",
  "Size Desc.",
  "QQH",
  "LAYWAY",
  "PREPAID",
  "Expiry",
  "On Transfer",
] as const;

export const AD_HOC_HEADER_ROW = 5;

const COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

function esc(v: string | number | null | undefined): string {
  return String(v ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* Style index references into STYLES_XML */
const S = {
  title: 1,
  label: 2,
  staffInput: 3,
  info: 4,
  header: 5,
  lockedText: 6,
  lockedTextAlt: 7,
  editable: 8,
  editableAlt: 9,
} as const;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1">
<numFmt numFmtId="164" formatCode="@"/>
</numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="16"/><name val="Calibri"/><family val="2"/><color rgb="FF1E293B"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/><color rgb="FF1E293B"/></font>
<font><sz val="11"/><name val="Calibri"/><family val="2"/><color rgb="FF475569"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFFBEB"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>
<border><left/><right/><top/><bottom style="medium"><color rgb="FF1E293B"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<!-- 0: default (locked by default) -->
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyProtection="1"><protection locked="1"/></xf>
<!-- 1: title -->
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyProtection="1" applyAlignment="1"><alignment vertical="center"/><protection locked="1"/></xf>
<!-- 2: label -->
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyProtection="1" applyAlignment="1"><alignment vertical="center"/><protection locked="1"/></xf>
<!-- 3: staffInput (unlocked with bottom border) -->
<xf numFmtId="0" fontId="0" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyProtection="1"><alignment vertical="center"/><protection locked="0"/></xf>
<!-- 4: info -->
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyProtection="1" applyAlignment="1"><alignment vertical="center"/><protection locked="1"/></xf>
<!-- 5: header (bold with fill and border, locked) -->
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyProtection="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/><protection locked="1"/></xf>
<!-- 6: lockedText (inventory columns: A-D, locked) -->
<xf numFmtId="49" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyProtection="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/><protection locked="1"/></xf>
<!-- 7: lockedTextAlt (alternating row, locked) -->
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyProtection="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/><protection locked="1"/></xf>
<!-- 8: editable (staff count columns: E-I, unlocked) -->
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyProtection="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/><protection locked="0"/></xf>
<!-- 9: editableAlt (alternating editable, unlocked) -->
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyProtection="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/><protection locked="0"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function strCell(ref: string, val: string | number | null | undefined, style: number): string {
  const v = String(val ?? "").trim();
  if (v === "") return `<c r="${ref}" s="${style}"/>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

export interface AdHocWorkbookOptions {
  sheetName?: string;
  date?: Date;
}

function buildSheetXml(items: AdHocCountItemData[], opts: AdHocWorkbookOptions): string {
  const H = AD_HOC_HEADER_ROW;
  const lastRow = H + Math.max(items.length, 1);
  const dateStr = formatAdHocCountDate(opts.date ?? new Date());
  const sheetName = opts.sheetName || "Inventory Count";

  const rowsXml: string[] = [];

  // Row 1: INVENTORY COUNTS
  rowsXml.push(`<row r="1" ht="26" customHeight="1">${strCell("A1", "INVENTORY COUNTS", S.title)}</row>`);

  // Row 2: Date
  rowsXml.push(`<row r="2" ht="20" customHeight="1">${strCell("A2", `Date: ${dateStr}`, S.label)}</row>`);

  // Row 3: Staff entry field (unlocked)
  rowsXml.push(
    `<row r="3" ht="22" customHeight="1">` +
    strCell("A3", "Staff:", S.label) +
    ["B3", "C3", "D3"].map((ref) => `<c r="${ref}" s="${S.staffInput}"/>`).join("") +
    `</row>`,
  );

  // Row 4: Sheet Name & item count info
  rowsXml.push(
    `<row r="4" ht="20" customHeight="1">${strCell("A4", `Sheet: ${sheetName}   •   ${items.length} product${items.length === 1 ? "" : "s"}`, S.info)}</row>`,
  );

  // Row 5: Column Headers
  rowsXml.push(
    `<row r="${H}" ht="24" customHeight="1">` +
    AD_HOC_EXCEL_HEADERS.map((header, i) => strCell(`${COLS[i]}${H}`, header, S.header)).join("") +
    `</row>`,
  );

  // Product Rows
  items.forEach((item, idx) => {
    const rNum = H + 1 + idx;
    const isAlt = idx % 2 === 1;
    const lockedStyle = isAlt ? S.lockedTextAlt : S.lockedText;
    const editStyle = isAlt ? S.editableAlt : S.editable;

    const rowCells = [
      strCell(`A${rNum}`, item.sku, lockedStyle),
      strCell(`B${rNum}`, item.brand, lockedStyle),
      strCell(`C${rNum}`, item.description, lockedStyle),
      strCell(`D${rNum}`, item.sizeDesc, lockedStyle),
      strCell(`E${rNum}`, item.qqh, editStyle),
      strCell(`F${rNum}`, item.layway, editStyle),
      strCell(`G${rNum}`, item.prepaid, editStyle),
      strCell(`H${rNum}`, item.expiry, editStyle),
      strCell(`I${rNum}`, item.onTransfer, editStyle),
    ];

    rowsXml.push(`<row r="${rNum}" ht="20" customHeight="1">${rowCells.join("")}</row>`);
  });

  // Column widths: A=18, B=24, C=44, D=16, E=12, F=12, G=12, H=16, I=16
  const widths = [18, 24, 44, 16, 12, 12, 12, 16, 16];

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr filterMode="0"><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:I${lastRow}"/>
<sheetViews>
  <sheetView workbookViewId="0" zoomScale="110" zoomScaleNormal="110">
    <pane xSplit="4" ySplit="${H}" topLeftCell="E${H + 1}" activePane="bottomRight" state="frozen"/>
    <selection pane="bottomRight" activeCell="E${H + 1}" sqref="E${H + 1}"/>
  </sheetView>
</sheetViews>
<sheetFormatPr defaultRowHeight="18" customHeight="1"/>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${rowsXml.join("")}</sheetData>
<sheetProtection sheet="1" objects="1" scenarios="1" formatColumns="0" formatRows="0" autoFilter="0" sort="0" selectLockedCells="0" selectUnlockedCells="0"/>
<autoFilter ref="A${H}:I${lastRow}"/>
<mergeCells count="3">
  <mergeCell ref="A1:I1"/>
  <mergeCell ref="B3:D3"/>
  <mergeCell ref="A4:I4"/>
</mergeCells>
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
<headerFooter>
  <oddHeader>&amp;L&amp;B${esc(sheetName)}&amp;RDate: ${esc(dateStr)}</oddHeader>
  <oddFooter>&amp;LAd Hoc Inventory Count&amp;RPage &amp;P of &amp;N</oddFooter>
</headerFooter>
</worksheet>`;
}

/**
 * Builds the complete .xlsx (OOXML workbook) Buffer for Teams count sheet.
 */
export function buildAdHocCountWorkbook(
  items: AdHocCountItemData[],
  opts: AdHocWorkbookOptions = {},
): Buffer {
  const H = AD_HOC_HEADER_ROW;
  const lastRow = H + Math.max(items.length, 1);
  const sheetName = (opts.sheetName || "Inventory Count").slice(0, 31);

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
<sheets><sheet name="Inventory Count" sheetId="1" r:id="rId1"/></sheets>
<definedNames>
  <definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Inventory Count'!$A$${H}:$I$${lastRow}</definedName>
  <definedName name="_xlnm.Print_Titles" localSheetId="0">'Inventory Count'!$${H}:$${H}</definedName>
</definedNames>
</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    "xl/styles.xml": STYLES_XML,
    "xl/worksheets/sheet1.xml": buildSheetXml(items, opts),
  };

  const CFB = XLSX.CFB as unknown as {
    utils: {
      cfb_new: () => unknown;
      cfb_add: (c: unknown, name: string, content: Buffer) => void;
      cfb_del: (c: unknown, name: string) => void;
    };
    write: (c: unknown, o: { fileType: "zip"; type: "buffer"; compression?: boolean }) => Buffer | Uint8Array;
  };

  const zip = CFB.utils.cfb_new();
  try {
    CFB.utils.cfb_del(zip, "\u0001Sh33tJ5");
  } catch {
    /* not present */
  }

  for (const [name, xml] of Object.entries(files)) {
    CFB.utils.cfb_add(zip, name, Buffer.from(xml, "utf8"));
  }

  const out = CFB.write(zip, { fileType: "zip", type: "buffer", compression: true });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}
