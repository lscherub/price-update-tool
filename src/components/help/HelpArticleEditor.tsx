"use client";

import React, { useMemo, useState } from "react";
import { LoadingButton } from "@/components/LoadingButton";
import { useToast } from "@/components/Toast";
import { apiErrorText } from "@/lib/apiError";
import {
  extractToc,
  newBlockId,
  type HelpArticleDetailDTO,
  type HelpArticleSummaryDTO,
  type HelpCalloutVariant,
  type HelpCategoryDTO,
  type HelpDocBlock,
  type HelpRevisionDTO,
} from "@/lib/helpTypes";
import { HelpDocRenderer } from "./HelpDocRenderer";

export const CONTEXT_KEY_OPTIONS: { key: string; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "sessions", label: "Price Updates History" },
  { key: "new-price-update", label: "New Price Update" },
  { key: "full-vendor-update", label: "Full Vendor Update" },
  { key: "worksheet", label: "Price Update Worksheet" },
  { key: "spreadsheet-editor", label: "Spreadsheet Editor" },
  { key: "legacy-editor", label: "Legacy Editor" },
  { key: "raw-export", label: "Raw Worksheet Export" },
  { key: "exports", label: "Data Exports" },
  { key: "inventory", label: "All Inventory" },
  { key: "calendar", label: "Price Update Calendar" },
  { key: "calculator", label: "Pricing Calculator" },
  { key: "vendors", label: "Vendor Discounts" },
  { key: "pos-cleaner", label: "POS Excel Cleaner" },
  { key: "price-99", label: "99 Price Manager" },
  { key: "adhoc-counts", label: "Ad Hoc Count Sheets" },
  { key: "settings", label: "Settings & Preferences" },
];

/**
 * Downscales very large screenshots client-side (>1920px wide) before upload so
 * screenshots remain sharp and readable without bloating transfer size.
 */
async function resizeImageIfNeeded(file: File): Promise<File> {
  if (file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxW = 1920;
    if (bitmap.width <= maxW) {
      bitmap.close();
      return file;
    }
    const scale = maxW / bitmap.width;
    const canvas = document.createElement("canvas");
    canvas.width = maxW;
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const outType = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outType, outType === "image/jpeg" ? 0.88 : undefined),
    );
    if (!blob) return file;
    return new File([blob], file.name, { type: outType });
  } catch {
    return file;
  }
}

