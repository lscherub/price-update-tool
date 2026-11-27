"use client";

import React, { useState } from "react";
import Link from "next/link";
import { extractToc, type HelpDocBlock } from "@/lib/helpTypes";

/**
 * Renders lightweight inline formatting (**bold**, *italic*, `code`, [label](href))
 * safely as React elements without dangerouslySetInnerHTML.
 */
export function renderInlineRichText(
  text: string,
  onNavigateArticle?: (slug: string) => void,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIdx) {
      nodes.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={key++} className="font-semibold text-slate-900 dark:text-white">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-slate-800 dark:bg-zinc-800 dark:text-zinc-200"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const m = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (m) {
        const label = m[1];
        const href = m[2].trim();
        const isHelpArticle = href.startsWith("/help/");
        const isSafeHref =
          href.startsWith("/") || href.startsWith("https://") || href.startsWith("http://") || href.startsWith("mailto:");
        if (isHelpArticle && onNavigateArticle) {
          const targetSlug = href.replace(/^\/help\//, "").replace(/\/+$/, "");
          nodes.push(
            <button
              key={key++}
              type="button"
              onClick={() => onNavigateArticle(targetSlug)}
              className="font-medium text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              {label}
            </button>,
          );
        } else if (isSafeHref && href.startsWith("/")) {
          nodes.push(
            <Link
              key={key++}
              href={href}
              className="font-medium text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              {label}
            </Link>,
          );
        } else if (isSafeHref) {
          nodes.push(
            <a
              key={key++}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              {label}
            </a>,
          );
        } else {
          nodes.push(label);
        }
      } else {
        nodes.push(token);
      }
    }
    lastIdx = pattern.lastIndex;
  }
  if (lastIdx < text.length) {
    nodes.push(text.slice(lastIdx));
  }
  return nodes;
}

export function HelpDocRenderer({
  blocks,
  compact = false,
  onNavigateArticle,
}: {
  blocks: readonly HelpDocBlock[];
  compact?: boolean;
  onNavigateArticle?: (slug: string) => void;
}) {
  const [lightbox, setLightbox] = useState<{ url: string; alt: string; caption: string } | null>(null);
  const toc = extractToc(blocks);
  const anchorByBlockId = new Map(toc.map((t) => [t.id, t.anchor]));

  return (
    <div className={`flex flex-col ${compact ? "gap-3.5 text-xs" : "gap-5 text-sm"} leading-relaxed text-slate-700 dark:text-zinc-300`}>
      {blocks.map((block) => {
        if (block.type === "heading") {
          const anchor = anchorByBlockId.get(block.id);
          if (block.level === 2) {
            return (
              <h2
                key={block.id}
                id={anchor}
                className={`scroll-mt-24 border-b border-slate-200/80 pb-1.5 font-bold tracking-tight text-slate-900 dark:border-zinc-800 dark:text-white ${
                  compact ? "mt-2 text-sm" : "mt-3 text-lg"
                }`}
              >
                {block.text}
              </h2>
            );
          }
          return (
            <h3
              key={block.id}
              id={anchor}
              className={`scroll-mt-24 font-bold text-slate-900 dark:text-white ${
                compact ? "mt-1 text-xs" : "mt-2 text-base"
              }`}
            >
              {block.text}
            </h3>
          );
        }

        if (block.type === "paragraph") {
          if (!block.text.trim()) return null;
          return (
            <p key={block.id} className="whitespace-pre-line">
              {renderInlineRichText(block.text, onNavigateArticle)}
            </p>
          );
        }

        if (block.type === "steps") {
          const items = block.items.filter((i) => i.trim() !== "");
          if (!items.length) return null;
          return (
            <ol key={block.id} className="flex flex-col gap-2.5">
              {items.map((item, idx) => (
                <li key={idx} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-bold text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300">
                    {idx + 1}
                  </span>
                  <span className="flex-1">{renderInlineRichText(item, onNavigateArticle)}</span>
                </li>
              ))}
            </ol>
          );
        }

        if (block.type === "bullets") {
          const items = block.items.filter((i) => i.trim() !== "");
          if (!items.length) return null;
          return (
            <ul key={block.id} className="list-disc space-y-1.5 pl-5 marker:text-slate-400 dark:marker:text-zinc-500">
              {items.map((item, idx) => (
                <li key={idx}>{renderInlineRichText(item, onNavigateArticle)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "callout") {
          const styles =
            block.variant === "warning"
              ? "border-amber-300 bg-amber-50/80 text-amber-950 dark:border-amber-800/80 dark:bg-amber-950/30 dark:text-amber-200"
              : block.variant === "tip"
                ? "border-emerald-300 bg-emerald-50/80 text-emerald-950 dark:border-emerald-800/80 dark:bg-emerald-950/30 dark:text-emerald-200"
                : "border-sky-300 bg-sky-50/80 text-sky-950 dark:border-sky-800/80 dark:bg-sky-950/30 dark:text-sky-200";
          const label =
            block.variant === "warning" ? "Warning" : block.variant === "tip" ? "Tip" : "Note";
          return (
            <div key={block.id} className={`rounded-xl border-l-4 border p-3.5 ${styles}`}>
              <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider opacity-90">
                <span>{block.title || label}</span>
              </div>
              {block.text && (
                <p className="mt-1 whitespace-pre-line text-[0.95em] leading-relaxed">
                  {renderInlineRichText(block.text, onNavigateArticle)}
                </p>
              )}
            </div>
          );
        }

        if (block.type === "table") {
          return (
            <div
              key={block.id}
              className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            >
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-300">
                    {block.headers.map((h, i) => (
                      <th key={i} className="px-3.5 py-2.5">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                  {block.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-50/60 dark:hover:bg-zinc-800/40">
                      {row.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          className={`px-3.5 py-2.5 align-top ${
                            cIdx === 0 ? "font-semibold text-slate-900 dark:text-zinc-100" : ""
                          }`}
                        >
                          {renderInlineRichText(cell, onNavigateArticle)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.type === "image") {
          if (!block.url) return null;
          return (
            <figure
              key={block.id}
              className="flex flex-col items-center rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/60"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={block.url}
                alt={block.alt || block.caption || "Documentation screenshot"}
                onClick={() => setLightbox({ url: block.url, alt: block.alt, caption: block.caption })}
                className="max-h-[460px] w-auto max-w-full cursor-zoom-in rounded-lg border border-slate-200/80 bg-white object-contain shadow-xs dark:border-zinc-700"
                loading="lazy"
              />
              {block.caption && (
                <figcaption className="mt-2 text-center text-xs text-slate-500 dark:text-zinc-400">
                  {block.caption}
                </figcaption>
              )}
            </figure>
          );
        }

        return null;
      })}

      {/* Lightbox modal for zooming screenshots */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="Screenshot preview"
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative flex max-h-[92vh] max-w-5xl flex-col items-center rounded-2xl bg-white p-4 shadow-2xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setLightbox(null)}
              aria-label="Close preview"
              className="absolute right-3 top-3 rounded-lg border border-slate-200 bg-white/90 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            >
              Close ✕
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.url}
              alt={lightbox.alt || lightbox.caption || "Screenshot"}
              className="max-h-[80vh] w-auto max-w-full rounded-lg object-contain"
            />
            {lightbox.caption && (
              <p className="mt-2.5 text-center text-xs text-slate-600 dark:text-zinc-300">{lightbox.caption}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
