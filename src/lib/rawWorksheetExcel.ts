import * as XLSX from "xlsx";
import { getItemFlags, type SortableItemKey } from "@/lib/itemSort";

/**
 * Raw Price Update Worksheet Excel (.xlsx) exporter.
 *
 * Completely independent from POS CSV, Store Count PDF/Excel, and Digital Store Count.
 * Produces an unlocked, fully editable OOXML workbook reflecting the worksheet's
 * displayed columns, column order, column headings, and current values across all
 * applicable rows. Never modifies worksheet data or session status.
 */

export type RawWorksheetColKey = SortableItemKey;

export type RawWorksheetColumnSpec = {
  key: RawWorksheetColKey;
  label: string;
  kind: "text" | "price" | "percent" | "divisor" | "flags";
  width: number;
};

/**
 * Canonical allowlist of displayed worksheet columns (mirrors PriceGrid COLS + Flags
 * and SpreadsheetEditor SPREADSHEET_COLS). Internal DB metadata (id, sessionId,
 * productId, timestamps, internal booleans) is intentionally excluded.
 */
export const CANONICAL_RAW_WORKSHEET_COLUMNS: readonly RawWorksheetColumnSpec[] = [
  { key: "rawVendorSku", label: "Raw Vendor SKU/Code", kind: "text", width: 20 },
  { key: "cleanedSku", label: "Cleaned SKU", kind: "text", width: 18 },
  { key: "productNumber", label: "Product Number", kind: "text", width: 16 },
  { key: "productName", label: "Product Name", kind: "text", width: 38 },
  { key: "brand", label: "Brand", kind: "text", width: 18 },
  { key: "vendor", label: "Vendor", kind: "text", width: 22 },
  { key: "discount", label: "Discount (%) Vendor/Brand", kind: "percent", width: 18 },
  { key: "currentListPrice", label: "Current List Price", kind: "price", width: 16 },
  { key: "vendorListPriceNew", label: "Vendor List Price (New)", kind: "price", width: 18 },
  { key: "ourNewListPrice", label: "Our New List Price", kind: "price", width: 16 },
  { key: "marginDivisor", label: "Margin/Divisor", kind: "divisor", width: 15 },
  { key: "ourNewRetailPrice", label: "Our New Retail Price", kind: "price", width: 17 },
  { key: "oldRetailPrice", label: "Old Retail Price", kind: "price", width: 16 },
  { key: "nearest9", label: "Nearest 9", kind: "price", width: 14 },
  { key: "notes", label: "Notes", kind: "text", width: 30 },
  { key: "flags", label: "Flags", kind: "flags", width: 22 },
] as const;

const COL_MAP = new Map<string, RawWorksheetColumnSpec>(
  CANONICAL_RAW_WORKSHEET_COLUMNS.map((c) => [c.key, c]),
);

export type RawWorksheetRowInput = {
  rawVendorSku: string;
  cleanedSku: string;
  cleanedOverridden: boolean;
  productNumber: string;
  productName: string;
  brand: string;
  vendor: string;
  discount: string | null;
  currentListPrice: string | null;
  vendorListPriceNew: string | null;
  ourNewListPrice: string | null;
  marginDivisor: string | null;
  ourNewRetailPrice: string | null;
  oldRetailPrice: string | null;
  nearest9: string | null;
  nearest9Custom?: string | null;
  notes: string;
  isInactive: boolean;
  matched: boolean;
};

export type RequestedRawColumn = {
  key: string;
  label?: string;
};

/**
 * Resolves the requested active worksheet columns against the canonical allowlist.
 * Preserves the exact column order and headings passed from the active editor.
 * Falls back to all canonical columns if none are provided or valid.
 */
export function resolveRawWorksheetColumns(
  requested?: readonly RequestedRawColumn[] | null,
): RawWorksheetColumnSpec[] {
  if (!Array.isArray(requested) || requested.length === 0) {
    return [...CANONICAL_RAW_WORKSHEET_COLUMNS];
  }
  const seen = new Set<string>();
  const resolved: RawWorksheetColumnSpec[] = [];
  for (const item of requested) {
    if (!item || typeof item.key !== "string") continue;
    const base = COL_MAP.get(item.key);
    if (!base || seen.has(base.key)) continue;
    seen.add(base.key);
    const customLabel = typeof item.label === "string" ? item.label.trim().slice(0, 80) : "";
    resolved.push({
      ...base,
      label: customLabel || base.label,
    });
  }
  return resolved.length > 0 ? resolved : [...CANONICAL_RAW_WORKSHEET_COLUMNS];
}

