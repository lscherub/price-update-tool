"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useUiMode } from "@/contexts/UiModeContext";

interface NavItem {
  href: string;
  label: string;
  badge?: string;
  icon: (props: { className?: string }) => React.ReactNode;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    group: "OPERATIONS",
    items: [
      {
        href: "/",
        label: "Dashboard",
        icon: ({ className }) => (
          <svg className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        ),
      },
      {
        href: "/sessions",
        label: "Price Updates",
        icon: ({ className }) => (
          <svg className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
        ),
      },
      {
        href: "/sessions/new",
        label: "New Price Update",
        icon: ({ className }) => (
          <svg className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        ),
      },
      {
        href: "/fullvendor/new",
        label: "Full Vendor Update",
        badge: "FV",
        icon: ({ className }) => (
          <svg className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        ),
      },
      {
        href: "/inventory",
        label: "All Inventory",
        icon: ({ className }) => (
          <svg className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        ),
      },
    ],
  },
  {
    group: "TOOLS & PRICING",
    items: [
      {
        href: "/calculator",
        label: "Pricing Calculator",
        icon: ({ className }) => (
          <svg className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        ),
      },
      {
        href: "/vendors",
        label: "Vendor Discounts",
        icon: ({ className }) => (
          <svg className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
        ),
      },
    ],
  },
  {
    group: "REPORTS & DATA",
    items: [
      {
        href: "/exports",
        label: "Data Exports",
        icon: ({ className }) => (
          <svg className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        ),
      },
    ],
  },
  {
    group: "PREFERENCES",
    items: [
      {
        href: "/settings",
        label: "Appearance & Layout",
        icon: ({ className }) => (
          <svg className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
    ],
  },
];

export function NewShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const {
    navigation,
    toggleSidebarCollapsed,
    theme,
    setTheme,
    requestModeChange,
  } = useUiMode();

  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => setUser(d.user))
      .catch(() => {});
  }, [path]);

  // Determine current page title
  const getBreadcrumb = () => {
    if (path === "/") return "Dashboard";
    if (path === "/sessions") return "Price Updates";
    if (path === "/sessions/new") return "New Price Update";
    if (path.startsWith("/sessions/")) return "Worksheet";
    if (path === "/fullvendor/new") return "Full Vendor Update";
    if (path === "/inventory") return "All Inventory";
    if (path === "/calculator") return "Pricing Calculator";
    if (path === "/vendors") return "Vendor Discounts";
    if (path === "/exports") return "Data Exports";
    if (path === "/settings") return "Appearance & Layout";
    return "Operations";
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
      router.push("/login");
      router.refresh();
    } catch {
      setSigningOut(false);
    }
  };

  const isCollapsed = navigation.collapsed;

  return (
    <div className="flex min-h-screen bg-slate-50/70 text-slate-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-xs md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Modern Sidebar (Desktop & Mobile Drawer) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-slate-200/90 bg-white shadow-xs transition-all duration-200 dark:border-zinc-800 dark:bg-zinc-900 md:static ${
          mobileMenuOpen ? "translate-x-0 w-64" : "-translate-x-full md:translate-x-0"
        } ${isCollapsed ? "md:w-20" : "md:w-64"}`}
      >
        {/* Brand Header */}
        <div className="flex h-16 items-center justify-between border-b border-slate-100 px-4 dark:border-zinc-800">
          <Link href="/" className="flex items-center gap-2.5 overflow-hidden">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-black text-white shadow-sm"
              style={{ background: "var(--accent-primary, #4f46e5)" }}
            >
              P
            </div>
            {!isCollapsed && (
              <div className="flex flex-col overflow-hidden">
                <span className="truncate text-sm font-bold tracking-tight text-slate-900 dark:text-white">
                  Price Tool
                </span>
                <span className="truncate text-[10px] font-medium uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                  Enterprise Ops
                </span>
              </div>
            )}
          </Link>

          {/* Desktop collapse toggle */}
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-300 dark:hover:bg-zinc-800 md:flex"
          >
            <svg
              className={`h-4 w-4 transition-transform duration-200 ${isCollapsed ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>

          {/* Mobile close button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800 transition-colors md:hidden"
            aria-label="Close menu"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation Item Groups */}
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <nav className="flex flex-col gap-6">
            {NAV_GROUPS.map((group) => {
              const visibleItems = group.items.filter(
                (item) => !navigation.hiddenNavItems.includes(item.href)
              );
              if (visibleItems.length === 0) return null;

              return (
                <div key={group.group} className="flex flex-col gap-1">
                  {!isCollapsed && (
                    <div className="px-3 pb-1 text-[11px] font-bold tracking-wider text-slate-600 dark:text-zinc-300">
                      {group.group}
                    </div>
                  )}
                  {visibleItems.map((item) => {
                    const isActive =
                      path === item.href ||
                      (item.href !== "/" && path.startsWith(item.href) && !path.startsWith("/sessions/new"));

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        title={isCollapsed ? item.label : undefined}
                        className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                          isActive
                            ? "text-white shadow-xs"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-300 dark:hover:bg-zinc-800/80 dark:hover:text-white"
                        }`}
                        style={
                          isActive
                            ? {
                                background: "var(--accent-primary, #4f46e5)",
                              }
                            : {}
                        }
                      >
                        <item.icon
                          className={`shrink-0 ${
                            isActive
                              ? "text-white"
                              : "text-slate-600 group-hover:text-slate-900 dark:text-zinc-300 dark:group-hover:text-white"
                          } ${isCollapsed ? "mx-auto h-5 w-5" : "h-4 w-4"}`}
                        />
                        {!isCollapsed && (
                          <div className="flex flex-1 items-center justify-between">
                            <span className="truncate">{item.label}</span>
                            {item.badge && (
                              <span
                                className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                                  isActive
                                    ? "bg-white/20 text-white"
                                    : "bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300"
                                }`}
                              >
                                {item.badge}
                              </span>
                            )}
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        </div>

        {/* Footer Area: Mode Switch & User Info */}
        <div className="border-t border-slate-100 p-3 dark:border-zinc-800">
          {/* Quick UI Mode Switcher Banner */}
          {!isCollapsed && (
            <div className="mb-3 rounded-xl border border-slate-200/80 bg-slate-50/80 p-2.5 dark:border-zinc-800 dark:bg-zinc-800/50">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-700 dark:text-zinc-300">Interface Mode</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  New UI
                </span>
              </div>
              <button
                type="button"
                onClick={() => requestModeChange("classic")}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-center text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 active:scale-98 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                Switch to Classic UI
              </button>
            </div>
          )}

          {/* User Profile */}
          {user ? (
            <div className={`flex items-center gap-2 ${isCollapsed ? "justify-center" : ""}`}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700 dark:bg-zinc-700 dark:text-zinc-200">
                {user.email.charAt(0).toUpperCase()}
              </div>
              {!isCollapsed && (
                <div className="flex flex-1 flex-col overflow-hidden">
                  <span className="truncate text-xs font-semibold text-slate-800 dark:text-zinc-200" title={user.email}>
                    {user.email}
                  </span>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-slate-600 dark:text-zinc-300">
                      {user.role}
                    </span>
                    <button
                      type="button"
                      disabled={signingOut}
                      onClick={handleSignOut}
                      className="text-[10px] text-red-600 hover:underline dark:text-red-400"
                    >
                      {signingOut ? "..." : "Sign out"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200/90 bg-white/95 px-4 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/95 md:px-8">
          <div className="flex items-center gap-3">
            {/* Mobile menu trigger */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800 md:hidden"
              aria-label="Open navigation menu"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* Breadcrumb Path */}
            <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-zinc-300">
              <span className="hidden sm:inline">Price Workspace</span>
              <span className="hidden text-slate-300 dark:text-zinc-700 sm:inline">/</span>
              <span className="font-bold text-slate-900 dark:text-white">{getBreadcrumb()}</span>
            </div>
          </div>

          {/* Quick Header Actions */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Quick Mode Toggle Pill */}
            <div className="hidden items-center rounded-lg border border-slate-200 bg-slate-100/70 p-0.5 shadow-2xs dark:border-zinc-700 dark:bg-zinc-800 sm:flex">
              <button
                type="button"
                onClick={() => requestModeChange("classic")}
                className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
              >
                Classic UI
              </button>
              <span
                className="rounded-md px-2.5 py-1 text-[11px] font-bold text-white shadow-xs"
                style={{ background: "var(--accent-primary, #4f46e5)" }}
              >
                New UI
              </span>
            </div>

            {/* Theme Toggle Button */}
            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 shadow-2xs hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <svg className="h-4 w-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="h-4 w-4 text-slate-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>
              )}
            </button>

            {/* Settings Quick Link */}
            <Link
              href="/settings"
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 shadow-2xs hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              title="Appearance & Layout Settings"
              aria-label="Settings"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
          </div>
        </header>

        {/* Page Content Container */}
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

