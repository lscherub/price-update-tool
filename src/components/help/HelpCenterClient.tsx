"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoadingButton } from "@/components/LoadingButton";
import { useToast } from "@/components/Toast";
import { apiErrorText } from "@/lib/apiError";
import {
  extractToc,
  newBlockId,
  type HelpArticleDetailDTO,
  type HelpArticleSummaryDTO,
  type HelpCategoryDTO,
  type HelpRevisionDTO,
  type HelpSearchResultDTO,
} from "@/lib/helpTypes";
import { HelpArticleEditor } from "./HelpArticleEditor";
import { HelpDocRenderer } from "./HelpDocRenderer";

type LibrarySummary = {
  total: number;
  published: number;
  drafts: number;
  withUnpublishedChanges: number;
  needsReview: number;
};

export function HelpCenterClient({ initialSlug }: { initialSlug?: string }) {
  const router = useRouter();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [categories, setCategories] = useState<HelpCategoryDTO[]>([]);
  const [articles, setArticles] = useState<HelpArticleSummaryDTO[]>([]);
  const [summary, setSummary] = useState<LibrarySummary | null>(null);

  // Navigation & viewing state
  const [selectedSlug, setSelectedSlug] = useState<string | null>(initialSlug ?? null);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "PUBLISHED" | "DRAFT" | "review">("all");
  const [adminManageMode, setAdminManageMode] = useState(false);

  // Active article detail
  const [articleLoading, setArticleLoading] = useState(false);
  const [activeArticle, setActiveArticle] = useState<HelpArticleDetailDTO | null>(null);
  const [activeCategory, setActiveCategory] = useState<HelpCategoryDTO | null>(null);
  const [relatedArticles, setRelatedArticles] = useState<HelpArticleSummaryDTO[]>([]);
  const [revisions, setRevisions] = useState<HelpRevisionDTO[]>([]);
  const [editing, setEditing] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<HelpSearchResultDTO[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Admin modals: New Article / New Category
  const [showNewArticleModal, setShowNewArticleModal] = useState(false);
  const [newArtTitle, setNewArtTitle] = useState("");
  const [newArtCategoryId, setNewArtCategoryId] = useState("");
  const [newArtSummary, setNewArtSummary] = useState("");
  const [creatingArt, setCreatingArt] = useState(false);

  const [showNewCatModal, setShowNewCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");
  const [creatingCat, setCreatingCat] = useState(false);

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/help", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(apiErrorText(d, "Could not load Help Centre."));
        return;
      }
      setError("");
      setCanManage(Boolean(d.canManage));
      const cats: HelpCategoryDTO[] = Array.isArray(d.categories) ? d.categories : [];
      setCategories(cats);
      setArticles(Array.isArray(d.articles) ? d.articles : []);
      setSummary(d.summary ?? null);
      if (cats.length && !newArtCategoryId) {
        setNewArtCategoryId(cats[0].id);
      }
    } catch {
      setError("Could not reach the server to load Help Centre.");
    } finally {
      setLoading(false);
    }
  }, [newArtCategoryId]);

  useEffect(() => {
    let active = true;
    fetch("/api/help", { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => {
        if (!active) return;
        if (!ok) {
          setError(apiErrorText(d, "Could not load Help Centre."));
          return;
        }
        setError("");
        setCanManage(Boolean(d.canManage));
        const cats: HelpCategoryDTO[] = Array.isArray(d.categories) ? d.categories : [];
        setCategories(cats);
        setArticles(Array.isArray(d.articles) ? d.articles : []);
        setSummary(d.summary ?? null);
        setNewArtCategoryId((prev) => prev || cats[0]?.id || "");
      })
      .catch(() => {
        if (active) setError("Could not reach the server to load Help Centre.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const loadArticle = useCallback(async (slug: string) => {
    setArticleLoading(true);
    try {
      const r = await fetch(`/api/help/articles/${encodeURIComponent(slug)}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setActiveArticle(null);
        setActiveCategory(null);
        setRelatedArticles([]);
        setRevisions([]);
        return;
      }
      setActiveArticle(d.article ?? null);
      setActiveCategory(d.category ?? null);
      setRelatedArticles(Array.isArray(d.related) ? d.related : []);
      setRevisions(Array.isArray(d.revisions) ? d.revisions : []);
    } catch {
      setActiveArticle(null);
    } finally {
      setArticleLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (!selectedSlug) {
      Promise.resolve().then(() => {
        if (!active) return;
        setActiveArticle(null);
        setActiveCategory(null);
        setRelatedArticles([]);
        setRevisions([]);
        setEditing(false);
      });
      return () => {
        active = false;
      };
    }
    Promise.resolve()
      .then(() => {
        if (active) setArticleLoading(true);
      })
      .then(() => fetch(`/api/help/articles/${encodeURIComponent(selectedSlug)}`, { cache: "no-store" }))
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => {
        if (!active) return;
        if (!ok) {
          setActiveArticle(null);
          setActiveCategory(null);
          setRelatedArticles([]);
          setRevisions([]);
          return;
        }
        setActiveArticle(d.article ?? null);
        setActiveCategory(d.category ?? null);
        setRelatedArticles(Array.isArray(d.related) ? d.related : []);
        setRevisions(Array.isArray(d.revisions) ? d.revisions : []);
      })
      .catch(() => {
        if (active) setActiveArticle(null);
      })
      .finally(() => {
        if (active) setArticleLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedSlug]);

  // Debounced full-text search
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/help/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        const d = await r.json().catch(() => ({}));
        if (!ctrl.signal.aborted && r.ok) {
          setSearchResults(Array.isArray(d.results) ? d.results : []);
        }
      } catch {
        /* aborted */
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 220);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [searchQuery]);

  const openArticle = (slug: string, startEditing = false) => {
    setSelectedSlug(slug);
    setEditing(startEditing);
    setSearchQuery("");
    setSearchResults(null);
    setMobileNavOpen(false);
    router.push(`/help/${encodeURIComponent(slug)}`, { scroll: false });
  };

  const goHome = () => {
    setSelectedSlug(null);
    setEditing(false);
    setMobileNavOpen(false);
    router.push("/help", { scroll: false });
  };

  const filteredArticles = useMemo(() => {
    return articles.filter((a) => {
      if (selectedCategoryFilter !== "all" && a.categoryId !== selectedCategoryFilter) return false;
      if (canManage) {
        if (statusFilter === "PUBLISHED" && a.status !== "PUBLISHED") return false;
        if (statusFilter === "DRAFT" && a.status !== "DRAFT") return false;
        if (statusFilter === "review" && !a.needsReview && !a.hasUnpublishedChanges) return false;
      }
      return true;
    });
  }, [articles, selectedCategoryFilter, statusFilter, canManage]);

  const articlesByCategory = useMemo(() => {
    const map = new Map<string, HelpArticleSummaryDTO[]>();
    for (const a of filteredArticles) {
      const list = map.get(a.categoryId) ?? [];
      list.push(a);
      map.set(a.categoryId, list);
    }
    return map;
  }, [filteredArticles]);

  const activeToc = useMemo(() => {
    if (!activeArticle) return [];
    return extractToc(activeArticle.blocks);
  }, [activeArticle]);

  // Admin: create article
  const handleCreateArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newArtTitle.trim() || !newArtCategoryId || creatingArt) return;
    setCreatingArt(true);
    try {
      const r = await fetch("/api/help/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: newArtCategoryId,
          title: newArtTitle.trim(),
          summary: newArtSummary.trim(),
          blocks: [
            { id: newBlockId(), type: "heading", level: 2, text: "Overview" },
            { id: newBlockId(), type: "paragraph", text: "" },
          ],
          publish: false,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error("Could not create article.", apiErrorText(d, "Creation failed."));
        return;
      }
      setShowNewArticleModal(false);
      setNewArtTitle("");
      setNewArtSummary("");
      toast.success("Draft article created.", "Edit content and click Publish when ready for staff.");
      await loadLibrary();
      openArticle(d.article.slug, true);
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setCreatingArt(false);
    }
  };

  // Admin: create category
  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim() || creatingCat) return;
    setCreatingCat(true);
    try {
      const r = await fetch("/api/help/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCatName.trim(), description: newCatDesc.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error("Could not create category.", apiErrorText(d, "Creation failed."));
        return;
      }
      setShowNewCatModal(false);
      setNewCatName("");
      setNewCatDesc("");
      toast.success("Category created.");
      await loadLibrary();
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setCreatingCat(false);
    }
  };

  // Admin: reorder categories
  const moveCategory = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= categories.length) return;
    const next = [...categories];
    [next[index], next[target]] = [next[target], next[index]];
    setCategories(next);
    await fetch("/api/help/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: next.map((c) => c.id) }),
    }).catch(() => null);
  };

  // Admin: reorder articles within a category
  const moveArticle = async (categoryId: string, list: HelpArticleSummaryDTO[], index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    const nextList = [...list];
    [nextList[index], nextList[target]] = [nextList[target], nextList[index]];
    await fetch("/api/help/articles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId, orderedIds: nextList.map((a) => a.id) }),
    }).catch(() => null);
    await loadLibrary();
  };

  const sidebarContent = (
    <div className="flex flex-col gap-3">
      {/* Search box */}
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-slate-400">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </span>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            const val = e.target.value;
            setSearchQuery(val);
            if (!val.trim()) {
              setSearchResults(null);
              setSearching(false);
            }
          }}
          placeholder="Search guides & SOPs..."
          aria-label="Search Help Centre"
          className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/70 pl-8 pr-7 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-white dark:focus:bg-zinc-900"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setSearchResults(null);
            }}
            aria-label="Clear search"
            className="absolute inset-y-0 right-2 flex items-center text-slate-400 hover:text-slate-700"
          >
            ×
          </button>
        )}
      </div>

      {/* Home / Overview link */}
      <button
        type="button"
        onClick={goHome}
        className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-bold transition-colors ${
          !selectedSlug
            ? "bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
            : "text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
        }`}
      >
        <span>Help Centre Home</span>
        <span className="text-[10px] font-normal opacity-70">{articles.length}</span>
      </button>

      {/* Admin quick status filter */}
      {canManage && (
        <div className="flex flex-wrap gap-1 border-b border-slate-100 pb-2 dark:border-zinc-800">
          {(
            [
              ["all", "All"],
              ["PUBLISHED", "Published"],
              ["DRAFT", "Drafts"],
              ["review", "Needs Review"],
            ] as const
          ).map(([id, lbl]) => (
            <button
              key={id}
              type="button"
              onClick={() => setStatusFilter(id)}
              className={`rounded-md px-2 py-1 text-[10px] font-bold transition-colors ${
                statusFilter === id
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      )}

      {/* Category & Article Navigation Tree */}
      <nav aria-label="Help Centre categories" className="flex flex-col gap-4">
        {categories.map((cat, catIdx) => {
          const catArticles = articlesByCategory.get(cat.id) ?? [];
          if (!canManage && catArticles.length === 0) return null;
          return (
            <div key={cat.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategoryFilter(selectedCategoryFilter === cat.id ? "all" : cat.id);
                    if (selectedSlug) goHome();
                  }}
                  className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
                >
                  {cat.name}
                </button>
                {canManage && adminManageMode && (
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={catIdx === 0}
                      onClick={() => void moveCategory(catIdx, -1)}
                      title="Move category up"
                      className="rounded px-1 text-[10px] text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-zinc-800"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={catIdx === categories.length - 1}
                      onClick={() => void moveCategory(catIdx, 1)}
                      title="Move category down"
                      className="rounded px-1 text-[10px] text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-zinc-800"
                    >
                      ▼
                    </button>
                  </div>
                )}
              </div>
              {catArticles.length === 0 ? (
                <p className="px-2.5 py-1 text-[11px] italic text-slate-400">No articles</p>
              ) : (
                catArticles.map((art, artIdx) => {
                  const isActive = selectedSlug === art.slug;
                  return (
                    <div key={art.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openArticle(art.slug, false)}
                        className={`flex flex-1 items-center justify-between gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                          isActive
                            ? "bg-indigo-600 font-semibold text-white shadow-2xs"
                            : "text-slate-700 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        }`}
                      >
                        <span className="truncate">{art.title}</span>
                        {canManage && (
                          <span className="flex shrink-0 items-center gap-1">
                            {art.status === "DRAFT" && (
                              <span
                                className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase ${
                                  isActive
                                    ? "bg-white/20 text-white"
                                    : "bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300"
                                }`}
                              >
                                Draft
                              </span>
                            )}
                            {art.status === "PUBLISHED" && art.hasUnpublishedChanges && (
                              <span
                                className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase ${
                                  isActive
                                    ? "bg-white/20 text-white"
                                    : "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300"
                                }`}
                              >
                                Edited
                              </span>
                            )}
                          </span>
                        )}
                      </button>
                      {canManage && adminManageMode && (
                        <div className="flex flex-col">
                          <button
                            type="button"
                            disabled={artIdx === 0}
                            onClick={() => void moveArticle(cat.id, catArticles, artIdx, -1)}
                            title="Move article up"
                            className="text-[9px] leading-none text-slate-400 hover:text-slate-800 disabled:opacity-30"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            disabled={artIdx === catArticles.length - 1}
                            onClick={() => void moveArticle(cat.id, catArticles, artIdx, 1)}
                            title="Move article down"
                            className="text-[9px] leading-none text-slate-400 hover:text-slate-800 disabled:opacity-30"
                          >
                            ▼
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              Help Centre & SOPs
            </h1>
            {canManage && (
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300">
                Documentation Admin
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
            Step-by-step guides and Standard Operating Procedures for the Genesis Pricing Application.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileNavOpen((v) => !v)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 lg:hidden"
          >
            {mobileNavOpen ? "Hide Topics" : "Browse Topics"}
          </button>

          {canManage && (
            <>
              <button
                type="button"
                onClick={() => setAdminManageMode((v) => !v)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  adminManageMode
                    ? "border-indigo-500 bg-indigo-50 text-indigo-800 dark:border-indigo-500 dark:bg-indigo-950/60 dark:text-indigo-200"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                }`}
              >
                {adminManageMode ? "Done Organizing" : "Organize / Reorder"}
              </button>
              <button
                type="button"
                onClick={() => setShowNewCatModal(true)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                + New Category
              </button>
              <button
                type="button"
                onClick={() => setShowNewArticleModal(true)}
                className="rounded-lg px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:opacity-95"
                style={{ background: "var(--accent-primary, #4f46e5)" }}
              >
                + New Article
              </button>
            </>
          )}
        </div>
      </div>

      {/* Admin Draft Review Banner */}
      {canManage && summary && summary.drafts > 0 && !editing && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <div>
            <strong className="font-bold">
              {summary.published} Published · {summary.drafts} Draft{summary.drafts === 1 ? "" : "s"}
              {summary.withUnpublishedChanges > 0 ? ` · ${summary.withUnpublishedChanges} with unpublished edits` : ""}
            </strong>
            <p className="mt-0.5 opacity-90">
              Regular staff only see Published articles. Review drafts, add any screenshots you want, and click <strong>Publish</strong> to make them visible to staff.
            </p>
          </div>
          {summary.drafts > 0 && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter("DRAFT");
                if (selectedSlug) goHome();
              }}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-zinc-900 dark:text-amber-200"
            >
              Review Drafts ({summary.drafts})
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Main Responsive Layout: Left Nav Sidebar + Content + Optional Right TOC */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Navigation Sidebar */}
        <aside
          className={`rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 lg:col-span-3 lg:block lg:h-fit lg:sticky lg:top-20 ${
            mobileNavOpen ? "block" : "hidden"
          }`}
        >
          {loading ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading topics...</p>
          ) : (
            sidebarContent
          )}
        </aside>

        {/* Center Content Area */}
        <div className={activeArticle && !editing && activeToc.length > 0 ? "lg:col-span-7" : "lg:col-span-9"}>
          {/* Search Results Panel */}
          {searchQuery.trim() ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-zinc-800">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Search results for &ldquo;{searchQuery.trim()}&rdquo;
                </h2>
                <span className="text-xs text-slate-500">
                  {searching ? "Searching..." : `${searchResults?.length ?? 0} match${(searchResults?.length ?? 0) === 1 ? "" : "es"}`}
                </span>
              </div>
              <div className="mt-3 divide-y divide-slate-100 dark:divide-zinc-800">
                {!searching && (searchResults?.length ?? 0) === 0 && (
                  <p className="py-8 text-center text-xs text-slate-500 dark:text-zinc-400">
                    No matching articles found. Try different keywords or browse the categories on the left.
                  </p>
                )}
                {(searchResults ?? []).map((res) => (
                  <button
                    key={res.slug}
                    type="button"
                    onClick={() => openArticle(res.slug)}
                    className="flex w-full flex-col gap-1 py-3 text-left hover:bg-slate-50/70 dark:hover:bg-zinc-800/40 rounded-lg px-2 transition-colors"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-indigo-700 dark:text-indigo-400">{res.title}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {res.categoryName}
                      </span>
                      {canManage && res.status === "DRAFT" && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                          Draft
                        </span>
                      )}
                    </div>
                    {res.snippet && (
                      <p className="text-xs text-slate-600 dark:text-zinc-400 line-clamp-2">{res.snippet}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : selectedSlug ? (
            /* Article Reader OR Visual Editor */
            articleLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500 dark:border-zinc-800 dark:bg-zinc-900">
                Loading article...
              </div>
            ) : !activeArticle ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Article not available</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                  This article may still be a draft or may have been removed.
                </p>
                <button
                  type="button"
                  onClick={goHome}
                  className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white"
                >
                  Return to Help Centre Home
                </button>
              </div>
            ) : editing && canManage ? (
              <HelpArticleEditor
                key={activeArticle.id}
                article={activeArticle}
                categories={categories}
                allArticles={articles}
                revisions={revisions}
                onSaved={async (updated) => {
                  setActiveArticle(updated);
                  await Promise.all([loadLibrary(), loadArticle(updated.slug)]);
                }}
                onDeleted={async () => {
                  setEditing(false);
                  await loadLibrary();
                  goHome();
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <article className="flex flex-col gap-5 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
                {/* Article Header */}
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-zinc-800">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-zinc-400">
                      <button type="button" onClick={goHome} className="hover:text-indigo-600 hover:underline">
                        Help Centre
                      </button>
                      {activeCategory && (
                        <>
                          <span>/</span>
                          <span>{activeCategory.name}</span>
                        </>
                      )}
                    </div>
                    <h1 className="mt-1.5 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                      {activeArticle.title}
                    </h1>
                    {activeArticle.summary && (
                      <p className="mt-1.5 text-sm text-slate-500 dark:text-zinc-400">
                        {activeArticle.summary}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-zinc-400">
                      <span>
                        Last updated {new Date(activeArticle.updatedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                      </span>
                      {activeArticle.publishedAt && (
                        <span>
                          · Published {new Date(activeArticle.publishedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                        </span>
                      )}
                      {canManage && (
                        <>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              activeArticle.status === "PUBLISHED"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
                            }`}
                          >
                            {activeArticle.status === "PUBLISHED" ? "Published" : "Draft — Hidden from Staff"}
                          </span>
                          {activeArticle.hasUnpublishedChanges && (
                            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300">
                              Has Unpublished Draft Changes
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                    >
                      Edit Article
                    </button>
                  )}
                </div>

                {/* Mobile Inline TOC */}
                {activeToc.length > 0 && (
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 dark:border-zinc-800 dark:bg-zinc-800/40 lg:hidden">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                      On This Page
                    </div>
                    <ul className="mt-2 space-y-1 text-xs">
                      {activeToc.map((t) => (
                        <li key={t.id} className={t.level === 3 ? "pl-3" : ""}>
                          <a href={`#${t.anchor}`} className="text-indigo-700 hover:underline dark:text-indigo-400">
                            {t.text}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Article Body */}
                <HelpDocRenderer
                  blocks={activeArticle.blocks}
                  onNavigateArticle={(slug) => openArticle(slug)}
                />

                {/* Related Articles */}
                {relatedArticles.length > 0 && (
                  <div className="mt-4 border-t border-slate-200 pt-5 dark:border-zinc-800">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                      Related Articles
                    </h2>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {relatedArticles.map((rel) => (
                        <button
                          key={rel.slug}
                          type="button"
                          onClick={() => openArticle(rel.slug)}
                          className="flex flex-col rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/30 dark:border-zinc-800 dark:bg-zinc-800/40 dark:hover:border-indigo-700"
                        >
                          <span className="text-xs font-bold text-slate-900 dark:text-white">{rel.title}</span>
                          {rel.summary && (
                            <span className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400 line-clamp-2">
                              {rel.summary}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            )
          ) : (
            /* Help Centre Home / Category Directory */
            <div className="flex flex-col gap-5">
              {!loading && articles.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    Documentation Is Being Prepared
                  </h2>
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-zinc-400">
                    No Help Centre articles have been published yet. Once an administrator reviews and publishes guides, they will appear here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {categories
                    .filter((c) => selectedCategoryFilter === "all" || c.id === selectedCategoryFilter)
                    .map((cat) => {
                      const catArts = articlesByCategory.get(cat.id) ?? [];
                      if (!canManage && catArts.length === 0) return null;
                      return (
                        <div
                          key={cat.id}
                          className="flex flex-col rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h2 className="text-base font-bold text-slate-900 dark:text-white">{cat.name}</h2>
                              {cat.description && (
                                <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">{cat.description}</p>
                              )}
                            </div>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-zinc-800 dark:text-zinc-300">
                              {catArts.length}
                            </span>
                          </div>
                          <ul className="mt-4 flex flex-col divide-y divide-slate-100 dark:divide-zinc-800">
                            {catArts.length === 0 ? (
                              <li className="py-2 text-xs italic text-slate-400">No articles match current filter.</li>
                            ) : (
                              catArts.map((a) => (
                                <li key={a.id} className="py-2">
                                  <button
                                    type="button"
                                    onClick={() => openArticle(a.slug)}
                                    className="group flex w-full items-center justify-between gap-2 text-left"
                                  >
                                    <span className="text-xs font-semibold text-slate-800 group-hover:text-indigo-600 dark:text-zinc-200 dark:group-hover:text-indigo-400">
                                      {a.title}
                                    </span>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                      {canManage && a.status === "DRAFT" && (
                                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                                          Draft
                                        </span>
                                      )}
                                      {canManage && a.status === "PUBLISHED" && a.hasUnpublishedChanges && (
                                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300">
                                          Edited
                                        </span>
                                      )}
                                      <span className="text-xs text-slate-400 group-hover:text-indigo-600">→</span>
                                    </div>
                                  </button>
                                </li>
                              ))
                            )}
                          </ul>
                        </div>
                      );
                    })}
                </div>
              )}
              {selectedCategoryFilter !== "all" && (
                <div>
                  <button
                    type="button"
                    onClick={() => setSelectedCategoryFilter("all")}
                    className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    ← Show all categories
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Sticky Table of Contents (Desktop Article View) */}
        {activeArticle && !editing && activeToc.length > 0 && (
          <aside className="hidden lg:col-span-2 lg:block">
            <div className="sticky top-20 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                Table of Contents
              </div>
              <ul className="mt-2.5 space-y-1.5 text-xs">
                {activeToc.map((t) => (
                  <li key={t.id} className={t.level === 3 ? "pl-3" : ""}>
                    <a
                      href={`#${t.anchor}`}
                      className="block leading-snug text-slate-600 hover:text-indigo-600 dark:text-zinc-400 dark:hover:text-indigo-400"
                    >
                      {t.text}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-4 border-t border-slate-100 pt-3 dark:border-zinc-800">
                <Link
                  href="/help"
                  onClick={(e) => {
                    e.preventDefault();
                    goHome();
                  }}
                  className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
                >
                  ← All Help Topics
                </Link>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Modal: Create New Article (Admin) */}
      {showNewArticleModal && canManage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Create new Help Centre article"
          onClick={() => !creatingArt && setShowNewArticleModal(false)}
        >
          <form
            onSubmit={handleCreateArticle}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h2 className="text-base font-bold text-slate-900 dark:text-white">New Help Centre Article</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              New articles start as private Drafts until you publish them.
            </p>
            <div className="mt-4 flex flex-col gap-3 text-xs">
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Title</span>
                <input
                  required
                  value={newArtTitle}
                  onChange={(e) => setNewArtTitle(e.target.value)}
                  placeholder="e.g., Handling Vendor Discontinued Items"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Category</span>
                <select
                  required
                  value={newArtCategoryId}
                  onChange={(e) => setNewArtCategoryId(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Short Summary (Optional)</span>
                <input
                  value={newArtSummary}
                  onChange={(e) => setNewArtSummary(e.target.value)}
                  placeholder="Brief summary shown in search and category cards"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={creatingArt}
                onClick={() => setShowNewArticleModal(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium dark:border-zinc-700"
              >
                Cancel
              </button>
              <LoadingButton
                type="submit"
                busy={creatingArt}
                busyLabel="Creating..."
                className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
              >
                Create Draft & Edit
              </LoadingButton>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Create New Category (Admin) */}
      {showNewCatModal && canManage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Create new category"
          onClick={() => !creatingCat && setShowNewCatModal(false)}
        >
          <form
            onSubmit={handleCreateCategory}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h2 className="text-base font-bold text-slate-900 dark:text-white">New Documentation Category</h2>
            <div className="mt-4 flex flex-col gap-3 text-xs">
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Category Name</span>
                <input
                  required
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="e.g., Store Operations SOPs"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Description (Optional)</span>
                <input
                  value={newCatDesc}
                  onChange={(e) => setNewCatDesc(e.target.value)}
                  placeholder="Short description of topics in this category"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={creatingCat}
                onClick={() => setShowNewCatModal(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium dark:border-zinc-700"
              >
                Cancel
              </button>
              <LoadingButton
                type="submit"
                busy={creatingCat}
                busyLabel="Creating..."
                className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
              >
                Create Category
              </LoadingButton>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
