import type { PrismaClient } from "@prisma/client";
import { INITIAL_HELP_ARTICLES, INITIAL_HELP_CATEGORIES } from "@/lib/helpSeedContent";
import {
  extractPlainTextFromBlocks,
  parseBlocksJson,
  parseStringArrayJson,
  sanitizeBlocks,
  slugifyHelpText,
  type HelpArticleDetailDTO,
  type HelpArticleStatus,
  type HelpArticleSummaryDTO,
  type HelpCategoryDTO,
  type HelpDocBlock,
  type HelpRevisionDTO,
  type HelpSearchResultDTO,
} from "@/lib/helpTypes";
import {
  cuid,
  loadFileStore,
  saveFileStore,
  type HelpArticleRevisionRow,
  type HelpArticleRow,
  type HelpCategoryRow,
} from "@/lib/store";

type RawCategory = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
};

type RawArticle = {
  id: string;
  categoryId: string;
  slug: string;
  status: string;
  draftTitle: string;
  draftSummary: string;
  draftContentJson: string;
  publishedTitle: string | null;
  publishedSummary: string | null;
  publishedContentJson: string | null;
  hasUnpublishedChanges: boolean;
  relatedSlugsJson: string;
  contextKeysJson: string;
  needsReview: boolean;
  sortOrder: number;
  authorEmail: string;
  updatedByEmail: string;
  publishedAt: Date | string | null;
  updatedAt: Date | string;
};

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.toISOString();
}

function toCategoryDto(c: RawCategory): HelpCategoryDTO {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    icon: c.icon,
    sortOrder: c.sortOrder,
  };
}

function isVisibleToStaff(a: RawArticle): boolean {
  return a.status === "PUBLISHED" && Boolean(a.publishedContentJson);
}

function toSummaryDto(a: RawArticle, isAdmin: boolean): HelpArticleSummaryDTO {
  const usePublished = !isAdmin || (a.status === "PUBLISHED" && !a.hasUnpublishedChanges);
  const title = usePublished && a.publishedTitle ? a.publishedTitle : a.draftTitle;
  const summary = usePublished && a.publishedSummary !== null ? a.publishedSummary : a.draftSummary;
  return {
    id: a.id,
    categoryId: a.categoryId,
    slug: a.slug,
    status: a.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
    title,
    summary,
    hasUnpublishedChanges: isAdmin ? a.hasUnpublishedChanges : false,
    needsReview: isAdmin ? a.needsReview : false,
    sortOrder: a.sortOrder,
    relatedSlugs: parseStringArrayJson(a.relatedSlugsJson),
    contextKeys: parseStringArrayJson(a.contextKeysJson),
    updatedByEmail: a.updatedByEmail,
    publishedAt: iso(a.publishedAt),
    updatedAt: iso(a.updatedAt) ?? new Date().toISOString(),
  };
}

function toDetailDto(a: RawArticle, isAdmin: boolean): HelpArticleDetailDTO {
  const base = toSummaryDto(a, isAdmin);
  const pubBlocks = a.publishedContentJson ? parseBlocksJson(a.publishedContentJson) : null;
  const draftBlocks = parseBlocksJson(a.draftContentJson);

  if (!isAdmin) {
    // Staff strictly receives ONLY the published snapshot.
    return {
      ...base,
      title: a.publishedTitle ?? a.draftTitle,
      summary: a.publishedSummary ?? "",
      blocks: pubBlocks ?? [],
    };
  }

  return {
    ...base,
    // Primary reader view shows published content when published, or draft when still in draft.
    blocks: a.status === "PUBLISHED" && pubBlocks ? pubBlocks : draftBlocks,
    draftTitle: a.draftTitle,
    draftSummary: a.draftSummary,
    draftBlocks,
    publishedTitle: a.publishedTitle,
    publishedSummary: a.publishedSummary,
    publishedBlocks: pubBlocks,
    authorEmail: a.authorEmail,
  };
}

/**
 * Idempotently seeds the initial AI-generated staff documentation drafts.
 * - Never overwrites existing categories or articles.
 * - Every seeded article starts as DRAFT (`status: "DRAFT"`, `needsReview: true`)
 *   so nothing is auto-published without administrator review.
 */
