"use client";

export type Item = {
  id: string; rawVendorSku: string; cleanedSku: string; cleanedOverridden: boolean;
  productNumber: string; productName: string; brand: string; vendor: string;
  discount: string; currentListPrice: string | null; vendorListPriceNew: string | null;
  ourNewListPrice: string | null; marginDivisor: string; ourNewRetailPrice: string | null;
  oldRetailPrice: string | null; nearest9: string | null; notes: string;
  isInactive: boolean; matched: boolean;
};

export const COLS: { key: string; label: string; editable?: boolean }[] = [
  { key: "rawVendorSku", label: "Raw Vendor SKU/Code", editable: true },
  { key: "cleanedSku", label: "Cleaned SKU", editable: true },
  { key: "productNumber", label: "Product Number" },
  { key: "productName", label: "Product Name" },
  { key: "brand", label: "Brand" },
  { key: "vendor", label: "Vendor" },
  { key: "discount", label: "Discount (%) Vendor/Brand", editable: true },
  { key: "currentListPrice", label: "Current List Price" },
  { key: "vendorListPriceNew", label: "Vendor List Price (New)", editable: true },
  { key: "ourNewListPrice", label: "Our New List Price" },
  { key: "marginDivisor", label: "Margin/Divisor", editable: true },
  { key: "ourNewRetailPrice", label: "Our New Retail Price" },
  { key: "oldRetailPrice", label: "Old Retail Price" },
  { key: "nearest9", label: "Nearest 9" },
  { key: "notes", label: "Notes", editable: true },
];

export function Flags({ r }: { r: Item }) {
  return (
    <span className="whitespace-nowrap">
      {!r.matched && <span className="mr-1 rounded bg-red-600 px-1.5 py-0.5 text-white">Not Found</span>}
      {r.isInactive && <span className="mr-1 rounded bg-amber-200 px-1.5 py-0.5">Inactive</span>}
      {r.cleanedOverridden && <span className="mr-1 rounded bg-blue-100 px-1.5 py-0.5">Manual SKU</span>}
      {r.matched && r.nearest9 && r.oldRetailPrice && r.nearest9 !== r.oldRetailPrice && <span className="rounded bg-emerald-100 px-1.5 py-0.5">Changed</span>}
      {r.matched && r.nearest9 && r.oldRetailPrice && r.nearest9 === r.oldRetailPrice && <span className="text-slate-400">No change</span>}
    </span>
  );
}

export function PriceGrid({ rows, page, pageSize, onEdit, onDelete, selected, onToggle, onToggleAll }: {
  rows: Item[]; page: number; pageSize: number;
  onEdit: (item: Item, key: string, value: string) => void;
  onDelete: (item: Item) => void;
  selected: Set<string>;
  onToggle: (item: Item) => void;
  onToggleAll: () => void;
}) {
  const slice = rows.slice((page - 1) * pageSize, page * pageSize);
  const sliceSelected = slice.filter((r) => selected.has(r.id)).length;
  const allChecked = slice.length > 0 && sliceSelected === slice.length;
  return (
    <div className="overflow-auto rounded-xl border bg-white" style={{ maxHeight: "65vh" }}>
      <table className="w-full min-w-[1800px] border-collapse text-xs">
        <thead className="sticky top-0 bg-slate-100">
          <tr>
            <th className="border px-2 py-2">
              <input
                type="checkbox"
                aria-label="Select all visible rows"
                checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = !allChecked && sliceSelected > 0; }}
                onChange={onToggleAll}
              />
            </th>
            {COLS.map((c) => (
              <th key={c.label} className={`border px-2 py-2 text-left font-semibold ${c.editable ? "bg-emerald-50" : ""}`}>{c.label}{c.editable ? " ✎" : ""}</th>
            ))}
            <th className="border px-2 py-2">Flags</th>
            <th className="border px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {slice.map((r) => (
            <tr key={r.id} className={`border-t ${!r.matched ? "bg-red-50" : ""}`}>
              <td className="border px-2 py-1 text-center">
                <input
                  type="checkbox"
                  aria-label={`Select row ${r.cleanedSku || r.rawVendorSku}`}
                  checked={selected.has(r.id)}
                  onChange={() => onToggle(r)}
                />
              </td>
              {COLS.map((c) => {
                const v = ((r as unknown as Record<string, string | null>)[c.key] ?? "") as string;
                if (c.editable) {
                  return (
                    <td key={c.label} className="border bg-emerald-50/40 px-1 py-0.5">
                      <input
                        className="w-full min-w-24 bg-transparent px-1 py-1 outline-none focus:bg-white"
                        defaultValue={v ?? ""}
                        key={`${r.id}-${c.key}-${v}`}
                        onBlur={(e) => { if (e.target.value !== (v ?? "")) onEdit(r, c.key, e.target.value); }}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      />
                    </td>
                  );
                }
                return <td key={c.label} className="border px-2 py-1">{v ?? ""}</td>;
              })}
              <td className="border px-2 py-1"><Flags r={r} /></td>
              <td className="border px-2 py-1"><button className="text-red-600" onClick={() => onDelete(r)}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
