"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/sessions", label: "Price Updates" },
  { href: "/sessions/new", label: "New Price Update" },
  { href: "/inventory", label: "Inventory" },
  { href: "/vendors", label: "Vendor Discounts" },
  { href: "/exports", label: "Exports" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  useEffect(() => {
    fetch("/api/auth/session").then((r) => r.json()).then((d) => setUser(d.user)).catch(() => {});
  }, [path]);
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex">
          <div className="mb-6 px-2">
            <div className="text-lg font-bold">Price Update Tool</div>
            <div className="text-xs text-slate-500">Nutrition / Supplement Retail</div>
          </div>
          <nav className="flex flex-col gap-1">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-lg px-3 py-2 text-sm ${path === n.href ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto px-2 pt-6 text-xs text-slate-500">
            {user ? (
              <div className="flex flex-col gap-2">
                <span className="truncate">{user.email} ({user.role})</span>
                <button
                  className="rounded border px-2 py-1 text-left hover:bg-slate-100"
                  onClick={async () => { await fetch("/api/auth/session", { method: "DELETE" }); router.push("/login"); }}
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 md:hidden">
            <span className="font-bold">Price Update Tool</span>
            <nav className="flex gap-2 overflow-x-auto text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="whitespace-nowrap rounded bg-slate-100 px-2 py-1">{n.label}</Link>
              ))}
            </nav>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
