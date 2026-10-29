"use client";

import React, { createContext, useContext, useEffect, useState, useTransition } from "react";

export type UiMode = "new" | "classic";
export type UiTheme = "light" | "dark" | "system";
export type UiAccent = "indigo" | "blue" | "emerald" | "violet" | "slate";
export type UiDensity = "compact" | "comfortable" | "spacious";

export type DashboardSectionId = "metrics" | "quickActions" | "recentUpdates" | "inventoryHealth";
export type MetricKey = "products" | "active" | "inactive" | "vendors" | "sessions";

export interface DashboardConfig {
  sections: DashboardSectionId[];
  sectionVisibility: Record<DashboardSectionId, boolean>;
  visibleMetrics: Record<MetricKey, boolean>;
}

export interface NavigationConfig {
  collapsed: boolean;
  hiddenNavItems: string[];
}

export interface UiPreferences {
  mode: UiMode;
  theme: UiTheme;
  accent: UiAccent;
  density: UiDensity;
  dashboard: DashboardConfig;
  navigation: NavigationConfig;
}

const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  sections: ["metrics", "quickActions", "recentUpdates", "inventoryHealth"],
  sectionVisibility: {
    metrics: true,
    quickActions: true,
    recentUpdates: true,
    inventoryHealth: true,
  },
  visibleMetrics: {
    products: true,
    active: true,
    inactive: true,
    vendors: true,
    sessions: true,
  },
};

const DEFAULT_NAVIGATION_CONFIG: NavigationConfig = {
  collapsed: false,
  hiddenNavItems: [],
};

const DEFAULT_PREFERENCES: UiPreferences = {
  mode: "new",
  theme: "light",
  accent: "indigo",
  density: "comfortable",
  dashboard: DEFAULT_DASHBOARD_CONFIG,
  navigation: DEFAULT_NAVIGATION_CONFIG,
};

const STORAGE_KEY = "price_tool_ui_preferences_v1";

interface UiModeContextType {
  preferences: UiPreferences;
  mode: UiMode;
  theme: UiTheme;
  accent: UiAccent;
  density: UiDensity;
  dashboard: DashboardConfig;
  navigation: NavigationConfig;
  setMode: (mode: UiMode) => void;
  setTheme: (theme: UiTheme) => void;
  setAccent: (accent: UiAccent) => void;
  setDensity: (density: UiDensity) => void;
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

export function UiModeProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<UiPreferences>(DEFAULT_PREFERENCES);
  const [isLoaded, setIsLoaded] = useState(false);
  const [, startTransition] = useTransition();
  const unsavedCheckersRef = React.useRef<Set<() => boolean>>(new Set());

