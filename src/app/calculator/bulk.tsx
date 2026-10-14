"use client";
import { useState } from "react";
import { apiErrorText } from "@/lib/apiError";
import { DEFAULT_DIVISOR } from "@/lib/pricing";
import { Field, Section, inputCls, ROUND_OPTS } from "./shared";
import type { RoundingMethod } from "@/lib/calculator";

type BulkRow = {
  index: number;
  vendor: string;
  brand: string;
  listCost?: string;
  discount?: string;
  discountSource?: string;
  netCost?: string | null;
  divisor?: string;
  retailExact?: string | null;
  retailRounded?: string | null;
  error?: string;
};

const SAMPLE = `Vendor,Brand,ListCost,Divisor,DiscountOverride
Ecotrend,Provita,27.00,,
CAN PREV,,11.49,,`;

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsv(text: string): { vendor: string; brand: string; listCost: string; divisor: string; discountOverride: string }[] {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const head = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const find = (...names: string[]) => {
    for (const n of names) {
      const i = head.findIndex((h) => h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const vi = find("vendor", "supplier");
  const bi = find("brand", "qualifier");
  const ci = find("listcost", "new cost", "cost", "price");
  const di = find("divisor");
  const oi = find("discountoverride", "override", "discount");
  const rows: { vendor: string; brand: string; listCost: string; divisor: string; discountOverride: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (!cols.some((c) => c !== "")) continue;
    rows.push({
      vendor: vi >= 0 ? (cols[vi] ?? "") : "",
      brand: bi >= 0 ? (cols[bi] ?? "") : "",
      listCost: ci >= 0 ? (cols[ci] ?? "") : (cols[cols.length - 1] ?? ""),
      divisor: di >= 0 ? (cols[di] ?? "") : "",
      discountOverride: oi >= 0 ? (cols[oi] ?? "") : "",
    });
  }
  return rows;
}

export function BulkCalc() {
  const [csv, setCsv] = useState(SAMPLE);
  const [divisor, setDivisor] = useState(DEFAULT_DIVISOR);
  const [rounding, setRounding] = useState<RoundingMethod>("nearest9");
  const [out, setOut] = useState<BulkRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function run() {
    setBusy(true);
    setMsg("");
    try {
      const parsed = parseCsv(csv).map((r) => ({
        vendor: r.vendor,
        brand: r.brand,
        listCost: r.listCost,
        divisor: r.divisor || divisor,
        discountOverride: r.discountOverride,
      }));
      if (!parsed.length) throw new Error("No data rows found.");
      const r = await fetch("/api/calculator/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(apiErrorText(d, "Could not calculate."));
      let rows: BulkRow[] = Array.isArray(d.rows) ? d.rows : [];
      if (rounding !== "nearest9") {
        const { roundRetailPrice } = await import("@/lib/calculator");
        rows = rows.map((x) =>
          x.retailExact ? { ...x, retailRounded: roundRetailPrice(x.retailExact, rounding) } : x,
        );
      }
      setOut(rows);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not calculate.");
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const head = "Vendor,Brand,ListCost,Discount,Source,NetCost,Divisor,RetailExact,Retail";
    const lines = out.map((r) =>
      [r.vendor, r.brand, r.listCost ?? "", r.discount ?? "", r.discountSource ?? "", r.netCost ?? "", r.divisor ?? "", r.retailExact ?? "", r.retailRounded ?? ""]
        .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[head, ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pos_pricing_import.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <div className="grid gap-4">
      <Section title="Bulk pricing import" sub="Header row required: Vendor, Brand, ListCost, Divisor, DiscountOverride.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Default divisor">
            <input className={inputCls} value={divisor} onChange={(e) => setDivisor(e.target.value)} />
          </Field>
          <Field label="Rounding">
            <select className={inputCls} value={rounding} onChange={(e) => setRounding(e.target.value as RoundingMethod)}>
              {ROUND_OPTS.map((o) => (
                <option key={o.v} value={o.v}>{o.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="mt-3">
          <Field label="CSV data">
            <textarea className={`${inputCls} font-mono text-xs`} rows={7} value={csv} onChange={(e) => setCsv(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={run} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Calculating..." : "Process & preview"}
          </button>
          <button type="button" disabled={!out.length} onClick={download} className="rounded border px-3 py-1.5 text-sm disabled:opacity-50">
            Download CSV
          </button>
          <label className="cursor-pointer rounded border px-3 py-1.5 text-sm">
            Import file
            <input
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setCsv(await f.text());
              }}
            />
          </label>
        </div>
        {msg ? <p className="mt-2 text-sm text-red-600">{msg}</p> : null}
      </Section>
      <Section title="POS-ready output preview">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="px-2 py-1">Vendor</th>
                <th className="px-2 py-1">Brand</th>
                <th className="px-2 py-1">List</th>
                <th className="px-2 py-1">Disc</th>
                <th className="px-2 py-1">Net</th>
                <th className="px-2 py-1">Retail</th>
              </tr>
            </thead>
            <tbody>
              {out.map((r) => (
                <tr key={r.index} className="border-t">
                  <td className="px-2 py-1">{r.vendor}</td>
                  <td className="px-2 py-1">{r.brand}</td>
                  <td className="px-2 py-1">{r.error ? <span className="text-red-600">{r.error}</span> : `$${r.listCost}`}</td>
                  <td className="px-2 py-1">{r.discount ? `${r.discount}% (${r.discountSource})` : "—"}</td>
                  <td className="px-2 py-1 font-semibold">{r.netCost ? `$${r.netCost}` : "—"}</td>
                  <td className="px-2 py-1 font-semibold text-emerald-700">{r.retailRounded ? `$${r.retailRounded}` : "—"}</td>
                </tr>
              ))}
              {out.length === 0 ? (
                <tr><td colSpan={6} className="px-2 py-4 text-center text-slate-500">Process the CSV to preview.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

