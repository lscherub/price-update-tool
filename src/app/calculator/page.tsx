"use client";
import { useState } from "react";
import { SingleCalc } from "./single";
import { BatchCalc } from "./batch";
import { BulkCalc } from "./bulk";
import { useDiscountData } from "./shared";

export default function CalculatorPage() {
  const disc = useDiscountData();
  const [tab, setTab] = useState<"single" | "batch" | "bulk">("single");
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
