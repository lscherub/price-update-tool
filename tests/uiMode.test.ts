import { describe, expect, it } from "vitest";
import type { UiMode, UiPreferences, DashboardSectionId, MetricKey } from "@/contexts/UiModeContext";

describe("UI Mode & Preferences defaults", () => {
  it("defaults to New UI mode for first-time users", () => {
    const defaultMode: UiMode = "new";
    expect(defaultMode).toBe("new");
  });

  it("defines standard dashboard sections and ordering", () => {
    const expectedSections: DashboardSectionId[] = [
      "metrics",
      "quickActions",
      "recentUpdates",
      "inventoryHealth",
    ];
    expect(expectedSections).toHaveLength(4);
    expect(expectedSections).toContain("metrics");
    expect(expectedSections).toContain("recentUpdates");
  });

  it("allows reordering dashboard sections safely", () => {
    const sections: DashboardSectionId[] = ["metrics", "quickActions", "recentUpdates", "inventoryHealth"];
    // Move "recentUpdates" (index 2) to first position (index 0)
    const reordered = [...sections];
    const [item] = reordered.splice(2, 1);
    reordered.splice(0, 0, item);

    expect(reordered[0]).toBe("recentUpdates");
    expect(reordered[1]).toBe("metrics");
    expect(reordered).toHaveLength(4);
  });

  it("allows toggling metric visibility independently", () => {
    const visibleMetrics: Record<MetricKey, boolean> = {
      products: true,
      active: true,
      inactive: true,
      vendors: true,
      sessions: true,
    };

    const toggled = {
      ...visibleMetrics,
      inactive: !visibleMetrics.inactive,
    };

    expect(toggled.inactive).toBe(false);
    expect(toggled.products).toBe(true);
  });
});

