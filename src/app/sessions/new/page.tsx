"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { apiErrorText } from "@/lib/apiError";
import { formatUpdateName } from "@/lib/pricing";
import { LoadingButton } from "@/components/LoadingButton";
import { useToast } from "@/components/Toast";
import { VendorCombobox } from "@/components/VendorCombobox";
import { useUiMode } from "@/contexts/UiModeContext";

export default function NewSessionPage() {
  const router = useRouter();
  const toast = useToast();
  const { mode } = useUiMode();
  const [vendor, setVendor] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState("");
  const [stage, setStage] = useState<"idle" | "creating" | "importing" | "redirecting">("idle");
  const [inputTab, setInputTab] = useState<"file" | "paste">("file");
  const busy = stage !== "idle";

  // The update name is generated from the vendor + today's date, and shown as
  // read-only information. The backend generates the same value regardless.
  const updateName = useMemo(() => formatUpdateName(vendor), [vendor]);

  const submit = async () => {
    if (busy) return;
    if (!vendor.trim()) { setMsg("Select or type a vendor first."); return; }
    if (!file && !text.trim()) { setMsg("Upload a file or paste vendor data first."); return; }

    setMsg("");
    setStage("creating");
    toast.info(`Creating price update for ${vendor.trim()}...`);
    let id = "";
    try {
      const r = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // name omitted on purpose — the API derives it from vendor + date.
        body: JSON.stringify({ vendor: vendor.trim(), notes: "" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setStage("idle");
        const text2 = apiErrorText(d, "Could not create the price update.");
        setMsg(text2);
        toast.error("Could not create the price update.", text2);
        return;
      }
      id = d.session.id;
      setStage("importing");

      const hasText = text.trim().length > 0;
      if (!hasText && !file) {
        // Nothing to import: still land the user on the new session.
        setStage("redirecting");
        toast.success("Price update created.");
        router.push(`/sessions/${id}`);
        router.refresh();
        return;
      }

      setStage("importing");
      let r2: Response;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        r2 = await fetch(`/api/sessions/${id}/import`, { method: "POST", body: fd });
      } else {
        r2 = await fetch(`/api/sessions/${id}/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      }
      const d2 = await r2.json().catch(() => ({}));
      if (!r2.ok) {
        setStage("idle");
        const t = `Import failed: ${apiErrorText(d2, "unknown error")} The price update was created empty — retry the import from its page.`;
        setMsg(t);
        toast.error("Vendor price import failed.", apiErrorText(d2, "unknown error"));
        return;
      }
      setStage("redirecting");
      toast.success("Price update created.", `${d2.imported} rows — ${d2.matched} matched, ${d2.unmatched} unmatched.`);
      // Navigate straight to the new session so the user lands where the
      // results are, without a manual navigation click.
      router.push(`/sessions/${id}`);
      router.refresh();
    } catch {
      setStage("idle");
      setMsg("Could not reach the server. Check your connection and try again.");
      toast.error("Could not reach the server.", "Check your connection and try again.");
    }
  };

  const busyLabel =
    stage === "creating" ? "Creating price update..."
    : stage === "importing" ? "Importing vendor prices..."
    : "Opening price update...";

  // ==========================================
  // CLASSIC UI MODE (Preserved pixel-perfect)
  // ==========================================
  if (mode === "classic") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <h1 className="text-2xl font-bold">New Price Update</h1>
        <div className="flex flex-col gap-3 rounded-xl border bg-white p-4">
          <label className="flex flex-col gap-1 text-sm" htmlFor="vendor-input">
            Vendor
            <VendorCombobox id="vendor-input" value={vendor} onChange={(v) => { setVendor(v); setMsg(""); }} disabled={busy} />
          </label>

          <div className="flex flex-col gap-1 text-sm">
            <span className="text-slate-500">Update name (generated automatically)</span>
            <div className="rounded border border-dashed bg-slate-50 px-3 py-2 font-medium text-slate-700">
              {vendor.trim() ? updateName : <span className="font-normal text-slate-400">Select a vendor to generate the name</span>}
            </div>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Import Vendor Prices — upload Excel/CSV (optional)
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={busy}
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setMsg(""); }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor="paste-area">
            or Paste Vendor Data (SKU + price per line)
            <textarea
              id="paste-area"
              className="min-h-40 rounded border px-3 py-2 font-mono text-xs disabled:opacity-60"
              value={text}
              disabled={busy}
              onChange={(e) => { setText(e.target.value); setMsg(""); }}
              placeholder={"0 58854 04522 7\t19.99\n624-917-74008-0, 24.50"}
            />
          </label>
          <LoadingButton busy={busy} busyLabel={busyLabel} stableWidth onClick={submit}>
            Process Price Update
          </LoadingButton>
          {msg && <div className="text-sm text-slate-600" role="status">{msg}</div>}
        </div>
      </div>
    );
  }

  // ==========================================
  // NEW UI MODE (Modern stepped layout)
  // ==========================================
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
          Create New Price Update
        </h1>
        <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
          Match incoming vendor cost changes against your master inventory and generate a working price sheet.
        </p>
      </div>

      {/* Alternative Full Vendor Callout */}
      <div className="flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50/50 p-3.5 text-xs text-violet-900 dark:border-violet-900/60 dark:bg-violet-950/20 dark:text-violet-300">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          <span>Need to update all catalog products for a specific vendor?</span>
        </div>
        <Link
          href="/fullvendor/new"
          className="font-bold underline hover:text-violet-950 dark:hover:text-white"
        >
          Use Full Vendor Price Update →
        </Link>
      </div>

      {/* Main Workflow Form Card */}
      <div className="flex flex-col gap-5 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        {/* Step 1: Choose Vendor */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400" htmlFor="vendor-input">
            1. Select Vendor
          </label>
          <VendorCombobox
            id="vendor-input"
            value={vendor}
            onChange={(v) => { setVendor(v); setMsg(""); }}
            disabled={busy}
          />

          <div className="mt-1 flex items-center justify-between rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-800/50">
            <span className="text-slate-500 dark:text-zinc-400">Generated Worksheet Name:</span>
            <span className="font-bold text-slate-800 dark:text-zinc-200">
              {vendor.trim() ? updateName : "Select vendor above"}
            </span>
          </div>
        </div>

        {/* Step 2: Choose Data Source (File vs Paste) */}
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
              2. Vendor Price Data
            </span>

            {/* Source Segmented Control */}
            <div className="flex rounded-lg border border-slate-200 bg-slate-100/70 p-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-800">
              <button
                type="button"
                onClick={() => setInputTab("file")}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  inputTab === "file"
                    ? "bg-white text-slate-900 shadow-2xs dark:bg-zinc-700 dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-zinc-400"
                }`}
              >
                Upload Spreadsheet
              </button>
              <button
                type="button"
                onClick={() => setInputTab("paste")}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  inputTab === "paste"
                    ? "bg-white text-slate-900 shadow-2xs dark:bg-zinc-700 dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-zinc-400"
                }`}
              >
                Paste Text
              </button>
            </div>
          </div>

          {inputTab === "file" ? (
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 p-6 text-center dark:border-zinc-700 dark:bg-zinc-800/20">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <span className="mt-2 text-xs font-bold text-slate-800 dark:text-zinc-200">
                Choose vendor price spreadsheet (Excel or CSV)
              </span>
              <p className="mt-1 text-[11px] text-slate-400">
                Supports .xlsx, .xls, and .csv files with SKU and new cost/price columns
              </p>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                disabled={busy}
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setMsg(""); }}
                className="mt-3 block text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-800 dark:file:bg-white dark:file:text-slate-900"
              />
              {file && (
                <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Selected: {file.name}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="paste-area-new" className="text-xs text-slate-500">
                Paste tab-separated or comma-separated vendor SKU and price (one per line):
              </label>
              <textarea
                id="paste-area-new"
                className="h-44 w-full rounded-xl border border-slate-200 bg-slate-50/50 p-3 font-mono text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                value={text}
                disabled={busy}
                onChange={(e) => { setText(e.target.value); setMsg(""); }}
                placeholder={"0 58854 04522 7\t19.99\n624-917-74008-0, 24.50"}
              />
            </div>
          )}
        </div>

        {msg && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            {msg}
          </div>
        )}

        {/* Submit Button */}
        <div className="border-t border-slate-100 pt-4 dark:border-zinc-800">
          <LoadingButton
            busy={busy}
            busyLabel={busyLabel}
            stableWidth
            onClick={submit}
            className="w-full rounded-xl py-2.5 text-xs font-bold text-white shadow-xs hover:opacity-95"
            style={{ background: "var(--accent-primary, #4f46e5)" }}
          >
            Process Price Update & Open Worksheet →
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}
