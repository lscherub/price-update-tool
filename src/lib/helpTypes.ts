/**
 * Shared types and pure document utilities for the Help Centre / Knowledge Base.
 */

export type HelpArticleStatus = "DRAFT" | "PUBLISHED";

export type HelpCalloutVariant = "note" | "tip" | "warning";

export type HelpDocBlock =
  | {
      id: string;
      type: "heading";
      level: 2 | 3;
      text: string;
    }
  | {
      id: string;
      type: "paragraph";
      /** Plain text with optional lightweight inline formatting (**bold**, *italic*, [label](href)). */
      text: string;
    }
  | {
      id: string;
      type: "steps";
      items: string[];
    }
  | {
      id: string;
      type: "bullets";
      items: string[];
    }
  | {
      id: string;
      type: "callout";
      variant: HelpCalloutVariant;
      title: string;
      text: string;
    }
  | {
      id: string;
      type: "table";
      headers: string[];
      rows: string[][];
    }
  | {
      id: string;
      type: "image";
      imageId: string;
      url: string;
      alt: string;
      caption: string;
    };

export type HelpTocItem = {
  id: string;
  anchor: string;
  level: 2 | 3;
  text: string;
};

export type HelpCategoryDTO = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
};

export type HelpArticleSummaryDTO = {
  id: string;
  categoryId: string;
  slug: string;
  status: HelpArticleStatus;
  title: string;
  summary: string;
  hasUnpublishedChanges: boolean;
  needsReview: boolean;
  sortOrder: number;
  relatedSlugs: string[];
  contextKeys: string[];
  updatedByEmail: string;
  publishedAt: string | null;
  updatedAt: string;
};

export type HelpArticleDetailDTO = HelpArticleSummaryDTO & {
  blocks: HelpDocBlock[];
  /** Admin-only fields (omitted for staff readers) */
  draftTitle?: string;
  draftSummary?: string;
  draftBlocks?: HelpDocBlock[];
  publishedTitle?: string | null;
  publishedSummary?: string | null;
  publishedBlocks?: HelpDocBlock[] | null;
  authorEmail?: string;
};

export type HelpRevisionDTO = {
  id: string;
  articleId: string;
  version: number;
  title: string;
  summary: string;
  blocks: HelpDocBlock[];
  eventType: string;
  editorEmail: string;
  note: string;
  createdAt: string;
};

export type HelpSearchResultDTO = {
  slug: string;
  title: string;
  summary: string;
  categoryId: string;
  categoryName: string;
  status: HelpArticleStatus;
  snippet: string;
  updatedAt: string;
};

export function slugifyHelpText(input: string): string {
  const s = String(input ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || "article";
}

export function headingAnchor(text: string, fallbackId: string): string {
  const base = slugifyHelpText(text);
  return base && base !== "article" ? base : `section-${fallbackId}`;
}

export function extractToc(blocks: readonly HelpDocBlock[]): HelpTocItem[] {
  const seen = new Map<string, number>();
  const items: HelpTocItem[] = [];
  for (const b of blocks) {
    if (b.type !== "heading") continue;
    const text = b.text.trim();
    if (!text) continue;
    const base = headingAnchor(text, b.id);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const anchor = count === 0 ? base : `${base}-${count + 1}`;
    items.push({ id: b.id, anchor, level: b.level, text });
  }
  return items;
}

export function parseBlocksJson(raw: string | null | undefined): HelpDocBlock[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sanitizeBlocks(parsed);
  } catch {
    return [];
  }
}

export function sanitizeBlocks(raw: unknown): HelpDocBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: HelpDocBlock[] = [];
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    if (!b || typeof b !== "object") continue;
    const obj = b as Record<string, unknown>;
    const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim().slice(0, 64) : `blk_${i + 1}`;
    const type = String(obj.type ?? "");
    if (type === "heading") {
      const level: 2 | 3 = obj.level === 3 ? 3 : 2;
      out.push({ id, type: "heading", level, text: String(obj.text ?? "").slice(0, 300) });
    } else if (type === "paragraph") {
      out.push({ id, type: "paragraph", text: String(obj.text ?? "").slice(0, 8000) });
    } else if (type === "steps" || type === "bullets") {
      const items = Array.isArray(obj.items)
        ? obj.items.map((x) => String(x ?? "").slice(0, 2000))
        : [""];
      out.push({ id, type, items: items.length ? items : [""] });
    } else if (type === "callout") {
      const v = String(obj.variant ?? "note");
      const variant: HelpCalloutVariant = v === "tip" || v === "warning" ? v : "note";
      out.push({
        id,
        type: "callout",
        variant,
        title: String(obj.title ?? "").slice(0, 200),
        text: String(obj.text ?? "").slice(0, 4000),
      });
    } else if (type === "table") {
      const headers = Array.isArray(obj.headers)
        ? obj.headers.map((h) => String(h ?? "").slice(0, 200))
        : ["Column 1", "Column 2"];
      const safeHeaders = headers.length ? headers : ["Column 1", "Column 2"];
      const rows = Array.isArray(obj.rows)
        ? obj.rows.map((r) => {
            const arr = Array.isArray(r) ? r.map((c) => String(c ?? "").slice(0, 1000)) : [];
            while (arr.length < safeHeaders.length) arr.push("");
            return arr.slice(0, safeHeaders.length);
          })
        : [];
      out.push({ id, type: "table", headers: safeHeaders, rows });
    } else if (type === "image") {
      const url = String(obj.url ?? "").trim();
      // Only allow safe internal image URLs or https URLs (never data: blobs or javascript:)
      const safeUrl =
        url.startsWith("/api/help/images/") || url.startsWith("https://") || url.startsWith("http://")
          ? url
          : "";
      out.push({
        id,
        type: "image",
        imageId: String(obj.imageId ?? "").slice(0, 100),
        url: safeUrl,
        alt: String(obj.alt ?? "").slice(0, 300),
        caption: String(obj.caption ?? "").slice(0, 500),
      });
    }
  }
  return out;
}

export function extractPlainTextFromBlocks(blocks: readonly HelpDocBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
      case "paragraph":
        parts.push(b.text);
        break;
      case "steps":
      case "bullets":
        parts.push(b.items.join(" "));
        break;
      case "callout":
        parts.push(`${b.title} ${b.text}`);
        break;
      case "table":
        parts.push(b.headers.join(" "));
        for (const r of b.rows) parts.push(r.join(" "));
        break;
      case "image":
        if (b.caption) parts.push(b.caption);
        if (b.alt) parts.push(b.alt);
        break;
    }
  }
  return parts
    .join(" ")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseStringArrayJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((v) => String(v ?? "").trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

export function newBlockId(): string {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