  // Load preferences from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setPreferences({
          mode: parsed.mode === "classic" ? "classic" : "new",
          theme: ["light", "dark", "system"].includes(parsed.theme) ? parsed.theme : "light",
          accent: ["indigo", "blue", "emerald", "violet", "slate"].includes(parsed.accent) ? parsed.accent : "indigo",
          density: ["compact", "comfortable", "spacious"].includes(parsed.density) ? parsed.density : "comfortable",
          dashboard: {
            sections: Array.isArray(parsed.dashboard?.sections) ? parsed.dashboard.sections : DEFAULT_DASHBOARD_CONFIG.sections,
            sectionVisibility: {
              ...DEFAULT_DASHBOARD_CONFIG.sectionVisibility,
              ...(parsed.dashboard?.sectionVisibility || {}),
            },
            visibleMetrics: {
              ...DEFAULT_DASHBOARD_CONFIG.visibleMetrics,
              ...(parsed.dashboard?.visibleMetrics || {}),
            },
          },
          navigation: {
            collapsed: Boolean(parsed.navigation?.collapsed),
            hiddenNavItems: Array.isArray(parsed.navigation?.hiddenNavItems) ? parsed.navigation.hiddenNavItems : [],
          },
        });
      } else {
        // First-time users default to New UI as requested in Requirement 1
        setPreferences(DEFAULT_PREFERENCES);
      }
    } catch {
      // Fallback to default
      setPreferences(DEFAULT_PREFERENCES);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // Save preferences to localStorage whenever they change
  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Ignore quota errors
    }
  }, [preferences, isLoaded]);

  // Apply theme & accent data attributes to document element
  useEffect(() => {
    if (!isLoaded) return;
    const root = document.documentElement;
    root.setAttribute("data-ui-mode", preferences.mode);
    root.setAttribute("data-ui-accent", preferences.accent);
    root.setAttribute("data-ui-density", preferences.density);

    // Dark mode handling
    if (preferences.mode === "new") {
      let isDark = preferences.theme === "dark";
      if (preferences.theme === "system" && typeof window !== "undefined") {
        isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      }
      if (isDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    } else {
      // Classic mode is light
      root.classList.remove("dark");
    }
  }, [preferences.mode, preferences.theme, preferences.accent, preferences.density, isLoaded]);

  const registerUnsavedChecker = (checker: () => boolean) => {
    unsavedCheckersRef.current.add(checker);
    return () => {
      unsavedCheckersRef.current.delete(checker);
    };
  };

  const requestModeChange = (newMode: UiMode): boolean => {
    if (newMode === preferences.mode) return true;
    for (const checker of unsavedCheckersRef.current) {
      if (checker()) {
        const confirm = window.confirm(
          "You have unsaved changes on this page. Switching UI modes will reload the view. Are you sure you want to proceed?"
        );
        if (!confirm) return false;
        break;
      }
    }
    setMode(newMode);
    return true;
  };

  const setMode = (mode: UiMode) => {
    startTransition(() => {
      setPreferences((prev) => ({ ...prev, mode }));
    });
  };

  const setTheme = (theme: UiTheme) => {
    startTransition(() => {
      setPreferences((prev) => ({ ...prev, theme }));
    });
  };

  const setAccent = (accent: UiAccent) => {
    startTransition(() => {
      setPreferences((prev) => ({ ...prev, accent }));
    });
  };

  const setDensity = (density: UiDensity) => {
    startTransition(() => {
      setPreferences((prev) => ({ ...prev, density }));
    });
  };

  const toggleSectionVisibility = (sectionId: DashboardSectionId) => {
    setPreferences((prev) => ({
      ...prev,
      dashboard: {
        ...prev.dashboard,
        sectionVisibility: {
          ...prev.dashboard.sectionVisibility,
          [sectionId]: !prev.dashboard.sectionVisibility[sectionId],
        },
      },
    }));
  };

  const reorderSections = (fromIndex: number, toIndex: number) => {
    setPreferences((prev) => {
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
  };

  const toggleMetricVisibility = (metricKey: MetricKey) => {
    setPreferences((prev) => ({
      ...prev,
      dashboard: {
        ...prev.dashboard,
        visibleMetrics: {
          ...prev.dashboard.visibleMetrics,
          [metricKey]: !prev.dashboard.visibleMetrics[metricKey],
        },
      },
    }));
  };

  const setSidebarCollapsed = (collapsed: boolean | ((prev: boolean) => boolean)) => {
    setPreferences((prev) => ({
      ...prev,
      navigation: {
        ...prev.navigation,
        collapsed: typeof collapsed === "function" ? collapsed(prev.navigation.collapsed) : collapsed,
      },
    }));
  };

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => !prev);
  };

  const toggleNavItemVisibility = (href: string) => {
    setPreferences((prev) => {
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
  };

  const resetDefaults = () => {
    setPreferences(DEFAULT_PREFERENCES);
  };

  return (
    <UiModeContext.Provider
      value={{
        preferences,
        mode: preferences.mode,
        theme: preferences.theme,
        accent: preferences.accent,
        density: preferences.density,
        dashboard: preferences.dashboard,
        navigation: preferences.navigation,
        setMode,
        setTheme,
        setAccent,
        setDensity,
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

