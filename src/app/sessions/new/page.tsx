"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { apiErrorText } from "@/lib/apiError";
import { formatUpdateName } from "@/lib/pricing";
import { LoadingButton } from "@/components/LoadingButton";
import { useToast } from "@/components/Toast";
import { VendorCombobox } from "@/components/VendorCombobox";

export default function NewSessionPage() {
  const router = useRouter();
  const toast = useToast();
  const [vendor, setVendor] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState("");
  const [stage, setStage] = useState<"idle" | "creating" | "importing" | "redirecting">("idle");
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
