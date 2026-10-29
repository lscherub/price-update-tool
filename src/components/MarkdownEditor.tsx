"use client";

import { useEffect, useRef, useState } from "react";
import { LoadingButton } from "./LoadingButton";
import { renderMarkdown } from "@/lib/markdown";

/**
 * Shared Markdown editing UI for product Notes and Price Sheet Notes.
 *
 * - `MarkdownEditor`: textarea + toolbar + Write/Preview tabs. Stateless
 *   except for the tab toggle; the parent owns the draft text.
 * - `MarkdownDoc`: read-only rendered view used in table cells, the sheet
 *   section, and previews. All HTML comes from the internal renderer (which
 *   escapes content first), so it is safe to inject.
 * - `NotesModal`: popup dialog with editor, preview, Save/Close + Cancel.
 *   Saving only ever calls the parent's `onSave` with the raw markdown —
 *   persistence still goes through the existing Notes/session-notes PATCH
 *   paths, so storage is unchanged.
 */

export function MarkdownDoc({ source, compact = false }: { source: string; compact?: boolean }) {
  const html = renderMarkdown(source);
  if (!source.trim()) return <span className="text-slate-300">—</span>;
  return (
    <div
      className={`md-doc ${compact ? "md-doc-compact" : ""}`}
      // Safe: renderMarkdown escapes all content before adding markup.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function wrapSelection(
  ta: HTMLTextAreaElement | null,
  before: string,
  after: string,
  placeholder: string,
  onChange: (v: string) => void,
) {
  if (!ta) return;
  const v = ta.value;
  const s = ta.selectionStart ?? v.length;
  const e = ta.selectionEnd ?? v.length;
  const sel = v.slice(s, e) || placeholder;
  const next = `${v.slice(0, s)}${before}${sel}${after}${v.slice(e)}`;
  onChange(next);
  requestAnimationFrame(() => {
    ta.focus();
    const pos = s + before.length + sel.length + after.length;
    ta.setSelectionRange(pos, pos);
  });
}

export function MarkdownEditor({ value, onChange, minHeight = 220 }: {
  value: string;
  onChange: (v: string) => void;
  minHeight?: number;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const btn = "rounded border border-slate-200 dark:border-zinc-700 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors";
  const tool = (label: React.ReactNode, title: string, before: string, after: string, placeholder: string) => (
    <button
      key={title}
      type="button"
      title={title}
      aria-label={title}
      className={btn}
      onClick={() => wrapSelection(taRef.current, before, after, placeholder, onChange)}
    >
      {label}
    </button>
  );

  const insertLines = (prefix: (i: number) => string, placeholder: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const v = ta.value;
    const s = ta.selectionStart ?? 0;
    const e = ta.selectionEnd ?? 0;
    const lineStart = v.lastIndexOf("\n", s - 1) + 1;
    const lineEnd = v.indexOf("\n", e);
    const end = lineEnd < 0 ? v.length : lineEnd;
    const chunk = v.slice(lineStart, end) || placeholder;
    const next = chunk.split("\n").map((l, i) => `${prefix(i)}${l}`).join("\n");
    onChange(`${v.slice(0, lineStart)}${next}${v.slice(end)}`);
    requestAnimationFrame(() => ta.focus());
  };

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-1">
        {tool("B", "Bold", "**", "**", "bold text")}
        {tool("I", "Italic", "*", "*", "italic text")}
        {tool("H", "Heading", "## ", "", "Heading")}
        {tool("•", "Bulleted list", "- ", "", "list item")}
        <button
          type="button" title="Numbered list" aria-label="Numbered list" className={btn}
          onClick={() => insertLines((i) => `${i + 1}. `, "list item")}
        >
          1.
        </button>
        {tool(
          <span className="inline-flex items-center gap-1">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span>Link</span>
          </span>,
          "Link", "[", "](https://)", "link text"
        )}
        <button
          type="button" title="Insert table" aria-label="Insert table" className={btn}
          onClick={() => onChange(
            `${value}${value.endsWith("\n") || !value ? "" : "\n"}\n| Column A | Column B |\n| -------- | -------: |\n| Item 1   |   $0.00  |\n`,
          )}
        >
          <span className="inline-flex items-center gap-1">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18m-9-4v8m-7 4h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span>Table</span>
          </span>
        </button>
        <span className="ml-auto flex gap-1">
          <button
            type="button" className={`rounded px-2.5 py-0.5 text-xs font-semibold transition-colors ${tab === "write" ? "bg-slate-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800"}`}
            onClick={() => setTab("write")}
          >
            Write
          </button>
          <button
            type="button" className={`rounded px-2.5 py-0.5 text-xs font-semibold transition-colors ${tab === "preview" ? "bg-slate-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800"}`}
            onClick={() => setTab("preview")}
          >
            Preview
          </button>
        </span>
      </div>
      {tab === "write" ? (
        <textarea
          ref={taRef}
          className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 font-mono text-xs text-slate-900 dark:text-zinc-100 focus:border-indigo-500 focus:outline-none"
          style={{ minHeight }}
          value={value}
          placeholder={"Write notes in Markdown…\n\n**Bold**, *italic*, ## headings, - lists, [links](https://…), | tables |"}
          aria-label="Notes markdown editor"
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="w-full overflow-auto rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900/50 px-3 py-2 text-slate-900 dark:text-zinc-100" style={{ minHeight }}>
          {value.trim() ? <MarkdownDoc source={value} /> : <span className="text-xs text-slate-400 dark:text-zinc-500">Nothing to preview yet.</span>}
        </div>
      )}
    </div>
  );
}

export function NotesModal({ title, subtitle, initial, busy, saveLabel = "Save", onSave, onClose }: {
  title: string;
  subtitle?: string;
  initial: string;
  busy: boolean;
  saveLabel?: string;
  onSave: (v: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);

  // Re-seed when a different row/note is opened while the modal stays mounted.
  useEffect(() => { setDraft(initial); }, [initial]);

  // Close on Escape (but not while a save is in flight).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-5 shadow-xl text-slate-900 dark:text-zinc-100">
        <h2 className="text-lg font-bold">{title}</h2>
        {subtitle && <p className="mt-1 text-xs text-slate-600 dark:text-zinc-400">{subtitle}</p>}
        <div className="mt-3 min-h-0 flex-1 overflow-auto">
          <MarkdownEditor value={draft} onChange={setDraft} minHeight={260} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded-lg border border-slate-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-60 transition-colors" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <LoadingButton
            busy={busy}
            busyLabel="Saving..."
            onClick={() => onSave(draft)}
            className="rounded-lg bg-slate-900 dark:bg-zinc-100 px-3.5 py-1.5 text-xs font-semibold text-white dark:text-zinc-900 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-60 transition-colors"
          >
            {saveLabel}
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}