export async function seedInitialHelpDrafts(
  prisma: PrismaClient | null,
  actorEmail = "system",
): Promise<{ categoriesCreated: number; articlesCreated: number }> {
  let categoriesCreated = 0;
  let articlesCreated = 0;
  const nowIso = new Date().toISOString();

  if (!prisma) {
    const store = loadFileStore();
    const cats = [...(store.helpCategories ?? [])];
    const arts = [...(store.helpArticles ?? [])];
    const revs = [...(store.helpRevisions ?? [])];

    const catBySlug = new Map(cats.map((c) => [c.slug, c]));
    for (const sc of INITIAL_HELP_CATEGORIES) {
      if (!catBySlug.has(sc.slug)) {
        const row: HelpCategoryRow = {
          id: cuid(),
          slug: sc.slug,
          name: sc.name,
          description: sc.description,
          icon: sc.icon,
          sortOrder: sc.sortOrder,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        cats.push(row);
        catBySlug.set(sc.slug, row);
        categoriesCreated++;
      }
    }

    const artSlugs = new Set(arts.map((a) => a.slug));
    for (const sa of INITIAL_HELP_ARTICLES) {
      if (artSlugs.has(sa.slug)) continue;
      const cat = catBySlug.get(sa.categorySlug);
      if (!cat) continue;
      const contentJson = JSON.stringify(sa.blocks);
      const artId = cuid();
      const row: HelpArticleRow = {
        id: artId,
        categoryId: cat.id,
        slug: sa.slug,
        status: "DRAFT",
        draftTitle: sa.title,
        draftSummary: sa.summary,
        draftContentJson: contentJson,
        publishedTitle: null,
        publishedSummary: null,
        publishedContentJson: null,
        hasUnpublishedChanges: false,
        relatedSlugsJson: JSON.stringify(sa.relatedSlugs),
        contextKeysJson: JSON.stringify(sa.contextKeys),
        needsReview: sa.needsReview,
        sortOrder: sa.sortOrder,
        authorEmail: actorEmail,
        updatedByEmail: actorEmail,
        publishedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      arts.push(row);
      revs.push({
        id: cuid(),
        articleId: artId,
        version: 1,
        title: sa.title,
        summary: sa.summary,
        contentJson,
        eventType: "DRAFT_SAVED",
        editorEmail: actorEmail,
        note: "Initial AI-generated draft awaiting administrator review",
        createdAt: nowIso,
      });
      artSlugs.add(sa.slug);
      articlesCreated++;
    }

    if (categoriesCreated > 0 || articlesCreated > 0) {
      store.helpCategories = cats;
      store.helpArticles = arts;
      store.helpRevisions = revs;
      saveFileStore(store);
    }
    return { categoriesCreated, articlesCreated };
  }

  const existingCats = await prisma.helpCategory.findMany();
  const catBySlug = new Map(existingCats.map((c) => [c.slug, c]));
  for (const sc of INITIAL_HELP_CATEGORIES) {
    if (!catBySlug.has(sc.slug)) {
      const created = await prisma.helpCategory.create({
        data: {
          slug: sc.slug,
          name: sc.name,
          description: sc.description,
          icon: sc.icon,
          sortOrder: sc.sortOrder,
        },
      });
      catBySlug.set(created.slug, created);
      categoriesCreated++;
    }
  }

  const existingArts = await prisma.helpArticle.findMany({ select: { slug: true } });
  const existingSlugs = new Set(existingArts.map((a) => a.slug));
  for (const sa of INITIAL_HELP_ARTICLES) {
    if (existingSlugs.has(sa.slug)) continue;
    const cat = catBySlug.get(sa.categorySlug);
    if (!cat) continue;
    const contentJson = JSON.stringify(sa.blocks);
    const created = await prisma.helpArticle.create({
      data: {
        categoryId: cat.id,
        slug: sa.slug,
        status: "DRAFT",
        draftTitle: sa.title,
        draftSummary: sa.summary,
        draftContentJson: contentJson,
        publishedTitle: null,
        publishedSummary: null,
        publishedContentJson: null,
        hasUnpublishedChanges: false,
        relatedSlugsJson: JSON.stringify(sa.relatedSlugs),
        contextKeysJson: JSON.stringify(sa.contextKeys),
        needsReview: sa.needsReview,
        sortOrder: sa.sortOrder,
        authorEmail: actorEmail,
        updatedByEmail: actorEmail,
        publishedAt: null,
      },
    });
    await prisma.helpArticleRevision.create({
      data: {
        articleId: created.id,
        version: 1,
        title: sa.title,
        summary: sa.summary,
        contentJson,
        eventType: "DRAFT_SAVED",
        editorEmail: actorEmail,
        note: "Initial AI-generated draft awaiting administrator review",
      },
    });
    existingSlugs.add(sa.slug);
    articlesCreated++;
  }

  return { categoriesCreated, articlesCreated };
}

/**
 * Ensures initial draft documentation exists the very first time the Help Centre is opened
 * (when the database has 0 categories and 0 articles).
 */
export async function ensureHelpInitialized(prisma: PrismaClient | null, actorEmail = "system"): Promise<void> {
  if (!prisma) {
    const store = loadFileStore();
    if ((store.helpCategories?.length ?? 0) === 0 && (store.helpArticles?.length ?? 0) === 0) {
      await seedInitialHelpDrafts(null, actorEmail);
    }
    return;
  }
  const [catCount, artCount] = await Promise.all([
    prisma.helpCategory.count(),
    prisma.helpArticle.count(),
  ]);
  if (catCount === 0 && artCount === 0) {
    await seedInitialHelpDrafts(prisma, actorEmail);
  }
}

export async function listHelpLibrary(
  prisma: PrismaClient | null,
  isAdmin: boolean,
): Promise<{ categories: HelpCategoryDTO[]; articles: HelpArticleSummaryDTO[] }> {
  let categories: RawCategory[];
  let articles: RawArticle[];

  if (!prisma) {
    const store = loadFileStore();
    categories = [...(store.helpCategories ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    articles = [...(store.helpArticles ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.draftTitle.localeCompare(b.draftTitle));
  } else {
    [categories, articles] = await Promise.all([
      prisma.helpCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      prisma.helpArticle.findMany({ orderBy: [{ sortOrder: "asc" }, { draftTitle: "asc" }] }),
    ]);
  }

  const visibleArticles = isAdmin ? articles : articles.filter(isVisibleToStaff);
  const articleDtos = visibleArticles.map((a) => toSummaryDto(a, isAdmin));

  // For staff readers, only show categories that contain at least one published article.
  const visibleCatIds = new Set(articleDtos.map((a) => a.categoryId));
  const visibleCategories = isAdmin
    ? categories
    : categories.filter((c) => visibleCatIds.has(c.id));

  return {
    categories: visibleCategories.map(toCategoryDto),
    articles: articleDtos,
  };
}

export async function getHelpArticleBySlug(
  prisma: PrismaClient | null,
  slug: string,
  isAdmin: boolean,
): Promise<{
  article: HelpArticleDetailDTO;
  category: HelpCategoryDTO | null;
  related: HelpArticleSummaryDTO[];
  revisions?: HelpRevisionDTO[];
} | null> {
  const cleanSlug = slug.trim();
  if (!cleanSlug) return null;

  let found: RawArticle | null = null;
  let allCats: RawCategory[] = [];
  let allArticles: RawArticle[] = [];
  let revisions: HelpRevisionDTO[] | undefined;

  if (!prisma) {
    const store = loadFileStore();
    allCats = store.helpCategories ?? [];
    allArticles = store.helpArticles ?? [];
    found = allArticles.find((a) => a.slug === cleanSlug || a.id === cleanSlug) ?? null;
    if (!found) return null;
    if (!isAdmin && !isVisibleToStaff(found)) return null;
    if (isAdmin) {
      revisions = (store.helpRevisions ?? [])
        .filter((r) => r.articleId === found!.id)
        .sort((a, b) => b.version - a.version)
        .slice(0, 30)
        .map((r) => ({
          id: r.id,
          articleId: r.articleId,
          version: r.version,
          title: r.title,
          summary: r.summary,
          blocks: parseBlocksJson(r.contentJson),
          eventType: r.eventType,
          editorEmail: r.editorEmail,
          note: r.note,
          createdAt: r.createdAt,
        }));
    }
  } else {
    found = await prisma.helpArticle.findFirst({
      where: { OR: [{ slug: cleanSlug }, { id: cleanSlug }] },
    });
    if (!found) return null;
    if (!isAdmin && !isVisibleToStaff(found)) return null;

    const relatedSlugs = parseStringArrayJson(found.relatedSlugsJson);
    const [cat, relRows, revRows] = await Promise.all([
      prisma.helpCategory.findUnique({ where: { id: found.categoryId } }),
      relatedSlugs.length
        ? prisma.helpArticle.findMany({ where: { slug: { in: relatedSlugs } } })
        : Promise.resolve([]),
      isAdmin
        ? prisma.helpArticleRevision.findMany({
            where: { articleId: found.id },
            orderBy: { version: "desc" },
            take: 30,
          })
        : Promise.resolve([]),
    ]);
    if (cat) allCats = [cat];
    allArticles = relRows;
    if (isAdmin) {
      revisions = revRows.map((r) => ({
        id: r.id,
        articleId: r.articleId,
        version: r.version,
        title: r.title,
        summary: r.summary,
        blocks: parseBlocksJson(r.contentJson),
        eventType: r.eventType,
        editorEmail: r.editorEmail,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      }));
    }
  }

  const cat = allCats.find((c) => c.id === found!.categoryId) ?? null;
  const relSlugs = parseStringArrayJson(found.relatedSlugsJson);
  const related = relSlugs
    .map((rs) => allArticles.find((a) => a.slug === rs && a.id !== found!.id))
    .filter((a): a is RawArticle => Boolean(a && (isAdmin || isVisibleToStaff(a))))
    .map((a) => toSummaryDto(a, isAdmin));

  return {
    article: toDetailDto(found, isAdmin),
    category: cat ? toCategoryDto(cat) : null,
    related,
    ...(isAdmin ? { revisions } : {}),
  };
}

export async function searchHelpArticles(
  prisma: PrismaClient | null,
  query: string,
  isAdmin: boolean,
): Promise<HelpSearchResultDTO[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  let categories: RawCategory[];
  let articles: RawArticle[];
  if (!prisma) {
    const store = loadFileStore();
    categories = store.helpCategories ?? [];
    articles = store.helpArticles ?? [];
  } else {
    [categories, articles] = await Promise.all([
      prisma.helpCategory.findMany(),
      prisma.helpArticle.findMany(),
    ]);
  }

  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const terms = needle.split(/\s+/).filter(Boolean);
  const scored: { score: number; result: HelpSearchResultDTO }[] = [];

  for (const a of articles) {
    if (!isAdmin && !isVisibleToStaff(a)) continue;

    // Staff ONLY searches published text; admins search current draft text.
    const title = !isAdmin ? (a.publishedTitle ?? "") : a.draftTitle;
    const summary = !isAdmin ? (a.publishedSummary ?? "") : a.draftSummary;
    const rawJson = !isAdmin ? a.publishedContentJson : a.draftContentJson;
    const bodyText = extractPlainTextFromBlocks(parseBlocksJson(rawJson));
    const catName = catMap.get(a.categoryId) ?? "";

    const titleLow = title.toLowerCase();
    const sumLow = summary.toLowerCase();
    const bodyLow = bodyText.toLowerCase();
    const catLow = catName.toLowerCase();

    if (!terms.every((t) => titleLow.includes(t) || sumLow.includes(t) || bodyLow.includes(t) || catLow.includes(t))) {
      continue;
    }

    let score = 0;
    if (titleLow.includes(needle)) score += 30;
    if (sumLow.includes(needle)) score += 15;
    if (bodyLow.includes(needle)) score += 10;
    for (const t of terms) {
      if (titleLow.includes(t)) score += 8;
      if (sumLow.includes(t)) score += 4;
      if (bodyLow.includes(t)) score += 2;
    }

    // Build a helpful snippet around the first matching term
    let snippet = summary;
    const idx = bodyLow.indexOf(terms[0]);
    if (idx >= 0) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(bodyText.length, idx + 140);
      snippet = `${start > 0 ? "…" : ""}${bodyText.slice(start, end).trim()}${end < bodyText.length ? "…" : ""}`;
    }

    scored.push({
      score,
      result: {
        slug: a.slug,
        title,
        summary,
        categoryId: a.categoryId,
        categoryName: catName,
        status: a.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
        snippet,
        updatedAt: iso(a.updatedAt) ?? new Date().toISOString(),
      },
    });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.result.title.localeCompare(b.result.title))
    .slice(0, 30)
    .map((s) => s.result);
}

export async function getContextualHelpArticles(
  prisma: PrismaClient | null,
  contextKey: string,
  isAdmin: boolean,
): Promise<HelpArticleDetailDTO[]> {
  const key = contextKey.trim().toLowerCase();
  if (!key) return [];

  let articles: RawArticle[];
  if (!prisma) {
    const store = loadFileStore();
    articles = [...(store.helpArticles ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  } else {
    articles = await prisma.helpArticle.findMany({ orderBy: [{ sortOrder: "asc" }] });
  }

  return articles
    .filter((a) => {
      const keys = parseStringArrayJson(a.contextKeysJson).map((k) => k.toLowerCase());
      if (!keys.includes(key)) return false;
      return isAdmin || isVisibleToStaff(a);
    })
    .slice(0, 8)
    .map((a) => toDetailDto(a, isAdmin));
}

/* ----------------------------- Category Mutations ----------------------------- */

export async function createHelpCategory(
  prisma: PrismaClient | null,
  input: { name: string; description?: string; icon?: string },
): Promise<{ ok: true; category: HelpCategoryDTO } | { ok: false; error: string }> {
  const name = String(input.name ?? "").trim().slice(0, 120);
  if (!name) return { ok: false, error: "Category name is required." };
  const description = String(input.description ?? "").trim().slice(0, 400);
  const icon = String(input.icon ?? "book").trim().slice(0, 40) || "book";
  const baseSlug = slugifyHelpText(name);

  if (!prisma) {
    const store = loadFileStore();
    const cats = [...(store.helpCategories ?? [])];
    let slug = baseSlug;
    let n = 2;
    while (cats.some((c) => c.slug === slug)) slug = `${baseSlug}-${n++}`;
    const maxOrder = cats.reduce((m, c) => Math.max(m, c.sortOrder), 0);
    const now = new Date().toISOString();
    const row: HelpCategoryRow = {
      id: cuid(),
      slug,
      name,
      description,
      icon,
      sortOrder: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    };
    store.helpCategories = [...cats, row];
    saveFileStore(store);
    return { ok: true, category: toCategoryDto(row) };
  }

  const existing = await prisma.helpCategory.findMany({ select: { slug: true, sortOrder: true } });
  let slug = baseSlug;
  let n = 2;
  const slugs = new Set(existing.map((c) => c.slug));
  while (slugs.has(slug)) slug = `${baseSlug}-${n++}`;
  const maxOrder = existing.reduce((m, c) => Math.max(m, c.sortOrder), 0);

  const created = await prisma.helpCategory.create({
    data: { slug, name, description, icon, sortOrder: maxOrder + 1 },
  });
  return { ok: true, category: toCategoryDto(created) };
}

export async function updateHelpCategory(
  prisma: PrismaClient | null,
  id: string,
  input: { name?: string; description?: string; icon?: string; sortOrder?: number },
): Promise<{ ok: true; category: HelpCategoryDTO } | { ok: false; error: string }> {
  if (!prisma) {
    const store = loadFileStore();
    const cats = [...(store.helpCategories ?? [])];
    const target = cats.find((c) => c.id === id);
    if (!target) return { ok: false, error: "Category not found." };
    if (input.name !== undefined) {
      const n = String(input.name).trim().slice(0, 120);
      if (!n) return { ok: false, error: "Category name cannot be empty." };
      target.name = n;
    }
    if (input.description !== undefined) target.description = String(input.description).trim().slice(0, 400);
    if (input.icon !== undefined) target.icon = String(input.icon).trim().slice(0, 40) || "book";
    if (typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)) target.sortOrder = Math.round(input.sortOrder);
    target.updatedAt = new Date().toISOString();
    store.helpCategories = cats;
    saveFileStore(store);
    return { ok: true, category: toCategoryDto(target) };
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const n = String(input.name).trim().slice(0, 120);
    if (!n) return { ok: false, error: "Category name cannot be empty." };
    data.name = n;
  }
  if (input.description !== undefined) data.description = String(input.description).trim().slice(0, 400);
  if (input.icon !== undefined) data.icon = String(input.icon).trim().slice(0, 40) || "book";
  if (typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)) data.sortOrder = Math.round(input.sortOrder);

  try {
    const updated = await prisma.helpCategory.update({ where: { id }, data });
    return { ok: true, category: toCategoryDto(updated) };
  } catch {
    return { ok: false, error: "Category not found." };
  }
}

export async function reorderHelpCategories(prisma: PrismaClient | null, orderedIds: string[]): Promise<void> {
  if (!orderedIds.length) return;
  if (!prisma) {
    const store = loadFileStore();
    const cats = [...(store.helpCategories ?? [])];
    const pos = new Map(orderedIds.map((id, i) => [id, i + 1]));
    for (const c of cats) {
      if (pos.has(c.id)) {
        c.sortOrder = pos.get(c.id)!;
        c.updatedAt = new Date().toISOString();
      }
    }
    store.helpCategories = cats;
    saveFileStore(store);
    return;
  }
  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.helpCategory.updateMany({ where: { id }, data: { sortOrder: i + 1 } }),
    ),
  );
}

export async function deleteHelpCategory(
  prisma: PrismaClient | null,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!prisma) {
    const store = loadFileStore();
    const hasArticles = (store.helpArticles ?? []).some((a) => a.categoryId === id);
    if (hasArticles) {
      return { ok: false, error: "Move or delete all articles in this category before deleting it." };
    }
    store.helpCategories = (store.helpCategories ?? []).filter((c) => c.id !== id);
    saveFileStore(store);
    return { ok: true };
  }
  const count = await prisma.helpArticle.count({ where: { categoryId: id } });
  if (count > 0) {
    return { ok: false, error: "Move or delete all articles in this category before deleting it." };
  }
  await prisma.helpCategory.deleteMany({ where: { id } });
  return { ok: true };
}

/* ------------------------------ Article Mutations ----------------------------- */

export async function createHelpArticle(
  prisma: PrismaClient | null,
  input: {
    categoryId: string;
    title: string;
    summary?: string;
    blocks?: HelpDocBlock[];
    relatedSlugs?: string[];
    contextKeys?: string[];
    publish?: boolean;
    editorEmail: string;
  },
): Promise<{ ok: true; article: HelpArticleDetailDTO } | { ok: false; error: string }> {
  const title = String(input.title ?? "").trim().slice(0, 200);
  if (!title) return { ok: false, error: "Article title is required." };
  const summary = String(input.summary ?? "").trim().slice(0, 500);
  const blocks = sanitizeBlocks(input.blocks ?? [{ id: "b_1", type: "paragraph", text: "" }]);
  const contentJson = JSON.stringify(blocks);
  const relatedSlugsJson = JSON.stringify(
    [...new Set((input.relatedSlugs ?? []).map((s) => String(s).trim()).filter(Boolean))].slice(0, 12),
  );
  const contextKeysJson = JSON.stringify(
    [...new Set((input.contextKeys ?? []).map((s) => String(s).trim().toLowerCase()).filter(Boolean))].slice(0, 12),
  );
  const baseSlug = slugifyHelpText(title);
  const publish = Boolean(input.publish);
  const now = new Date();
  const nowIso = now.toISOString();

  if (!prisma) {
    const store = loadFileStore();
    const cats = store.helpCategories ?? [];
    if (!cats.some((c) => c.id === input.categoryId)) {
      return { ok: false, error: "Selected category was not found." };
    }
    const arts = [...(store.helpArticles ?? [])];
    let slug = baseSlug;
    let n = 2;
    while (arts.some((a) => a.slug === slug)) slug = `${baseSlug}-${n++}`;
    const maxOrder = arts
      .filter((a) => a.categoryId === input.categoryId)
      .reduce((m, a) => Math.max(m, a.sortOrder), 0);
    const id = cuid();
    const row: HelpArticleRow = {
      id,
      categoryId: input.categoryId,
      slug,
      status: publish ? "PUBLISHED" : "DRAFT",
      draftTitle: title,
      draftSummary: summary,
      draftContentJson: contentJson,
      publishedTitle: publish ? title : null,
      publishedSummary: publish ? summary : null,
      publishedContentJson: publish ? contentJson : null,
      hasUnpublishedChanges: false,
      relatedSlugsJson,
      contextKeysJson,
      needsReview: false,
      sortOrder: maxOrder + 1,
      authorEmail: input.editorEmail,
      updatedByEmail: input.editorEmail,
      publishedAt: publish ? nowIso : null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const rev: HelpArticleRevisionRow = {
      id: cuid(),
      articleId: id,
      version: 1,
      title,
      summary,
      contentJson,
      eventType: publish ? "PUBLISHED" : "DRAFT_SAVED",
      editorEmail: input.editorEmail,
      note: publish ? "Created and published" : "Initial draft created",
      createdAt: nowIso,
    };
    store.helpArticles = [...arts, row];
    store.helpRevisions = [...(store.helpRevisions ?? []), rev];
    saveFileStore(store);
    return { ok: true, article: toDetailDto(row, true) };
  }

  const cat = await prisma.helpCategory.findUnique({ where: { id: input.categoryId } });
  if (!cat) return { ok: false, error: "Selected category was not found." };

  const existing = await prisma.helpArticle.findMany({
    select: { slug: true, categoryId: true, sortOrder: true },
  });
  const slugSet = new Set(existing.map((a) => a.slug));
  let slug = baseSlug;
  let n = 2;
  while (slugSet.has(slug)) slug = `${baseSlug}-${n++}`;
  const maxOrder = existing
    .filter((a) => a.categoryId === input.categoryId)
    .reduce((m, a) => Math.max(m, a.sortOrder), 0);

  const created = await prisma.helpArticle.create({
    data: {
      categoryId: input.categoryId,
      slug,
      status: publish ? "PUBLISHED" : "DRAFT",
      draftTitle: title,
      draftSummary: summary,
      draftContentJson: contentJson,
      publishedTitle: publish ? title : null,
      publishedSummary: publish ? summary : null,
      publishedContentJson: publish ? contentJson : null,
      hasUnpublishedChanges: false,
      relatedSlugsJson,
      contextKeysJson,
      needsReview: false,
      sortOrder: maxOrder + 1,
      authorEmail: input.editorEmail,
      updatedByEmail: input.editorEmail,
      publishedAt: publish ? now : null,
    },
  });
  await prisma.helpArticleRevision.create({
    data: {
      articleId: created.id,
      version: 1,
      title,
      summary,
      contentJson,
      eventType: publish ? "PUBLISHED" : "DRAFT_SAVED",
      editorEmail: input.editorEmail,
      note: publish ? "Created and published" : "Initial draft created",
    },
  });
  return { ok: true, article: toDetailDto(created, true) };
}

export type UpdateArticleAction = "save-draft" | "publish" | "unpublish" | "discard-draft";

export async function updateHelpArticle(
  prisma: PrismaClient | null,
  slugOrId: string,
  input: {
    action?: UpdateArticleAction;
    categoryId?: string;
    title?: string;
    summary?: string;
    blocks?: HelpDocBlock[];
    relatedSlugs?: string[];
    contextKeys?: string[];
    needsReview?: boolean;
    revisionNote?: string;
    editorEmail: string;
  },
): Promise<{ ok: true; article: HelpArticleDetailDTO } | { ok: false; error: string; status: number }> {
  const action: UpdateArticleAction = input.action ?? "save-draft";
  const now = new Date();
  const nowIso = now.toISOString();

  if (!prisma) {
    const store = loadFileStore();
    const arts = [...(store.helpArticles ?? [])];
    const idx = arts.findIndex((a) => a.slug === slugOrId || a.id === slugOrId);
    if (idx < 0) return { ok: false, error: "Article not found.", status: 404 };
    const row = { ...arts[idx] };

    if (action === "discard-draft") {
      if (row.status !== "PUBLISHED" || !row.publishedContentJson) {
        return { ok: false, error: "Only published articles have a published version to restore.", status: 400 };
      }
      row.draftTitle = row.publishedTitle ?? row.draftTitle;
      row.draftSummary = row.publishedSummary ?? "";
      row.draftContentJson = row.publishedContentJson;
      row.hasUnpublishedChanges = false;
      row.updatedByEmail = input.editorEmail;
      row.updatedAt = nowIso;
      arts[idx] = row;
      store.helpArticles = arts;
      saveFileStore(store);
      return { ok: true, article: toDetailDto(row, true) };
    }

    if (action === "unpublish") {
      row.status = "DRAFT";
      row.hasUnpublishedChanges = false;
      row.updatedByEmail = input.editorEmail;
      row.updatedAt = nowIso;
      const revs = [...(store.helpRevisions ?? [])];
      const maxVer = revs.filter((r) => r.articleId === row.id).reduce((m, r) => Math.max(m, r.version), 0);
      revs.push({
        id: cuid(),
        articleId: row.id,
        version: maxVer + 1,
        title: row.draftTitle,
        summary: row.draftSummary,
        contentJson: row.draftContentJson,
        eventType: "UNPUBLISHED",
        editorEmail: input.editorEmail,
        note: input.revisionNote?.trim().slice(0, 200) || "Unpublished article",
        createdAt: nowIso,
      });
      arts[idx] = row;
      store.helpArticles = arts;
      store.helpRevisions = revs;
      saveFileStore(store);
      return { ok: true, article: toDetailDto(row, true) };
    }

    // Apply edits to draft buffer first
    if (input.categoryId !== undefined) {
      if (!(store.helpCategories ?? []).some((c) => c.id === input.categoryId)) {
        return { ok: false, error: "Selected category was not found.", status: 400 };
      }
      row.categoryId = input.categoryId;
    }
    if (input.title !== undefined) {
      const t = String(input.title).trim().slice(0, 200);
      if (!t) return { ok: false, error: "Article title cannot be empty.", status: 400 };
      row.draftTitle = t;
    }
    if (input.summary !== undefined) row.draftSummary = String(input.summary).trim().slice(0, 500);
    if (input.blocks !== undefined) row.draftContentJson = JSON.stringify(sanitizeBlocks(input.blocks));
    if (input.relatedSlugs !== undefined) {
      row.relatedSlugsJson = JSON.stringify(
        [...new Set(input.relatedSlugs.map((s) => String(s).trim()).filter((s) => s && s !== row.slug))].slice(0, 12),
      );
    }
    if (input.contextKeys !== undefined) {
      row.contextKeysJson = JSON.stringify(
        [...new Set(input.contextKeys.map((s) => String(s).trim().toLowerCase()).filter(Boolean))].slice(0, 12),
      );
    }
    if (input.needsReview !== undefined) row.needsReview = Boolean(input.needsReview);

    if (action === "publish") {
      row.status = "PUBLISHED";
      row.publishedTitle = row.draftTitle;
      row.publishedSummary = row.draftSummary;
      row.publishedContentJson = row.draftContentJson;
      row.hasUnpublishedChanges = false;
      row.needsReview = false;
      row.publishedAt = nowIso;
    } else {
      // Save draft without modifying published snapshot!
      row.hasUnpublishedChanges = row.status === "PUBLISHED";
    }
    row.updatedByEmail = input.editorEmail;
    row.updatedAt = nowIso;

    const revs = [...(store.helpRevisions ?? [])];
    const maxVer = revs.filter((r) => r.articleId === row.id).reduce((m, r) => Math.max(m, r.version), 0);
    revs.push({
      id: cuid(),
      articleId: row.id,
      version: maxVer + 1,
      title: row.draftTitle,
      summary: row.draftSummary,
      contentJson: row.draftContentJson,
      eventType: action === "publish" ? "PUBLISHED" : "DRAFT_SAVED",
      editorEmail: input.editorEmail,
      note:
        input.revisionNote?.trim().slice(0, 200) ||
        (action === "publish" ? "Published changes" : "Saved draft"),
      createdAt: nowIso,
    });

    arts[idx] = row;
    store.helpArticles = arts;
    store.helpRevisions = revs;
    saveFileStore(store);
    return { ok: true, article: toDetailDto(row, true) };
  }

  // Prisma path
  const existing = await prisma.helpArticle.findFirst({
    where: { OR: [{ slug: slugOrId }, { id: slugOrId }] },
  });
  if (!existing) return { ok: false, error: "Article not found.", status: 404 };

  if (action === "discard-draft") {
    if (existing.status !== "PUBLISHED" || !existing.publishedContentJson) {
      return { ok: false, error: "Only published articles have a published version to restore.", status: 400 };
    }
    const updated = await prisma.helpArticle.update({
      where: { id: existing.id },
      data: {
        draftTitle: existing.publishedTitle ?? existing.draftTitle,
        draftSummary: existing.publishedSummary ?? "",
        draftContentJson: existing.publishedContentJson,
        hasUnpublishedChanges: false,
        updatedByEmail: input.editorEmail,
      },
    });
    return { ok: true, article: toDetailDto(updated, true) };
  }

  const lastRev = await prisma.helpArticleRevision.findFirst({
    where: { articleId: existing.id },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (lastRev?.version ?? 0) + 1;

  if (action === "unpublish") {
    const updated = await prisma.helpArticle.update({
      where: { id: existing.id },
      data: {
        status: "DRAFT",
        hasUnpublishedChanges: false,
        updatedByEmail: input.editorEmail,
      },
    });
    await prisma.helpArticleRevision.create({
      data: {
        articleId: existing.id,
        version: nextVersion,
        title: updated.draftTitle,
        summary: updated.draftSummary,
        contentJson: updated.draftContentJson,
        eventType: "UNPUBLISHED",
        editorEmail: input.editorEmail,
        note: input.revisionNote?.trim().slice(0, 200) || "Unpublished article",
      },
    });
    return { ok: true, article: toDetailDto(updated, true) };
  }

  if (input.categoryId !== undefined) {
    const cat = await prisma.helpCategory.findUnique({ where: { id: input.categoryId } });
    if (!cat) return { ok: false, error: "Selected category was not found.", status: 400 };
  }

  const nextDraftTitle =
    input.title !== undefined ? String(input.title).trim().slice(0, 200) : existing.draftTitle;
  if (!nextDraftTitle) return { ok: false, error: "Article title cannot be empty.", status: 400 };

  const nextDraftSummary =
    input.summary !== undefined ? String(input.summary).trim().slice(0, 500) : existing.draftSummary;
  const nextDraftContent =
    input.blocks !== undefined ? JSON.stringify(sanitizeBlocks(input.blocks)) : existing.draftContentJson;
  const nextRelated =
    input.relatedSlugs !== undefined
      ? JSON.stringify(
          [...new Set(input.relatedSlugs.map((s) => String(s).trim()).filter((s) => s && s !== existing.slug))].slice(0, 12),
        )
      : existing.relatedSlugsJson;
  const nextContextKeys =
    input.contextKeys !== undefined
      ? JSON.stringify(
          [...new Set(input.contextKeys.map((s) => String(s).trim().toLowerCase()).filter(Boolean))].slice(0, 12),
        )
      : existing.contextKeysJson;

  const updated = await prisma.helpArticle.update({
    where: { id: existing.id },
    data: {
      categoryId: input.categoryId ?? existing.categoryId,
      draftTitle: nextDraftTitle,
      draftSummary: nextDraftSummary,
      draftContentJson: nextDraftContent,
      relatedSlugsJson: nextRelated,
      contextKeysJson: nextContextKeys,
      needsReview: action === "publish" ? false : input.needsReview ?? existing.needsReview,
      status: action === "publish" ? "PUBLISHED" : existing.status,
      publishedTitle: action === "publish" ? nextDraftTitle : existing.publishedTitle,
      publishedSummary: action === "publish" ? nextDraftSummary : existing.publishedSummary,
      publishedContentJson: action === "publish" ? nextDraftContent : existing.publishedContentJson,
      hasUnpublishedChanges: action === "publish" ? false : existing.status === "PUBLISHED",
      publishedAt: action === "publish" ? now : existing.publishedAt,
      updatedByEmail: input.editorEmail,
    },
  });

  await prisma.helpArticleRevision.create({
    data: {
      articleId: existing.id,
      version: nextVersion,
      title: updated.draftTitle,
      summary: updated.draftSummary,
      contentJson: updated.draftContentJson,
      eventType: action === "publish" ? "PUBLISHED" : "DRAFT_SAVED",
      editorEmail: input.editorEmail,
      note:
        input.revisionNote?.trim().slice(0, 200) ||
        (action === "publish" ? "Published changes" : "Saved draft"),
    },
  });

  return { ok: true, article: toDetailDto(updated, true) };
}

export async function restoreHelpArticleRevision(
  prisma: PrismaClient | null,
  slugOrId: string,
  revisionId: string,
  editorEmail: string,
): Promise<{ ok: true; article: HelpArticleDetailDTO } | { ok: false; error: string; status: number }> {
  if (!prisma) {
    const store = loadFileStore();
    const art = (store.helpArticles ?? []).find((a) => a.slug === slugOrId || a.id === slugOrId);
    if (!art) return { ok: false, error: "Article not found.", status: 404 };
    const rev = (store.helpRevisions ?? []).find((r) => r.id === revisionId && r.articleId === art.id);
    if (!rev) return { ok: false, error: "Revision not found.", status: 404 };
    return updateHelpArticle(null, art.id, {
      action: "save-draft",
      title: rev.title,
      summary: rev.summary,
      blocks: parseBlocksJson(rev.contentJson),
      revisionNote: `Restored draft from version ${rev.version}`,
      editorEmail,
    });
  }

  const art = await prisma.helpArticle.findFirst({
    where: { OR: [{ slug: slugOrId }, { id: slugOrId }] },
  });
  if (!art) return { ok: false, error: "Article not found.", status: 404 };
  const rev = await prisma.helpArticleRevision.findFirst({
    where: { id: revisionId, articleId: art.id },
  });
  if (!rev) return { ok: false, error: "Revision not found.", status: 404 };

  return updateHelpArticle(prisma, art.id, {
    action: "save-draft",
    title: rev.title,
    summary: rev.summary,
    blocks: parseBlocksJson(rev.contentJson),
    revisionNote: `Restored draft from version ${rev.version}`,
    editorEmail,
  });
}

export async function reorderHelpArticles(
  prisma: PrismaClient | null,
  categoryId: string,
  orderedArticleIds: string[],
): Promise<void> {
  if (!orderedArticleIds.length) return;
  if (!prisma) {
    const store = loadFileStore();
    const arts = [...(store.helpArticles ?? [])];
    const pos = new Map(orderedArticleIds.map((id, i) => [id, i + 1]));
    for (const a of arts) {
      if (pos.has(a.id)) {
        a.categoryId = categoryId;
        a.sortOrder = pos.get(a.id)!;
        a.updatedAt = new Date().toISOString();
      }
    }
    store.helpArticles = arts;
    saveFileStore(store);
    return;
  }
  await prisma.$transaction(
    orderedArticleIds.map((id, i) =>
      prisma.helpArticle.updateMany({ where: { id }, data: { categoryId, sortOrder: i + 1 } }),
    ),
  );
}

export async function deleteHelpArticle(
  prisma: PrismaClient | null,
  slugOrId: string,
): Promise<boolean> {
  if (!prisma) {
    const store = loadFileStore();
    const found = (store.helpArticles ?? []).find((a) => a.slug === slugOrId || a.id === slugOrId);
    if (!found) return false;
    store.helpArticles = (store.helpArticles ?? []).filter((a) => a.id !== found.id);
    store.helpRevisions = (store.helpRevisions ?? []).filter((r) => r.articleId !== found.id);
    saveFileStore(store);
    return true;
  }
  const found = await prisma.helpArticle.findFirst({
    where: { OR: [{ slug: slugOrId }, { id: slugOrId }] },
    select: { id: true },
  });
  if (!found) return false;
  await prisma.helpArticle.delete({ where: { id: found.id } });
  return true;
}

export function getHelpStatusSummary(articles: readonly HelpArticleSummaryDTO[]): {
  total: number;
  published: number;
  drafts: number;
  withUnpublishedChanges: number;
  needsReview: number;
} {
  let published = 0;
  let drafts = 0;
  let withUnpublishedChanges = 0;
  let needsReview = 0;
  for (const a of articles) {
    if (a.status === "PUBLISHED") published++;
    else drafts++;
    if (a.hasUnpublishedChanges) withUnpublishedChanges++;
    if (a.needsReview) needsReview++;
  }
  return { total: articles.length, published, drafts, withUnpublishedChanges, needsReview };
}

export type HelpStatusEnum = HelpArticleStatus;
