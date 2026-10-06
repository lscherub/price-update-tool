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

  const btn = "rounded border px-2 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-100";
  const tool = (label: string, title: string, before: string, after: string, placeholder: string) => (
    <button
      key={label}
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
      <div className="mb-1 flex flex-wrap items-center gap-1">
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
        {tool("🔗", "Link", "[", "](https://)", "link text")}
        <button
          type="button" title="Insert table" aria-label="Insert table" className={btn}
          onClick={() => onChange(
            `${value}${value.endsWith("\n") || !value ? "" : "\n"}\n| Column A | Column B |\n| -------- | -------: |\n| Item 1   |   $0.00  |\n`,
          )}
        >
          ⊞
        </button>
        <span className="ml-auto flex gap-1">
          <button
            type="button" className={`rounded px-2 py-0.5 text-xs font-semibold ${tab === "write" ? "bg-slate-900 text-white" : "border text-slate-600"}`}
            onClick={() => setTab("write")}
          >
            Write
          </button>
          <button
            type="button" className={`rounded px-2 py-0.5 text-xs font-semibold ${tab === "preview" ? "bg-slate-900 text-white" : "border text-slate-600"}`}
            onClick={() => setTab("preview")}
          >
            Preview
          </button>
        </span>
      </div>
      {tab === "write" ? (
        <textarea
          ref={taRef}
          className="w-full rounded border px-3 py-2 font-mono text-sm"
          style={{ minHeight }}
          value={value}
          placeholder={"Write notes in Markdown…\n\n**Bold**, *italic*, ## headings, - lists, [links](https://…), | tables |"}
          aria-label="Notes markdown editor"
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="w-full overflow-auto rounded border bg-slate-50 px-3 py-2" style={{ minHeight }}>
          {value.trim() ? <MarkdownDoc source={value} /> : <span className="text-sm text-slate-400">Nothing to preview yet.</span>}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-bold">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
        <div className="mt-3 min-h-0 flex-1 overflow-auto">
          <MarkdownEditor value={draft} onChange={setDraft} minHeight={260} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5 text-sm disabled:opacity-60" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <LoadingButton
            busy={busy}
            busyLabel="Saving..."
            onClick={() => onSave(draft)}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saveLabel}
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}
