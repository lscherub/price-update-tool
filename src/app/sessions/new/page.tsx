"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewSessionPage() {
  const router = useRouter();
  const [vendor, setVendor] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) { setMsg("Update name is required"); return; }
    setBusy(true); setMsg("Creating session...");
    const r = await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendor, name, notes: "" }) });
    const d = await r.json();
    if (!r.ok) { setMsg(d.error ?? "Failed"); setBusy(false); return; }
    const id = d.session.id;
    const hasText = text.trim().length > 0;
    if (!hasText && !file) { router.push(`/sessions/${id}`); return; }
    setMsg("Processing vendor prices (server-side batch)...");
    let r2: Response;
    if (file) {
      const fd = new FormData();
      fd.append("file", file);
      r2 = await fetch(`/api/sessions/${id}/import`, { method: "POST", body: fd });
    } else {
      r2 = await fetch(`/api/sessions/${id}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    }
    const d2 = await r2.json();
    setBusy(false);
    if (!r2.ok) { setMsg(`Error: ${d2.error}`); return; }
    setMsg(`${d2.imported} rows imported — ${d2.matched} matched, ${d2.unmatched} unmatched.`);
    setTimeout(() => router.push(`/sessions/${id}`), 800);
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold">New Price Update</h1>
      <div className="flex flex-col gap-3 rounded-xl border bg-white p-4">
        <label className="flex flex-col gap-1 text-sm">Vendor (select or type)
          <input className="rounded border px-3 py-2" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="A.O.R. INC." />
        </label>
        <label className="flex flex-col gap-1 text-sm">Update Name
          <input className="rounded border px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} placeholder="AOR - September 2026" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Upload Excel/CSV (optional)
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">or Paste Vendor Data (SKU + price per line)
          <textarea className="min-h-40 rounded border px-3 py-2 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={"0 58854 04522 7\t19.99\n624-917-74008-0, 24.50"} />
        </label>
        <button disabled={busy} onClick={submit} className="rounded bg-slate-900 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Processing..." : "Process Price Update"}
        </button>
        {msg && <div className="text-sm text-slate-600">{msg}</div>}
      </div>
    </div>
  );
}
