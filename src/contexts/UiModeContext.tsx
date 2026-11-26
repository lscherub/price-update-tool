"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import {
  DEFAULT_DASHBOARD_CONFIG,
  DEFAULT_NAVIGATION_CONFIG,
  DEFAULT_USER_PREFERENCES,
  sanitizeUserPreferences,
  type DashboardConfig,
  type DashboardSectionId,
  type MetricKey,
  type NavigationConfig,
  type PriceEditorMode,
  type StoredUserPreferences,
  type UiAccent,
  type UiDensity,
  type UiMode,
  type UiTheme,
} from "@/lib/userPreferencesShared";

export type {
  UiMode,
  UiTheme,
  UiAccent,
  UiDensity,
  PriceEditorMode,
  DashboardSectionId,
  MetricKey,
  DashboardConfig,
  NavigationConfig,
};

export type UiPreferences = StoredUserPreferences;

const DEFAULT_PREFERENCES: UiPreferences = {
  ...DEFAULT_USER_PREFERENCES,
  dashboard: DEFAULT_DASHBOARD_CONFIG,
  navigation: DEFAULT_NAVIGATION_CONFIG,
};

const STORAGE_KEY = "price_tool_ui_preferences_v1";
const USER_PREFS_STORAGE_PREFIX = "price_tool_user_prefs_v1:";
const EDITOR_STORAGE_PREFIX = "price_tool_editor_pref_v1:";

export function editorStorageKeyForUser(userId: string | null | undefined): string {
  return `${EDITOR_STORAGE_PREFIX}${userId ? userId : "default"}`;
}

export function userPrefsStorageKey(userId: string | null | undefined): string {
  return `${USER_PREFS_STORAGE_PREFIX}${userId ? userId : "default"}`;
}

export function resolveEffectiveTheme(
  mode: UiMode,
  theme: UiTheme,
  systemPrefersDark: boolean,
): "light" | "dark" {
  if (mode !== "new") return "light";
  if (theme === "dark") return "dark";
  if (theme === "system") return systemPrefersDark ? "dark" : "light";
  return "light";
}

interface UiModeContextType {
  preferences: UiPreferences;
  mode: UiMode;
  theme: UiTheme;
  resolvedTheme: "light" | "dark";
  accent: UiAccent;
  density: UiDensity;
  dashboard: DashboardConfig;
  navigation: NavigationConfig;
  defaultPriceEditor: PriceEditorMode;
  priceEditor: PriceEditorMode;
  userId: string | null;
  preferencesLoaded: boolean;
  spreadsheetFullscreen: boolean;
  setMode: (mode: UiMode) => void;
  setTheme: (theme: UiTheme) => void;
  setAccent: (accent: UiAccent) => void;
  setDensity: (density: UiDensity) => void;
  setDefaultPriceEditor: (editor: PriceEditorMode) => void;
  setPriceEditor: (editor: PriceEditorMode) => void;
  resetPriceEditorToDefault: () => void;
  setSpreadsheetFullscreen: (v: boolean | ((prev: boolean) => boolean)) => void;
  toggleSectionVisibility: (sectionId: DashboardSectionId) => void;
  reorderSections: (fromIndex: number, toIndex: number) => void;
  toggleMetricVisibility: (metricKey: MetricKey) => void;
  setSidebarCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void;
  toggleSidebarCollapsed: () => void;
  toggleNavItemVisibility: (href: string) => void;
  resetDefaults: () => void;
  registerUnsavedChecker: (checker: () => boolean) => () => void;
  requestModeChange: (newMode: UiMode) => boolean;
}

const UiModeContext = createContext<UiModeContextType | null>(null);

function readCachedPreferences(key: string): UiPreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return sanitizeUserPreferences(JSON.parse(raw), DEFAULT_PREFERENCES);
  } catch {
    return null;
  }
}

