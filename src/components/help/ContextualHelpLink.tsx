"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import type { HelpArticleDetailDTO } from "@/lib/helpTypes";
import { HelpDocRenderer } from "./HelpDocRenderer";

/**
 * Lightweight, non-intrusive contextual Help trigger + slide-over quick guide panel.
 * Opens relevant Help Centre articles without interrupting workflows or leaving the page.
 */
export function ContextualHelpLink({
  contextKey,
  label = "Help",
  title = "Open quick guide for this page",
  className = "",
}: {
  contextKey: string;
  label?: string;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [articles, setArticles] = useState<HelpArticleDetailDTO[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);

    Promise.resolve()
      .then(() => {
        if (active) setLoading(true);
      })
      .then(() => fetch(`/api/help/context/${encodeURIComponent(contextKey)}`, { cache: "no-store" }))
      .then((r) => (r.ok ? r.json() : { articles: [], canManage: false }))
      .then((d) => {
        if (!active) return;
        const list: HelpArticleDetailDTO[] = Array.isArray(d.articles) ? d.articles : [];
        setArticles(list);
        setCanManage(Boolean(d.canManage));
        setSelectedSlug((prev) => (prev && list.some((a) => a.slug === prev) ? prev : list[0]?.slug ?? null));
      })
      .catch(() => {
        if (active) setArticles([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, contextKey]);

  const activeArticle = articles.find((a) => a.slug === selectedSlug) ?? articles[0] ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title}
        aria-label={title}
        className={`inline-flex items-center gap-1 rounded-lg border border-slate-200/90 bg-white px-2 py-1 text-xs font-medium text-slate-600 shadow-2xs transition-colors hover:border-indigo-300 hover:text-indigo-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-indigo-600 dark:hover:text-indigo-300 ${className}`}
      >
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span>{label}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label="Quick Help"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Panel Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300">
                  ?
                </span>
                <span className="text-sm font-bold text-slate-900 dark:text-white">Quick Help</span>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={activeArticle ? `/help/${encodeURIComponent(activeArticle.slug)}` : "/help"}
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:border-zinc-700 dark:text-indigo-400 dark:hover:bg-zinc-800"
                >
                  Open in Help Centre →
                </Link>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close Quick Help"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Guide Switcher Pills (when multiple guides match this screen) */}
            {articles.length > 1 && (
              <div className="flex flex-wrap gap-1.5 border-b border-slate-100 bg-slate-50/70 px-5 py-2.5 dark:border-zinc-800 dark:bg-zinc-800/40">
                {articles.map((art) => (
                  <button
                    key={art.slug}
                    type="button"
                    onClick={() => setSelectedSlug(art.slug)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      activeArticle?.slug === art.slug
                        ? "bg-indigo-600 text-white"
                        : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    }`}
                  >
                    {art.title}
                  </button>
                ))}
              </div>
            )}

            {/* Panel Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {loading ? (
                <p className="py-10 text-center text-xs text-slate-400">Loading guide...</p>
              ) : !activeArticle ? (
                <div className="py-10 text-center">
                  <p className="text-sm font-semibold text-slate-800 dark:text-zinc-200">
                    No published guide linked to this page yet.
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                    Visit the Help Centre to browse all available documentation.
                  </p>
                  <Link
                    href="/help"
                    onClick={() => setOpen(false)}
                    className="mt-4 inline-block rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white"
                  >
                    Browse Help Centre
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white">{activeArticle.title}</h2>
                      {canManage && activeArticle.status === "DRAFT" && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                          Draft (Admin Preview)
                        </span>
                      )}
                    </div>
                    {activeArticle.summary && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">{activeArticle.summary}</p>
                    )}
                  </div>
                  <hr className="border-slate-100 dark:border-zinc-800" />
                  <HelpDocRenderer blocks={activeArticle.blocks} compact />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
