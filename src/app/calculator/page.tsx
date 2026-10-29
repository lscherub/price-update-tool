"use client";
import Link from "next/link";
import { useState } from "react";
import { SingleCalc } from "./single";
import { BatchCalc } from "./batch";
import { BulkCalc } from "./bulk";
import { useDiscountData } from "./shared";
import { useUiMode } from "@/contexts/UiModeContext";

export default function CalculatorPage() {
  const { mode } = useUiMode();
  const disc = useDiscountData();
  const [tab, setTab] = useState<"single" | "batch" | "bulk">("single");

  // ==========================================
  // CLASSIC UI MODE (Preserved pixel-perfect)
  // ==========================================
  if (mode === "classic") {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-bold">Vendor Pricing Calculator</h1>
          <p className="text-sm text-slate-600">
            Single-item, batch, and bulk pricing using the saved Vendor Discounts
            and brand rules — the same lookup as the Price Update worksheet.
          </p>
        </div>
        {disc.error ? (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {disc.error}{" "}
            <button type="button" className="underline" onClick={() => disc.reload()}>Retry</button>
          </p>
        ) : null}
        {disc.loading ? <p className="text-sm text-slate-500">Loading vendor discounts...</p> : null}
        <div className="flex gap-2">
          {(
            [
              ["single", "Single-item"],
              ["batch", "Batch"],
              ["bulk", "Bulk CSV"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setTab(v)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === v ? "bg-slate-900 text-white" : "bg-slate-200"}`}
            >
              {label}
            </button>
          ))}
          <a href="/vendors" className="ml-auto self-center text-sm text-blue-700 underline">
            Manage discounts
          </a>
        </div>
        {tab === "single" ? <SingleCalc disc={disc} /> : null}
        {tab === "batch" ? <BatchCalc disc={disc} /> : null}
        {tab === "bulk" ? <BulkCalc /> : null}
        <p className="text-xs text-slate-500">
          Calculations never modify a price update sheet or saved discounts.
          Nearest-9 rounding matches the worksheet exactly.
        </p>
      </div>
    );
  }

  // ==========================================
  // NEW UI MODE (Modernized layout)
  // ==========================================
  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            Vendor Pricing Calculator
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
            Simulate prices, retail margins, and nearest-9 rounding with live vendor & brand discount rules.
          </p>
        </div>
        <Link
          href="/vendors"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          Manage Vendor Discounts →
        </Link>
      </div>

      {disc.error ? (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          <span>{disc.error}</span>
          <button
            type="button"
            className="rounded border border-red-300 bg-white px-2.5 py-1 font-semibold text-red-800 hover:bg-red-100 dark:border-red-800 dark:bg-zinc-900"
            onClick={() => disc.reload()}
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Segmented Tab Controls */}
      <div className="flex items-center gap-1 rounded-xl border border-slate-200/90 bg-slate-100/70 p-1 shadow-2xs dark:border-zinc-800 dark:bg-zinc-900 w-fit">
        <button
          type="button"
          onClick={() => setTab("single")}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
            tab === "single"
              ? "bg-white text-slate-900 shadow-xs dark:bg-zinc-800 dark:text-white"
              : "text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
          }`}
        >
          <svg className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span>Single Item</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("batch")}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
            tab === "batch"
              ? "bg-white text-slate-900 shadow-xs dark:bg-zinc-800 dark:text-white"
              : "text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
          }`}
        >
          <svg className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
          <span>Batch Calculator</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("bulk")}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
            tab === "bulk"
              ? "bg-white text-slate-900 shadow-xs dark:bg-zinc-800 dark:text-white"
              : "text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
          }`}
        >
          <svg className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <span>Bulk CSV Upload</span>
        </button>
      </div>

      {/* Calculator Body */}
      <div className="flex flex-col gap-4">
        {tab === "single" ? <SingleCalc disc={disc} /> : null}
        {tab === "batch" ? <BatchCalc disc={disc} /> : null}
        {tab === "bulk" ? <BulkCalc /> : null}
      </div>

      {/* Safety Notice */}
      <div className="flex items-start gap-2.5 rounded-xl border border-slate-200/70 bg-slate-50/50 p-3 text-[11px] text-slate-500 dark:border-zinc-800/80 dark:bg-zinc-900/40 dark:text-zinc-400">
        <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Calculations are completely non-destructive and never modify live inventory, vendor discounts, or saved price sheets. Nearest-9 rounding matches the live price worksheet logic exactly.</span>
      </div>
    </div>
  );
}