function writeCachedPreferences(prefs: UiPreferences, uid: string | null) {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(prefs);
    localStorage.setItem(STORAGE_KEY, serialized);
    if (uid) {
      localStorage.setItem(userPrefsStorageKey(uid), serialized);
      localStorage.setItem(editorStorageKeyForUser(uid), prefs.defaultPriceEditor);
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function UiModeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [preferences, setPreferences] = useState<UiPreferences>(DEFAULT_PREFERENCES);
  const [priceEditorOverride, setPriceEditorOverride] = useState<PriceEditorMode | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [spreadsheetFullscreen, setSpreadsheetFullscreen] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(false);
  const [, startTransition] = useTransition();
  const unsavedCheckersRef = useRef<Set<() => boolean>>(new Set());
  const loadedUserIdRef = useRef<string | null | undefined>(undefined);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate initial client cache right after mount for zero-flash UX without SSR mismatch
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const cached = readCachedPreferences(STORAGE_KEY);
      if (cached) {
        setPreferences(cached);
      }
      if (typeof window !== "undefined") {
        setSystemPrefersDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
      }
      setIsLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Listen to live OS color scheme changes so Follow System responds immediately
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemPrefersDark(mq.matches);
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    }
    mq.addListener(update);
    return () => mq.removeListener(update);
  }, []);

  // Persist user preferences to the server (per-user AppSetting) with light debouncing
  const syncPreferencesToServer = useCallback((next: UiPreferences, immediate = false) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const run = () => {
      fetch("/api/settings/preferences", {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }).catch(() => {
        // Offline or unauthenticated — localStorage cache still preserves state
      });
    };
    if (immediate) {
      run();
    } else {
      saveTimerRef.current = setTimeout(run, 150);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Load authenticated user's persisted preferences from server (re-runs on route changes
  // so login/logout or account switches immediately pick up the active user's settings).
  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then(async (d) => {
        if (!active) return;
        const uid: string | null = d?.user?.id ? String(d.user.id) : null;

        // Avoid redundant server reloads if the authenticated user hasn't changed
        if (loadedUserIdRef.current === uid) {
          setPreferencesLoaded(true);
          return;
        }
        loadedUserIdRef.current = uid;
        setUserId(uid);
        setPriceEditorOverride(null);

        if (!uid) {
          const fallback = readCachedPreferences(STORAGE_KEY) ?? DEFAULT_PREFERENCES;
          setPreferences(fallback);
          setPreferencesLoaded(true);
          return;
        }

        // Apply user-scoped local cache immediately if available while fetching server truth
        const userCached = readCachedPreferences(userPrefsStorageKey(uid));
        if (userCached) {
          setPreferences(userCached);
        }

        try {
          const prefRes = await fetch("/api/settings/preferences", { cache: "no-store" });
          if (!active) return;
          if (prefRes.ok) {
            const prefData = await prefRes.json().catch(() => ({}));
            if (prefData?.preferences) {
              const serverPrefs = sanitizeUserPreferences(prefData.preferences, DEFAULT_PREFERENCES);
              setPreferences(serverPrefs);
              writeCachedPreferences(serverPrefs, uid);
            }
          }
        } catch {
          // Keep cached / default preferences if network fails
        } finally {
          if (active) setPreferencesLoaded(true);
        }
      })
      .catch(() => {
        if (active) setPreferencesLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [pathname]);

  const resolvedTheme = resolveEffectiveTheme(preferences.mode, preferences.theme, systemPrefersDark);

  // Apply theme, accent, density, and color-scheme attributes to <html>
  useEffect(() => {
    if (!isLoaded) return;
    const root = document.documentElement;
    root.setAttribute("data-ui-mode", preferences.mode);
    root.setAttribute("data-ui-accent", preferences.accent);
    root.setAttribute("data-ui-density", preferences.density);
    root.setAttribute("data-ui-theme", preferences.theme);

    if (resolvedTheme === "dark") {
      root.classList.add("dark");
      root.style.colorScheme = "dark";
    } else {
      root.classList.remove("dark");
      root.style.colorScheme = "light";
    }
  }, [preferences.mode, preferences.theme, preferences.accent, preferences.density, resolvedTheme, isLoaded]);

  const updatePreferences = useCallback(
    (updater: (prev: UiPreferences) => UiPreferences, opts?: { immediate?: boolean; transition?: boolean }) => {
      const apply = () => {
        setPreferences((prev) => {
          const next = updater(prev);
          writeCachedPreferences(next, userId);
          if (userId) {
            syncPreferencesToServer(next, opts?.immediate ?? false);
          }
          return next;
        });
      };
      if (opts?.transition) {
        startTransition(apply);
      } else {
        apply();
      }
    },
    [userId, syncPreferencesToServer],
  );

  const registerUnsavedChecker = useCallback((checker: () => boolean) => {
    unsavedCheckersRef.current.add(checker);
    return () => {
      unsavedCheckersRef.current.delete(checker);
    };
  }, []);

  const setMode = useCallback(
    (mode: UiMode) => {
      updatePreferences((prev) => ({ ...prev, mode }), { transition: true, immediate: true });
    },
    [updatePreferences],
  );

  const requestModeChange = useCallback(
    (newMode: UiMode): boolean => {
      if (newMode === preferences.mode) return true;
      for (const checker of unsavedCheckersRef.current) {
        if (checker()) {
          const confirmed = window.confirm(
            "You have unsaved changes on this page. Switching UI modes will reload the view. Are you sure you want to proceed?",
          );
          if (!confirmed) return false;
          break;
        }
      }
      setMode(newMode);
      return true;
    },
    [preferences.mode, setMode],
  );

  const setTheme = useCallback(
    (theme: UiTheme) => {
      updatePreferences((prev) => ({ ...prev, theme }), { transition: true, immediate: true });
    },
    [updatePreferences],
  );

  const setAccent = useCallback(
    (accent: UiAccent) => {
      updatePreferences((prev) => ({ ...prev, accent }), { transition: true, immediate: true });
    },
    [updatePreferences],
  );

  const setDensity = useCallback(
    (density: UiDensity) => {
      updatePreferences((prev) => ({ ...prev, density }), { transition: true, immediate: true });
    },
    [updatePreferences],
  );

  /** Updates the user's saved Default Price Update Editor (persisted to DB + cache). */
  const setDefaultPriceEditor = useCallback(
    (editor: PriceEditorMode) => {
      const normalized: PriceEditorMode = editor === "legacy" ? "legacy" : "spreadsheet";
      setPriceEditorOverride(null);
      updatePreferences((prev) => ({ ...prev, defaultPriceEditor: normalized }), { immediate: true });
    },
    [updatePreferences],
  );

  /** Temporarily switches the active editor on the current worksheet without changing the saved default. */
  const setPriceEditor = useCallback((editor: PriceEditorMode) => {
    const normalized: PriceEditorMode = editor === "legacy" ? "legacy" : "spreadsheet";
    setPriceEditorOverride(normalized);
  }, []);

  const resetPriceEditorToDefault = useCallback(() => {
    setPriceEditorOverride(null);
  }, []);

  const toggleSectionVisibility = useCallback(
    (sectionId: DashboardSectionId) => {
      updatePreferences((prev) => ({
        ...prev,
        dashboard: {
          ...prev.dashboard,
          sectionVisibility: {
            ...prev.dashboard.sectionVisibility,
            [sectionId]: !prev.dashboard.sectionVisibility[sectionId],
          },
        },
      }));
    },
    [updatePreferences],
  );

  const reorderSections = useCallback(
    (fromIndex: number, toIndex: number) => {
      updatePreferences((prev) => {
        const updated = [...prev.dashboard.sections];
        const [moved] = updated.splice(fromIndex, 1);
        updated.splice(toIndex, 0, moved);
        return {
          ...prev,
          dashboard: {
            ...prev.dashboard,
            sections: updated,
          },
        };
      });
    },
    [updatePreferences],
  );

  const toggleMetricVisibility = useCallback(
    (metricKey: MetricKey) => {
      updatePreferences((prev) => ({
        ...prev,
        dashboard: {
          ...prev.dashboard,
          visibleMetrics: {
            ...prev.dashboard.visibleMetrics,
            [metricKey]: !prev.dashboard.visibleMetrics[metricKey],
          },
        },
      }));
    },
    [updatePreferences],
  );

  const setSidebarCollapsed = useCallback(
    (collapsed: boolean | ((prev: boolean) => boolean)) => {
      updatePreferences((prev) => ({
        ...prev,
        navigation: {
          ...prev.navigation,
          collapsed: typeof collapsed === "function" ? collapsed(prev.navigation.collapsed) : collapsed,
        },
      }));
    },
    [updatePreferences],
  );

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, [setSidebarCollapsed]);

  const toggleNavItemVisibility = useCallback(
    (href: string) => {
      updatePreferences((prev) => {
        const exists = prev.navigation.hiddenNavItems.includes(href);
        return {
          ...prev,
          navigation: {
            ...prev.navigation,
            hiddenNavItems: exists
              ? prev.navigation.hiddenNavItems.filter((h) => h !== href)
              : [...prev.navigation.hiddenNavItems, href],
          },
        };
      });
    },
    [updatePreferences],
  );

  const resetDefaults = useCallback(() => {
    setPriceEditorOverride(null);
    updatePreferences(() => DEFAULT_PREFERENCES, { immediate: true });
  }, [updatePreferences]);

  const defaultPriceEditor = preferences.defaultPriceEditor;
  const priceEditor = priceEditorOverride ?? defaultPriceEditor;

  return (
    <UiModeContext.Provider
      value={{
        preferences,
        mode: preferences.mode,
        theme: preferences.theme,
        resolvedTheme,
        accent: preferences.accent,
        density: preferences.density,
        dashboard: preferences.dashboard,
        navigation: preferences.navigation,
        defaultPriceEditor,
        priceEditor,
        userId,
        preferencesLoaded,
        spreadsheetFullscreen,
        setMode,
        setTheme,
        setAccent,
        setDensity,
        setDefaultPriceEditor,
        setPriceEditor,
        resetPriceEditorToDefault,
        setSpreadsheetFullscreen,
        toggleSectionVisibility,
        reorderSections,
        toggleMetricVisibility,
        setSidebarCollapsed,
        toggleSidebarCollapsed,
        toggleNavItemVisibility,
        resetDefaults,
        registerUnsavedChecker,
        requestModeChange,
      }}
    >
      {children}
    </UiModeContext.Provider>
  );
}

export function useUiMode() {
  const context = useContext(UiModeContext);
  if (!context) {
    throw new Error("useUiMode must be used within a UiModeProvider");
  }
  return context;
}