export function HelpArticleEditor({
  article,
  categories,
  allArticles,
  revisions,
  onSaved,
  onDeleted,
  onCancel,
}: {
  article: HelpArticleDetailDTO;
  categories: HelpCategoryDTO[];
  allArticles: HelpArticleSummaryDTO[];
  revisions: HelpRevisionDTO[];
  onSaved: (updated: HelpArticleDetailDTO) => void;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();

  const [title, setTitle] = useState(article.draftTitle ?? article.title);
  const [summary, setSummary] = useState(article.draftSummary ?? article.summary);
  const [categoryId, setCategoryId] = useState(article.categoryId);
  const [blocks, setBlocks] = useState<HelpDocBlock[]>(
    article.draftBlocks?.length ? article.draftBlocks : article.blocks,
  );
  const [relatedSlugs, setRelatedSlugs] = useState<string[]>(article.relatedSlugs ?? []);
  const [contextKeys, setContextKeys] = useState<string[]>(article.contextKeys ?? []);
  const [needsReview, setNeedsReview] = useState<boolean>(article.needsReview);
  const [revisionNote, setRevisionNote] = useState("");

  const [mode, setMode] = useState<"edit" | "preview" | "history">("edit");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [uploadingBlockId, setUploadingBlockId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  // Quick inline link inserter state
  const [linkModal, setLinkModal] = useState<{
    blockId: string;
    itemIdx?: number;
    label: string;
    targetType: "article" | "url";
    articleSlug: string;
    url: string;
  } | null>(null);

  const previewToc = useMemo(() => extractToc(blocks), [blocks]);

  const updateBlock = (id: string, updater: (b: HelpDocBlock) => HelpDocBlock) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? updater(b) : b)));
  };

  const removeBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  };

  const moveBlock = (idx: number, dir: -1 | 1) => {
    setBlocks((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const addBlock = (kind: HelpDocBlock["type"] | "subheading", afterIndex?: number) => {
    const id = newBlockId();
    let created: HelpDocBlock;
    if (kind === "heading") created = { id, type: "heading", level: 2, text: "" };
    else if (kind === "subheading") created = { id, type: "heading", level: 3, text: "" };
    else if (kind === "steps") created = { id, type: "steps", items: [""] };
    else if (kind === "bullets") created = { id, type: "bullets", items: [""] };
    else if (kind === "callout") created = { id, type: "callout", variant: "tip", title: "Tip", text: "" };
    else if (kind === "table")
      created = { id, type: "table", headers: ["Column 1", "Column 2"], rows: [["", ""]] };
    else if (kind === "image")
      created = { id, type: "image", imageId: "", url: "", alt: "", caption: "" };
    else created = { id, type: "paragraph", text: "" };

    setBlocks((prev) => {
      if (afterIndex === undefined || afterIndex < 0 || afterIndex >= prev.length) {
        return [...prev, created];
      }
      const next = [...prev];
      next.splice(afterIndex + 1, 0, created);
      return next;
    });
  };

  const appendFormatting = (blockId: string, snippet: string, itemIdx?: number) => {
    updateBlock(blockId, (b) => {
      if (b.type === "paragraph") {
        const sep = b.text && !b.text.endsWith(" ") ? " " : "";
        return { ...b, text: `${b.text}${sep}${snippet}` };
      }
      if ((b.type === "steps" || b.type === "bullets") && itemIdx !== undefined) {
        const items = [...b.items];
        const cur = items[itemIdx] ?? "";
        const sep = cur && !cur.endsWith(" ") ? " " : "";
        items[itemIdx] = `${cur}${sep}${snippet}`;
        return { ...b, items };
      }
      if (b.type === "callout") {
        const sep = b.text && !b.text.endsWith(" ") ? " " : "";
        return { ...b, text: `${b.text}${sep}${snippet}` };
      }
      return b;
    });
  };

  const handleUploadImage = async (blockId: string, file: File) => {
    setUploadingBlockId(blockId);
    try {
      const prepared = await resizeImageIfNeeded(file);
      const fd = new FormData();
      fd.append("file", prepared);
      const r = await fetch("/api/help/images", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error("Image upload failed.", apiErrorText(d, "Could not upload screenshot."));
        return;
      }
      updateBlock(blockId, (b) =>
        b.type === "image"
          ? {
              ...b,
              imageId: d.image.id,
              url: d.image.url,
              alt: b.alt || prepared.name.replace(/\.[^.]+$/, ""),
            }
          : b,
      );
      toast.success("Screenshot uploaded.");
    } catch {
      toast.error("Image upload failed.", "Could not reach the server.");
    } finally {
      setUploadingBlockId(null);
    }
  };

  const handleRemoveUploadedImage = async (blockId: string, imageId: string) => {
    if (imageId) {
      await fetch(`/api/help/images/${encodeURIComponent(imageId)}`, { method: "DELETE" }).catch(() => null);
    }
    updateBlock(blockId, (b) =>
      b.type === "image" ? { ...b, imageId: "", url: "", alt: "", caption: "" } : b,
    );
  };

  const submitAction = async (action: "save-draft" | "publish" | "unpublish" | "discard-draft") => {
    if (busyAction) return;
    if ((action === "save-draft" || action === "publish") && !title.trim()) {
      toast.error("Article title is required.");
      return;
    }
    setBusyAction(action);
    try {
      const r = await fetch(`/api/help/articles/${encodeURIComponent(article.slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          categoryId,
          title: title.trim(),
          summary: summary.trim(),
          blocks,
          relatedSlugs,
          contextKeys,
          needsReview,
          revisionNote: revisionNote.trim() || undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error("Could not save changes.", apiErrorText(d, "Request failed."));
        return;
      }
      setRevisionNote("");
      if (action === "publish") {
        toast.success("Article published.", "Staff can now view the latest version in the Help Centre.");
      } else if (action === "unpublish") {
        toast.success("Article unpublished.", "This article is now hidden from regular staff.");
      } else if (action === "discard-draft") {
        toast.success("Draft changes discarded.", "Restored to the currently published version.");
      } else {
        toast.success(
          "Draft saved.",
          article.status === "PUBLISHED"
            ? "Staff continue seeing the existing published version until you click Publish Changes."
            : "Only administrators can see this draft.",
        );
      }
      onSaved(d.article as HelpArticleDetailDTO);
    } catch {
      toast.error("Could not reach the server while saving.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleRestoreRevision = async (rev: HelpRevisionDTO) => {
    if (busyAction) return;
    setBusyAction("restore");
    try {
      const r = await fetch(`/api/help/articles/${encodeURIComponent(article.slug)}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionId: rev.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error("Could not restore revision.", apiErrorText(d, "Restore failed."));
        return;
      }
      const updated = d.article as HelpArticleDetailDTO;
      setTitle(updated.draftTitle ?? updated.title);
      setSummary(updated.draftSummary ?? updated.summary);
      setBlocks(updated.draftBlocks ?? updated.blocks);
      setMode("edit");
      toast.success(`Restored version ${rev.version} into draft.`, "Review and click Publish when ready.");
      onSaved(updated);
    } catch {
      toast.error("Could not reach the server while restoring.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteArticle = async () => {
    if (busyAction) return;
    setBusyAction("delete");
    try {
      const r = await fetch(`/api/help/articles/${encodeURIComponent(article.slug)}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error("Could not delete article.", apiErrorText(d, "Delete failed."));
        return;
      }
      toast.success("Article deleted.");
      onDeleted();
    } catch {
      toast.error("Could not reach the server while deleting.");
    } finally {
      setBusyAction(null);
      setConfirmDelete(false);
    }
  };

  const otherArticles = allArticles.filter((a) => a.slug !== article.slug);

  return (
    <div className="flex flex-col gap-4">
      {/* Editor Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            ← Back to Reader
          </button>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100/80 p-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-800">
            {(
              [
                ["edit", "Edit"],
                ["preview", "Preview"],
                ["history", `History (${revisions.length})`],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
                  mode === m
                    ? "bg-white text-slate-900 shadow-2xs dark:bg-zinc-700 dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              article.status === "PUBLISHED"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                : "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
            }`}
          >
            {article.status === "PUBLISHED" ? "Published" : "Draft"}
          </span>
          {article.hasUnpublishedChanges && (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300">
              Unpublished Draft Edits
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {article.status === "PUBLISHED" && article.hasUnpublishedChanges && (
            <LoadingButton
              busy={busyAction === "discard-draft"}
              busyLabel="Restoring..."
              onClick={() => void submitAction("discard-draft")}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Discard Draft Edits
            </LoadingButton>
          )}
          {article.status === "PUBLISHED" && (
            <LoadingButton
              busy={busyAction === "unpublish"}
              busyLabel="Unpublishing..."
              onClick={() => void submitAction("unpublish")}
              className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
            >
              Unpublish
            </LoadingButton>
          )}
          <LoadingButton
            busy={busyAction === "save-draft"}
            busyLabel="Saving..."
            onClick={() => void submitAction("save-draft")}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            Save Draft
          </LoadingButton>
          <LoadingButton
            busy={busyAction === "publish"}
            busyLabel="Publishing..."
            onClick={() => void submitAction("publish")}
            className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700"
          >
            {article.status === "PUBLISHED" ? "Publish Changes" : "Publish Article"}
          </LoadingButton>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            Delete
          </button>
        </div>
      </div>

      {/* PREVIEW MODE */}
      {mode === "preview" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 lg:col-span-3">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
              Preview — How staff will see this article once published
            </div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              {title || "Untitled Article"}
            </h1>
            {summary && (
              <p className="mt-2 text-sm text-slate-500 dark:text-zinc-400">{summary}</p>
            )}
            <hr className="my-5 border-slate-200 dark:border-zinc-800" />
            <HelpDocRenderer blocks={blocks} />
          </div>
          <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 h-fit">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
              Table of Contents Preview
            </div>
            {previewToc.length === 0 ? (
              <p className="mt-2 text-xs text-slate-400">Add Heading blocks to build a Table of Contents.</p>
            ) : (
              <ul className="mt-2.5 space-y-1.5 text-xs">
                {previewToc.map((t) => (
                  <li key={t.id} className={t.level === 3 ? "pl-3" : ""}>
                    <a href={`#${t.anchor}`} className="text-slate-600 hover:text-indigo-600 dark:text-zinc-300 dark:hover:text-indigo-400">
                      {t.text}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}

      {/* REVISION HISTORY MODE */}
      {mode === "history" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Revision History</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
            Recover any earlier version into your draft editor without immediately changing what staff see.
          </p>
          <div className="mt-4 divide-y divide-slate-100 dark:divide-zinc-800">
            {revisions.length === 0 && (
              <p className="py-6 text-center text-xs text-slate-400">No saved revisions yet.</p>
            )}
            {revisions.map((rev) => (
              <div key={rev.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-700 dark:bg-zinc-800 dark:text-zinc-200">
                      v{rev.version}
                    </span>
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{rev.title}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {rev.eventType}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">
                    {rev.note || "Saved"} · {rev.editorEmail || "System"} · {new Date(rev.createdAt).toLocaleString()}
                  </p>
                </div>
                <LoadingButton
                  busy={busyAction === "restore"}
                  busyLabel="Restoring..."
                  onClick={() => void handleRestoreRevision(rev)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  Restore to Draft
                </LoadingButton>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VISUAL BLOCK EDITOR MODE */}
      {mode === "edit" && (
        <div className="flex flex-col gap-4">
          {/* Core Article Details Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="flex flex-col gap-1 md:col-span-2">
                <span className="text-xs font-bold text-slate-700 dark:text-zinc-300">Article Title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Creating a New Price Update"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700 dark:text-zinc-300">Category</span>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 md:col-span-3">
                <span className="text-xs font-bold text-slate-700 dark:text-zinc-300">Short Summary</span>
                <input
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="One-sentence description shown in search results and category lists"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setShowMeta((v) => !v)}
                className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
              >
                {showMeta ? "Hide Related Articles & Contextual Help Settings ▲" : "Configure Related Articles & Contextual Help Links ▼"}
              </button>
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={needsReview}
                  onChange={(e) => setNeedsReview(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600"
                />
                <span>Flagged for admin review</span>
              </label>
            </div>

            {showMeta && (
              <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 dark:border-zinc-800 md:grid-cols-2">
                <div>
                  <div className="text-xs font-bold text-slate-700 dark:text-zinc-300">Related Articles</div>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-zinc-400">
                    Choose helpful follow-up guides shown at the bottom of this article.
                  </p>
                  <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-zinc-700">
                    {otherArticles.map((a) => {
                      const checked = relatedSlugs.includes(a.slug);
                      return (
                        <label key={a.slug} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50 dark:hover:bg-zinc-800">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setRelatedSlugs((prev) =>
                                checked ? prev.filter((s) => s !== a.slug) : [...prev, a.slug],
                              )
                            }
                            className="rounded border-slate-300 text-indigo-600"
                          />
                          <span className="truncate">{a.title}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-700 dark:text-zinc-300">Show in Contextual Help On Pages</div>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-zinc-400">
                    Link this article to the subtle Help (?) buttons across the app.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {CONTEXT_KEY_OPTIONS.map((opt) => {
                      const active = contextKeys.includes(opt.key);
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() =>
                            setContextKeys((prev) =>
                              active ? prev.filter((k) => k !== opt.key) : [...prev, opt.key],
                            )
                          }
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                            active
                              ? "border-indigo-500 bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <label className="mt-3 flex flex-col gap-1">
                    <span className="text-xs font-bold text-slate-700 dark:text-zinc-300">Revision Note (Optional)</span>
                    <input
                      value={revisionNote}
                      onChange={(e) => setRevisionNote(e.target.value)}
                      placeholder="e.g., Added worksheet screenshot and clarified steps"
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Add Content Block Toolbar */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/90 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/90">
            <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
              Add Block:
            </span>
            {(
              [
                ["heading", "+ Heading (TOC)"],
                ["subheading", "+ Subheading"],
                ["paragraph", "+ Paragraph"],
                ["steps", "+ Numbered Steps"],
                ["bullets", "+ Bullet List"],
                ["callout", "+ Note / Tip / Warning"],
                ["table", "+ Table"],
                ["image", "+ Screenshot / Image"],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                onClick={() => addBlock(kind)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:border-indigo-400 hover:text-indigo-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:border-indigo-500"
              >
                {label}
              </button>
            ))}
          </div>

          {/* Visual Blocks List */}
          <div className="flex flex-col gap-3">
            {blocks.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500 dark:border-zinc-700">
                No content blocks yet. Use the toolbar above to add headings, steps, tables, or screenshots.
              </div>
            )}
            {blocks.map((block, idx) => (
              <div
                key={block.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-zinc-800 dark:bg-zinc-900"
              >
                {/* Block Header Controls */}
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 dark:border-zinc-800">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                    {block.type === "heading"
                      ? block.level === 2
                        ? "Section Heading (In Table of Contents)"
                        : "Subheading (In Table of Contents)"
                      : block.type === "paragraph"
                        ? "Paragraph"
                        : block.type === "steps"
                          ? "Numbered Instructions"
                          : block.type === "bullets"
                            ? "Bullet List"
                            : block.type === "callout"
                              ? "Callout Box"
                              : block.type === "table"
                                ? "Table"
                                : "Screenshot / Image"}
                  </span>
                  <div className="flex items-center gap-1 text-xs">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveBlock(idx, -1)}
                      title="Move up"
                      className="rounded border border-slate-200 px-1.5 py-0.5 text-slate-600 hover:bg-slate-50 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-300"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={idx === blocks.length - 1}
                      onClick={() => moveBlock(idx, 1)}
                      title="Move down"
                      className="rounded border border-slate-200 px-1.5 py-0.5 text-slate-600 hover:bg-slate-50 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-300"
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBlock(block.id)}
                      title="Remove block"
                      className="rounded border border-red-200 px-2 py-0.5 text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {/* HEADING BLOCK */}
                {block.type === "heading" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={block.level}
                      onChange={(e) =>
                        updateBlock(block.id, (b) =>
                          b.type === "heading" ? { ...b, level: Number(e.target.value) === 3 ? 3 : 2 } : b,
                        )
                      }
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-semibold dark:border-zinc-700 dark:bg-zinc-800"
                    >
                      <option value={2}>Heading (H2)</option>
                      <option value={3}>Subheading (H3)</option>
                    </select>
                    <input
                      value={block.text}
                      onChange={(e) =>
                        updateBlock(block.id, (b) => (b.type === "heading" ? { ...b, text: e.target.value } : b))
                      }
                      placeholder="Enter section heading..."
                      className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-bold text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                  </div>
                )}

                {/* PARAGRAPH BLOCK */}
                {block.type === "paragraph" && (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick={() => appendFormatting(block.id, "**bold text**")}
                        className="rounded border border-slate-200 px-2 py-0.5 text-xs font-bold hover:bg-slate-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        Bold
                      </button>
                      <button
                        type="button"
                        onClick={() => appendFormatting(block.id, "*italic text*")}
                        className="rounded border border-slate-200 px-2 py-0.5 text-xs italic hover:bg-slate-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        Italic
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setLinkModal({
                            blockId: block.id,
                            label: "",
                            targetType: "article",
                            articleSlug: otherArticles[0]?.slug ?? "",
                            url: "https://",
                          })
                        }
                        className="rounded border border-slate-200 px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:border-zinc-700 dark:text-indigo-400 dark:hover:bg-zinc-800"
                      >
                        + Insert Link / Article Link
                      </button>
                    </div>
                    <textarea
                      rows={3}
                      value={block.text}
                      onChange={(e) =>
                        updateBlock(block.id, (b) => (b.type === "paragraph" ? { ...b, text: e.target.value } : b))
                      }
                      placeholder="Write clear, staff-friendly instructions..."
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                  </div>
                )}

                {/* STEPS / BULLETS BLOCK */}
                {(block.type === "steps" || block.type === "bullets") && (
                  <div className="flex flex-col gap-2">
                    {block.items.map((item, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="mt-1.5 w-6 shrink-0 text-center text-xs font-bold text-slate-400">
                          {block.type === "steps" ? `${i + 1}.` : "•"}
                        </span>
                        <input
                          value={item}
                          onChange={(e) =>
                            updateBlock(block.id, (b) => {
                              if (b.type !== "steps" && b.type !== "bullets") return b;
                              const next = [...b.items];
                              next[i] = e.target.value;
                              return { ...b, items: next };
                            })
                          }
                          placeholder={block.type === "steps" ? `Step ${i + 1} instruction...` : "List item..."}
                          className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setLinkModal({
                              blockId: block.id,
                              itemIdx: i,
                              label: "",
                              targetType: "article",
                              articleSlug: otherArticles[0]?.slug ?? "",
                              url: "https://",
                            })
                          }
                          title="Insert article or web link"
                          className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 dark:border-zinc-700 dark:text-indigo-400"
                        >
                          Link
                        </button>
                        <button
                          type="button"
                          disabled={block.items.length <= 1}
                          onClick={() =>
                            updateBlock(block.id, (b) =>
                              b.type === "steps" || b.type === "bullets"
                                ? { ...b, items: b.items.filter((_, idx2) => idx2 !== i) }
                                : b,
                            )
                          }
                          className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:text-red-600 disabled:opacity-30 dark:border-zinc-700"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        updateBlock(block.id, (b) =>
                          b.type === "steps" || b.type === "bullets" ? { ...b, items: [...b.items, ""] } : b,
                        )
                      }
                      className="self-start rounded-lg border border-dashed border-slate-300 px-3 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50/50 dark:border-zinc-700 dark:text-indigo-400"
                    >
                      + Add {block.type === "steps" ? "Step" : "Bullet"}
                    </button>
                  </div>
                )}

                {/* CALLOUT BLOCK */}
                {block.type === "callout" && (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={block.variant}
                        onChange={(e) =>
                          updateBlock(block.id, (b) =>
                            b.type === "callout"
                              ? { ...b, variant: e.target.value as HelpCalloutVariant }
                              : b,
                          )
                        }
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold dark:border-zinc-700 dark:bg-zinc-800"
                      >
                        <option value="note">Note (Blue)</option>
                        <option value="tip">Tip (Green)</option>
                        <option value="warning">Warning (Amber)</option>
                      </select>
                      <input
                        value={block.title}
                        onChange={(e) =>
                          updateBlock(block.id, (b) => (b.type === "callout" ? { ...b, title: e.target.value } : b))
                        }
                        placeholder="Callout heading..."
                        className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                      />
                    </div>
                    <textarea
                      rows={2}
                      value={block.text}
                      onChange={(e) =>
                        updateBlock(block.id, (b) => (b.type === "callout" ? { ...b, text: e.target.value } : b))
                      }
                      placeholder="Callout details..."
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                  </div>
                )}

                {/* TABLE BLOCK */}
                {block.type === "table" && (
                  <div className="flex flex-col gap-2 overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr>
                          {block.headers.map((h, cIdx) => (
                            <th key={cIdx} className="p-1">
                              <input
                                value={h}
                                onChange={(e) =>
                                  updateBlock(block.id, (b) => {
                                    if (b.type !== "table") return b;
                                    const headers = [...b.headers];
                                    headers[cIdx] = e.target.value;
                                    return { ...b, headers };
                                  })
                                }
                                placeholder={`Header ${cIdx + 1}`}
                                className="w-full rounded border border-slate-300 bg-slate-50 px-2 py-1 font-bold dark:border-zinc-700 dark:bg-zinc-800"
                              />
                            </th>
                          ))}
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {block.rows.map((row, rIdx) => (
                          <tr key={rIdx}>
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className="p-1">
                                <input
                                  value={cell}
                                  onChange={(e) =>
                                    updateBlock(block.id, (b) => {
                                      if (b.type !== "table") return b;
                                      const rows = b.rows.map((r) => [...r]);
                                      rows[rIdx][cIdx] = e.target.value;
                                      return { ...b, rows };
                                    })
                                  }
                                  className="w-full rounded border border-slate-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                                />
                              </td>
                            ))}
                            <td className="p-1 text-center">
                              <button
                                type="button"
                                onClick={() =>
                                  updateBlock(block.id, (b) =>
                                    b.type === "table"
                                      ? { ...b, rows: b.rows.filter((_, idx2) => idx2 !== rIdx) }
                                      : b,
                                  )
                                }
                                className="text-slate-400 hover:text-red-600"
                                title="Remove row"
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          updateBlock(block.id, (b) =>
                            b.type === "table"
                              ? { ...b, rows: [...b.rows, b.headers.map(() => "")] }
                              : b,
                          )
                        }
                        className="rounded border border-dashed border-slate-300 px-2.5 py-1 text-xs font-semibold text-indigo-600 dark:border-zinc-700 dark:text-indigo-400"
                      >
                        + Add Row
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateBlock(block.id, (b) =>
                            b.type === "table"
                              ? {
                                  ...b,
                                  headers: [...b.headers, `Column ${b.headers.length + 1}`],
                                  rows: b.rows.map((r) => [...r, ""]),
                                }
                              : b,
                          )
                        }
                        className="rounded border border-dashed border-slate-300 px-2.5 py-1 text-xs font-semibold text-indigo-600 dark:border-zinc-700 dark:text-indigo-400"
                      >
                        + Add Column
                      </button>
                      {block.headers.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            updateBlock(block.id, (b) =>
                              b.type === "table"
                                ? {
                                    ...b,
                                    headers: b.headers.slice(0, -1),
                                    rows: b.rows.map((r) => r.slice(0, -1)),
                                  }
                                : b,
                            )
                          }
                          className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:text-red-600 dark:border-zinc-700"
                        >
                          Remove Last Column
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* IMAGE / SCREENSHOT BLOCK */}
                {block.type === "image" && (
                  <div className="flex flex-col gap-3">
                    {block.url ? (
                      <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/40">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={block.url}
                          alt={block.alt || "Uploaded screenshot"}
                          className="max-h-72 w-auto max-w-full rounded border border-slate-200 object-contain dark:border-zinc-700"
                        />
                        <button
                          type="button"
                          onClick={() => void handleRemoveUploadedImage(block.id, block.imageId)}
                          className="rounded border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:bg-zinc-900 dark:text-red-400"
                        >
                          Remove Screenshot
                        </button>
                      </div>
                    ) : (
                      <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/50 p-6 text-center hover:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800/30">
                        <span className="text-xs font-bold text-slate-700 dark:text-zinc-200">
                          {uploadingBlockId === block.id
                            ? "Uploading screenshot..."
                            : "Click to upload a screenshot (PNG, JPG, WebP, GIF — max 5 MB)"}
                        </span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          disabled={uploadingBlockId === block.id}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleUploadImage(block.id, f);
                          }}
                          className="hidden"
                        />
                      </label>
                    )}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input
                        value={block.caption}
                        onChange={(e) =>
                          updateBlock(block.id, (b) => (b.type === "image" ? { ...b, caption: e.target.value } : b))
                        }
                        placeholder="Caption shown below the screenshot (optional)"
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                      />
                      <input
                        value={block.alt}
                        onChange={(e) =>
                          updateBlock(block.id, (b) => (b.type === "image" ? { ...b, alt: e.target.value } : b))
                        }
                        placeholder="Alt description for accessibility"
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insert Link / Article Link Modal */}
      {linkModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Insert Link"
          onClick={() => setLinkModal(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Insert Link</h3>
            <div className="mt-3 flex flex-col gap-3 text-xs">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setLinkModal({ ...linkModal, targetType: "article" })}
                  className={`flex-1 rounded-lg border py-1.5 font-semibold ${
                    linkModal.targetType === "article"
                      ? "border-indigo-500 bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                      : "border-slate-200 dark:border-zinc-700"
                  }`}
                >
                  Help Centre Article
                </button>
                <button
                  type="button"
                  onClick={() => setLinkModal({ ...linkModal, targetType: "url" })}
                  className={`flex-1 rounded-lg border py-1.5 font-semibold ${
                    linkModal.targetType === "url"
                      ? "border-indigo-500 bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                      : "border-slate-200 dark:border-zinc-700"
                  }`}
                >
                  Web URL
                </button>
              </div>
              {linkModal.targetType === "article" ? (
                <label className="flex flex-col gap-1">
                  <span className="font-semibold">Target Article</span>
                  <select
                    value={linkModal.articleSlug}
                    onChange={(e) => setLinkModal({ ...linkModal, articleSlug: e.target.value })}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                  >
                    {otherArticles.map((a) => (
                      <option key={a.slug} value={a.slug}>
                        {a.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="flex flex-col gap-1">
                  <span className="font-semibold">URL</span>
                  <input
                    value={linkModal.url}
                    onChange={(e) => setLinkModal({ ...linkModal, url: e.target.value })}
                    placeholder="https://..."
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                  />
                </label>
              )}
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Link Text</span>
                <input
                  value={linkModal.label}
                  onChange={(e) => setLinkModal({ ...linkModal, label: e.target.value })}
                  placeholder="Optional display text (defaults to article title)"
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLinkModal(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium dark:border-zinc-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const target =
                    linkModal.targetType === "article"
                      ? `/help/${linkModal.articleSlug}`
                      : linkModal.url.trim();
                  const fallbackLabel =
                    linkModal.targetType === "article"
                      ? otherArticles.find((a) => a.slug === linkModal.articleSlug)?.title ?? "Article"
                      : target;
                  const lbl = linkModal.label.trim() || fallbackLabel;
                  if (target) {
                    appendFormatting(linkModal.blockId, `[${lbl}](${target})`, linkModal.itemIdx);
                  }
                  setLinkModal(null);
                }}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
              >
                Insert Link
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Article Confirmation Modal */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm delete article"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Delete this article?</h2>
            <p className="mt-2 text-xs text-slate-600 dark:text-zinc-400">
              This will permanently remove <strong className="text-slate-900 dark:text-white">{title}</strong> and its revision history from the Help Centre. This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={busyAction === "delete"}
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium dark:border-zinc-700"
              >
                Cancel
              </button>
              <LoadingButton
                busy={busyAction === "delete"}
                busyLabel="Deleting..."
                onClick={() => void handleDeleteArticle()}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
              >
                Delete Permanently
              </LoadingButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