/** Converts a 0-based column index into an Excel column letter (0 -> A, 25 -> Z, 26 -> AA). */
export function excelColLetter(index: number): string {
  let n = index;
  let out = "";
  while (n >= 0) {
    out = String.fromCharCode((n % 26) + 65) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

function escXml(v: string | number | null | undefined): string {
  return String(v ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeSheetTabName(name: string | undefined): string {
  const cleaned = String(name ?? "")
    .replace(/[\\/?*[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned || "Raw Worksheet";
  return base.slice(0, 31);
}

/* Style indexes into STYLES_XML (all unlocked / editable in Excel) */
const S = {
  header: 1,
  text: 2,
  textAlt: 3,
  skuText: 4,
  skuTextAlt: 5,
  price: 6,
  priceAlt: 7,
  percent: 8,
  percentAlt: 9,
  divisor: 10,
  divisorAlt: 11,
} as const;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3">
  <numFmt numFmtId="164" formatCode="0.00"/>
  <numFmt numFmtId="165" formatCode="0.00##"/>
  <numFmt numFmtId="166" formatCode="0.00"/>
</numFmts>
<fonts count="2">
  <font><sz val="11"/><name val="Calibri"/><family val="2"/><color rgb="FF0F172A"/></font>
  <font><b/><sz val="11"/><name val="Calibri"/><family val="2"/><color rgb="FF0F172A"/></font>
</fonts>
<fills count="4">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
  <border><left/><right/><top/><bottom/><diagonal/></border>
  <border>
    <left style="thin"><color rgb="FFCBD5E1"/></left>
    <right style="thin"><color rgb="FFCBD5E1"/></right>
    <top style="thin"><color rgb="FFCBD5E1"/></top>
    <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
    <diagonal/>
  </border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
  <!-- 0: Default -->
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <!-- 1: Header -->
  <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
    <alignment horizontal="left" vertical="center" wrapText="1"/>
  </xf>
  <!-- 2: Text -->
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
    <alignment horizontal="left" vertical="center" wrapText="1"/>
  </xf>
  <!-- 3: Text alt -->
  <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
    <alignment horizontal="left" vertical="center" wrapText="1"/>
  </xf>
  <!-- 4: SKU / Code text (@ preserves leading zeros) -->
  <xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1">
    <alignment horizontal="left" vertical="center"/>
  </xf>
  <!-- 5: SKU / Code text alt -->
  <xf numFmtId="49" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
    <alignment horizontal="left" vertical="center"/>
  </xf>
  <!-- 6: Price (0.00) -->
  <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1">
    <alignment horizontal="right" vertical="center"/>
  </xf>
  <!-- 7: Price alt -->
  <xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
    <alignment horizontal="right" vertical="center"/>
  </xf>
  <!-- 8: Percent number (0.00) -->
  <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1">
    <alignment horizontal="right" vertical="center"/>
  </xf>
  <!-- 9: Percent alt -->
  <xf numFmtId="166" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
    <alignment horizontal="right" vertical="center"/>
  </xf>
  <!-- 10: Divisor (0.00##) -->
  <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1">
    <alignment horizontal="right" vertical="center"/>
  </xf>
  <!-- 11: Divisor alt -->
  <xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
    <alignment horizontal="right" vertical="center"/>
  </xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function strCell(ref: string, val: string, style: number): string {
  if (val === "") return `<c r="${ref}" s="${style}"/>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escXml(val)}</t></is></c>`;
}

function numCell(ref: string, raw: string | null | undefined, style: number): string {
  const s = String(raw ?? "").trim();
  if (!s) return `<c r="${ref}" s="${style}"/>`;
  const cleaned = s.replace(/[$,%\s]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    return strCell(ref, s, style);
  }
  return `<c r="${ref}" s="${style}"><v>${n}</v></c>`;
}

export function getRawWorksheetCellValue(row: RawWorksheetRowInput, key: RawWorksheetColKey): string {
  if (key === "flags") {
    return getItemFlags(row).join(", ");
  }
  const v = (row as Record<string, unknown>)[key];
  if (v === null || v === undefined) return "";
  return String(v);
}

const SKU_LIKE_KEYS = new Set<RawWorksheetColKey>(["rawVendorSku", "cleanedSku", "productNumber"]);

function computeColumnWidths(
  columns: readonly RawWorksheetColumnSpec[],
  rows: readonly RawWorksheetRowInput[],
): number[] {
  const sample = rows.slice(0, 500);
  return columns.map((col) => {
    let maxLen = Math.max(col.label.length + 3, col.width);
    for (const r of sample) {
      const val = getRawWorksheetCellValue(r, col.key);
      // Use longest single line for wrapped columns like Notes
      const lineMax = val.split(/\r?\n/).reduce((m, line) => Math.max(m, line.length), 0);
      if (lineMax + 3 > maxLen) maxLen = lineMax + 3;
    }
    const maxCap = col.key === "productName" || col.key === "notes" ? 54 : 34;
    return Math.min(maxCap, Math.max(12, maxLen));
  });
}

function buildWorksheetXml(
  rows: readonly RawWorksheetRowInput[],
  columns: readonly RawWorksheetColumnSpec[],
): string {
  const colLetters = columns.map((_, i) => excelColLetter(i));
  const lastCol = colLetters[colLetters.length - 1] ?? "A";
  const lastRow = Math.max(1, rows.length + 1);
  const widths = computeColumnWidths(columns, rows);

  const rowsXml: string[] = [];

  // Row 1: Column Headings
  const headerCells = columns
    .map((col, i) => strCell(`${colLetters[i]}1`, col.label, S.header))
    .join("");
  rowsXml.push(`<row r="1" ht="24" customHeight="1">${headerCells}</row>`);

  // Rows 2..N: Worksheet data rows
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const rowNum = idx + 2;
    const alt = idx % 2 === 1;
    const cells = columns
      .map((col, cIdx) => {
        const ref = `${colLetters[cIdx]}${rowNum}`;
        if (col.kind === "price") {
          return numCell(ref, getRawWorksheetCellValue(r, col.key), alt ? S.priceAlt : S.price);
        }
        if (col.kind === "percent") {
          return numCell(ref, getRawWorksheetCellValue(r, col.key), alt ? S.percentAlt : S.percent);
        }
        if (col.kind === "divisor") {
          return numCell(ref, getRawWorksheetCellValue(r, col.key), alt ? S.divisorAlt : S.divisor);
        }
        const textVal = getRawWorksheetCellValue(r, col.key);
        if (SKU_LIKE_KEYS.has(col.key)) {
          return strCell(ref, textVal, alt ? S.skuTextAlt : S.skuText);
        }
        return strCell(ref, textVal, alt ? S.textAlt : S.text);
      })
      .join("");
    rowsXml.push(`<row r="${rowNum}" ht="20">${cells}</row>`);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr filterMode="0"><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${lastCol}${lastRow}"/>
<sheetViews>
  <sheetView workbookViewId="0">
    <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    <selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
  </sheetView>
</sheetViews>
<sheetFormatPr defaultRowHeight="20"/>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${rowsXml.join("")}</sheetData>
<autoFilter ref="A1:${lastCol}${lastRow}"/>
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

export type BuildRawWorksheetOptions = {
  sheetName?: string;
  columns?: readonly RequestedRawColumn[] | null;
};

/**
 * Builds an editable OOXML (.xlsx) Buffer containing the raw price update worksheet.
 */
export function buildRawWorksheetWorkbook(
  rows: readonly RawWorksheetRowInput[],
  opts: BuildRawWorksheetOptions = {},
): Buffer {
  const columns = resolveRawWorksheetColumns(opts.columns);
  const tabName = sanitizeSheetTabName(opts.sheetName);
  const lastCol = excelColLetter(columns.length - 1);
  const lastRow = Math.max(1, rows.length + 1);
  const quotedTab = `'${tabName.replace(/'/g, "''")}'`;

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
<sheets><sheet name="${escXml(tabName)}" sheetId="1" r:id="rId1"/></sheets>
<definedNames>
  <definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${quotedTab}!$A$1:$${lastCol}$${lastRow}</definedName>
  <definedName name="_xlnm.Print_Titles" localSheetId="0">${quotedTab}!$1:$1</definedName>
</definedNames>
</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    "xl/styles.xml": STYLES_XML,
    "xl/worksheets/sheet1.xml": buildWorksheetXml(rows, columns),
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
    /* placeholder not present */
  }
  for (const [name, xml] of Object.entries(files)) {
    CFB.utils.cfb_add(zip, name, Buffer.from(xml, "utf8"));
  }
  const out = CFB.write(zip, { fileType: "zip", type: "buffer", compression: true });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}
