"use client";
import { useCallback, useEffect, useState } from "react";
import { apiErrorText } from "@/lib/apiError";
import { LoadingButton } from "@/components/LoadingButton";
import { useToast, InlineSpinner } from "@/components/Toast";

export default function VendorsPage() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; vendor: string; defaultDiscount: string }[]>([]);
  const [vendor, setVendor] = useState("");
  const [discount, setDiscount] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchVendors = useCallback(async (query: string, showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const r = await fetch(`/api/vendors?q=${encodeURIComponent(query)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(apiErrorText(d, "Could not load vendor discounts.")); setRows([]); return; }
      setMsg("");
      setRows(d.rows ?? []);
    } catch {
      setMsg("Could not reach the server. Check your connection and try again.");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  // Initial load. The setState calls happen in the fetch callbacks, not
  // synchronously in the effect body.
  useEffect(() => {
    let active = true;
    fetch(`/api/vendors?q=`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!active) return;
        if (!r.ok) { setMsg(apiErrorText(d, "Could not load vendor discounts.")); setRows([]); return; }
        setMsg(""); setRows(d.rows ?? []);
      })
      .catch(() => { if (active) setMsg("Could not reach the server. Check your connection and try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const search = () => { void fetchVendors(q, true); };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMsg("");
    try {
      const r = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor, defaultDiscount: discount || "0" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, "Could not save the vendor discount.");
        setMsg(t);
        toast.error("Could not save the vendor discount.", t);
        return;
      }
      // Clear inputs and refresh the table automatically after a successful save.
      setVendor(""); setDiscount("");
      toast.success("Vendor discount saved.", vendor);
      await fetchVendors(q);
    } catch {
      toast.error("Could not save the vendor discount.", "Could not reach the server while saving.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      const r = await fetch(`/api/vendors?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const t = apiErrorText(d, "Could not delete the vendor discount.");
        setMsg(t);
        toast.error("Could not delete the vendor discount.", t);
        return;
      }
      toast.success("Vendor discount deleted.", name);
      await fetchVendors(q);
    } catch {
      toast.error("Could not delete the vendor discount.", "Could not reach the server while deleting.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Vendor Discounts</h1>
      <div className="flex gap-2">
        <input className="w-full max-w-md rounded border px-3 py-2 disabled:opacity-60" placeholder="Search vendors..." disabled={loading || saving} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
        <LoadingButton busy={loading} busyLabel="Searching..." onClick={search} className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60">
          Search
        </LoadingButton>
      </div>
      {msg && <div className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{msg}</div>}
      {loading && <InlineSpinner label="Loading vendor discounts..." />}
      <form
        className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          await save();
        }}
      >
        <label className="flex flex-col text-sm">Vendor<input className="rounded border px-2 py-1 disabled:opacity-60" value={vendor} disabled={saving} onChange={(e) => setVendor(e.target.value)} required /></label>
        <label className="flex flex-col text-sm">Default Discount<input className="rounded border px-2 py-1 disabled:opacity-60" value={discount} disabled={saving} onChange={(e) => setDiscount(e.target.value)} placeholder="10" /></label>
        <LoadingButton type="submit" busy={saving} busyLabel="Saving..." className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60">
          Add / Update
        </LoadingButton>
      </form>
      <div className="overflow-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-left"><th className="px-4 py-2">Vendor</th><th className="px-4 py-2">Default Discount</th><th className="px-4 py-2"></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-4 py-2">{r.vendor}</td>
                <td className="px-4 py-2">{r.defaultDiscount}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    disabled={!!deletingId}
                    onClick={() => remove(r.id, r.vendor)}
                    className="text-xs text-red-600 underline disabled:opacity-40"
                  >
                    {deletingId === r.id ? "Deleting..." : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
