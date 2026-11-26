/**
 * Client-safe types, defaults, and sanitization for per-user UI preferences.
 * Server persistence lives in `src/lib/userPreferences.ts` so client bundles
 * never pull in Node `fs` or Prisma.
 */

export type UiMode = "new" | "classic";
export type UiTheme = "light" | "dark" | "system";
export type UiAccent = "indigo" | "blue" | "emerald" | "violet" | "slate";
export type UiDensity = "compact" | "comfortable" | "spacious";
export type PriceEditorMode = "legacy" | "spreadsheet";

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

export interface StoredUserPreferences {
  mode: UiMode;
  theme: UiTheme;
  accent: UiAccent;
  density: UiDensity;
  defaultPriceEditor: PriceEditorMode;
  dashboard: DashboardConfig;
  navigation: NavigationConfig;
}

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
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

export const DEFAULT_NAVIGATION_CONFIG: NavigationConfig = {
  collapsed: false,
  hiddenNavItems: [],
};

export const DEFAULT_USER_PREFERENCES: StoredUserPreferences = {
  mode: "new",
  theme: "light",
  accent: "indigo",
  density: "comfortable",
  defaultPriceEditor: "spreadsheet",
  dashboard: DEFAULT_DASHBOARD_CONFIG,
  navigation: DEFAULT_NAVIGATION_CONFIG,
};

const VALID_SECTIONS: readonly DashboardSectionId[] = [
  "metrics",
  "quickActions",
  "recentUpdates",
  "inventoryHealth",
];

const VALID_THEMES: readonly UiTheme[] = ["light", "dark", "system"];
const VALID_ACCENTS: readonly UiAccent[] = ["indigo", "blue", "emerald", "violet", "slate"];
const VALID_DENSITIES: readonly UiDensity[] = ["compact", "comfortable", "spacious"];

export function sanitizeUserPreferences(
  input: unknown,
  base: StoredUserPreferences = DEFAULT_USER_PREFERENCES,
): StoredUserPreferences {
  if (!input || typeof input !== "object") {
    return {
      ...base,
      dashboard: {
        sections: [...base.dashboard.sections],
        sectionVisibility: { ...base.dashboard.sectionVisibility },
        visibleMetrics: { ...base.dashboard.visibleMetrics },
      },
      navigation: {
        collapsed: base.navigation.collapsed,
        hiddenNavItems: [...base.navigation.hiddenNavItems],
      },
    };
  }

  const raw = input as Record<string, unknown>;

  const mode: UiMode = raw.mode === "classic" ? "classic" : raw.mode === "new" ? "new" : base.mode;
  const theme: UiTheme =
    typeof raw.theme === "string" && (VALID_THEMES as readonly string[]).includes(raw.theme)
      ? (raw.theme as UiTheme)
      : base.theme;
  const accent: UiAccent =
    typeof raw.accent === "string" && (VALID_ACCENTS as readonly string[]).includes(raw.accent)
      ? (raw.accent as UiAccent)
      : base.accent;
  const density: UiDensity =
    typeof raw.density === "string" && (VALID_DENSITIES as readonly string[]).includes(raw.density)
      ? (raw.density as UiDensity)
      : base.density;
  const defaultPriceEditor: PriceEditorMode =
    raw.defaultPriceEditor === "legacy"
      ? "legacy"
      : raw.defaultPriceEditor === "spreadsheet"
        ? "spreadsheet"
        : base.defaultPriceEditor;

  const rawDash =
    raw.dashboard && typeof raw.dashboard === "object"
      ? (raw.dashboard as Record<string, unknown>)
      : null;

  let sections = [...base.dashboard.sections];
  if (rawDash && Array.isArray(rawDash.sections)) {
    const filtered = rawDash.sections.filter(
      (s): s is DashboardSectionId =>
        typeof s === "string" && (VALID_SECTIONS as readonly string[]).includes(s),
    );
    const deduped = Array.from(new Set(filtered));
    for (const req of VALID_SECTIONS) {
      if (!deduped.includes(req)) deduped.push(req);
    }
    sections = deduped;
  }

  const rawVis =
    rawDash?.sectionVisibility && typeof rawDash.sectionVisibility === "object"
      ? (rawDash.sectionVisibility as Record<string, unknown>)
      : {};
  const sectionVisibility: Record<DashboardSectionId, boolean> = {
    metrics: typeof rawVis.metrics === "boolean" ? rawVis.metrics : base.dashboard.sectionVisibility.metrics,
    quickActions:
      typeof rawVis.quickActions === "boolean" ? rawVis.quickActions : base.dashboard.sectionVisibility.quickActions,
    recentUpdates:
      typeof rawVis.recentUpdates === "boolean" ? rawVis.recentUpdates : base.dashboard.sectionVisibility.recentUpdates,
    inventoryHealth:
      typeof rawVis.inventoryHealth === "boolean"
        ? rawVis.inventoryHealth
        : base.dashboard.sectionVisibility.inventoryHealth,
  };

  const rawMetrics =
    rawDash?.visibleMetrics && typeof rawDash.visibleMetrics === "object"
      ? (rawDash.visibleMetrics as Record<string, unknown>)
      : {};
  const visibleMetrics: Record<MetricKey, boolean> = {
    products: typeof rawMetrics.products === "boolean" ? rawMetrics.products : base.dashboard.visibleMetrics.products,
    active: typeof rawMetrics.active === "boolean" ? rawMetrics.active : base.dashboard.visibleMetrics.active,
    inactive: typeof rawMetrics.inactive === "boolean" ? rawMetrics.inactive : base.dashboard.visibleMetrics.inactive,
    vendors: typeof rawMetrics.vendors === "boolean" ? rawMetrics.vendors : base.dashboard.visibleMetrics.vendors,
    sessions: typeof rawMetrics.sessions === "boolean" ? rawMetrics.sessions : base.dashboard.visibleMetrics.sessions,
  };

  const rawNav =
    raw.navigation && typeof raw.navigation === "object"
      ? (raw.navigation as Record<string, unknown>)
      : null;

  const navigation: NavigationConfig = {
    collapsed:
      rawNav && typeof rawNav.collapsed === "boolean" ? rawNav.collapsed : base.navigation.collapsed,
    hiddenNavItems:
      rawNav && Array.isArray(rawNav.hiddenNavItems)
        ? rawNav.hiddenNavItems.filter((h): h is string => typeof h === "string" && h.startsWith("/"))
        : [...base.navigation.hiddenNavItems],
  };

  return {
    mode,
    theme,
    accent,
    density,
    defaultPriceEditor,
    dashboard: {
      sections,
      sectionVisibility,
      visibleMetrics,
    },
    navigation,
  };
}
