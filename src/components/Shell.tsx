"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useUiMode } from "@/contexts/UiModeContext";
import { NewShell } from "@/components/new-ui/NewShell";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/sessions", label: "Price Updates" },
  { href: "/sessions/new", label: "New Price Update" },
  { href: "/calculator", label: "Calculator" },
  { href: "/inventory", label: "Inventory" },
  { href: "/vendors", label: "Vendor Discounts" },
  { href: "/exports", label: "Exports" },
  { href: "/settings", label: "Settings" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const { mode, requestModeChange } = useUiMode();
  const path = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => setUser(d.user))
      .catch(() => {});
  }, [path]);

  // When New UI mode is selected, render the modernized NewShell presentation
  if (mode === "new") {
    return <NewShell>{children}</NewShell>;
  }

  // Otherwise, render the classic interface preserved exactly as existing
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex">
          <div className="mb-4 px-2">
            <div className="text-lg font-bold">Price Update Tool</div>
            <div className="text-xs text-slate-500">Nutrition / Supplement Retail</div>
          </div>

          {/* Classic UI Notice & Switcher */}
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
            <div className="flex items-center justify-between font-semibold text-slate-700">
              <span>Classic UI</span>
              <button
                type="button"
                onClick={() => requestModeChange("new")}
                className="text-xs font-bold text-indigo-600 hover:underline"
              >
                Switch to New UI →
              </button>
            </div>
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
                  className="rounded border px-2 py-1 text-left hover:bg-slate-100 disabled:opacity-60"
                  disabled={signingOut}
                  onClick={async () => {
                    if (signingOut) return;
                    setSigningOut(true);
                    try {
                      await fetch("/api/auth/session", { method: "DELETE" });
                      router.push("/login");
                      router.refresh();
                    } catch {
                      setSigningOut(false);
                    }
                  }}
                >
                  {signingOut ? "Signing out..." : "Sign out"}
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
            <button
              type="button"
              onClick={() => requestModeChange("new")}
              className="ml-auto shrink-0 rounded bg-indigo-600 px-2 py-1 text-xs font-bold text-white"
            >
              New UI
            </button>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
