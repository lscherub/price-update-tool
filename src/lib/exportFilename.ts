/**
 * Standardized filename generation for price sheet exports.
 *
 * Format:
 *   [Price Sheet Name] - [Export Type] - [YYYY-MM-DD].[extension]
 *
 * Example:
 *   Flora November 2026 - Store Count - 2026-11-03.xlsx
 */

/**
 * Coerces and sanitizes a price sheet name for safe use in filenames:
 * - Replaces directory separators (/, \) and colons with " - "
 * - Strips filesystem-invalid characters (* ? " < > | and control chars)
 * - Collapses consecutive whitespace and dashes
 * - Trims leading and trailing spaces, dots, and hyphens
 * - Falls back to "Price Update" if the name is missing or becomes empty
 */
export function sanitizeSheetName(name: string | null | undefined): string {
  if (name === null || name === undefined) return "Price Update";

  let s = String(name);

  // Replace directory separators and colons with " - "
  s = s.replace(/[/\\:]+/g, " - ");

  // Remove filesystem-invalid characters (* ? " < > | and control chars)
  s = s.replace(/[*?"<>|\x00-\x1f\x7f]/g, "");

  // Normalize all whitespace to single space
  s = s.replace(/\s+/g, " ");

  // Collapse consecutive dash groups like " - - " or " -   - " -> " - "
  s = s.replace(/\s*-\s*(?:-\s*)+/g, " - ");

  // Strip leading and trailing whitespace, dots, and hyphens
  s = s.replace(/^[\s.-]+|[\s.-]+$/g, "");

  return s || "Price Update";
}

/** Formats a Date object to YYYY-MM-DD. */
export function formatExportDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Builds the complete export filename.
 *
 * @param sheetName Current price sheet name / title
 * @param exportType "Store Count" | "Digital Store Count" | "POS Export"
 * @param extension File extension without dot, e.g. "xlsx" | "pdf" | "csv"
 * @param date Optional date (defaults to current date)
 */
export function buildExportFilename(
  sheetName: string | null | undefined,
  exportType: "Store Count" | "Digital Store Count" | "POS Export" | string,
  extension: "xlsx" | "pdf" | "csv" | string,
  date: Date = new Date(),
): string {
  const safeName = sanitizeSheetName(sheetName);
  const safeType = String(exportType ?? "").trim() || "Export";
  const dateStr = formatExportDate(date);
  const ext = String(extension ?? "").replace(/^\./, "").trim() || "dat";
  return `${safeName} - ${safeType} - ${dateStr}.${ext}`;
}

/**
 * Builds an RFC 6266 / RFC 5987 compliant Content-Disposition header.
 *
 * Provides an ASCII-quoted fallback for older tools alongside
 * `filename*=UTF-8''...` for modern clients.
 */
export function buildContentDisposition(filename: string): string {
  const ascii = filename.replace(/["\r\n\\]/g, "").replace(/[^\x20-\x7E]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, "%2A");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Parses the filename out of a Content-Disposition header if present.
 */
export function getFilenameFromContentDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      // ignore decode failure and try standard filename
    }
  }
  const quotedMatch = header.match(/filename="([^"]+)"/i);
  if (quotedMatch && quotedMatch[1]) {
    return quotedMatch[1].trim();
  }
  const bareMatch = header.match(/filename=([^;]+)/i);
  if (bareMatch && bareMatch[1]) {
    return bareMatch[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

