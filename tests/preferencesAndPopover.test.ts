import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_USER_PREFERENCES,
  getUserPreferences,
  saveUserPreferences,
  sanitizeUserPreferences,
  userPreferencesKey,
} from "../src/lib/userPreferences";
import { computePopoverPosition } from "../src/lib/popoverPosition";
import { resolveEffectiveTheme } from "../src/contexts/UiModeContext";

describe("User UI Preferences (Default Editor, Density, Theme)", () => {
  let tmpDir: string;
  let storeFile: string;
  const origTestStore = process.env.TEST_STORE_FILE;
  const origDbUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-prefs-"));
    storeFile = path.join(tmpDir, "store.json");
    process.env.TEST_STORE_FILE = storeFile;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (origTestStore === undefined) delete process.env.TEST_STORE_FILE;
    else process.env.TEST_STORE_FILE = origTestStore;
    if (origDbUrl !== undefined) process.env.DATABASE_URL = origDbUrl;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("defaults defaultPriceEditor to spreadsheet for new and existing users without a saved preference", async () => {
    expect(DEFAULT_USER_PREFERENCES.defaultPriceEditor).toBe("spreadsheet");
    const { preferences: prefs, hasStoredRecord } = await getUserPreferences(null, "user-new-1");
    expect(hasStoredRecord).toBe(false);
    expect(prefs.defaultPriceEditor).toBe("spreadsheet");
    expect(prefs.density).toBe("comfortable");
    expect(prefs.theme).toBe("light");
  });

  it("persists per-user preferences independently without leaking between users", async () => {
    await saveUserPreferences(null, "user-alice", {
      defaultPriceEditor: "legacy",
      density: "compact",
      theme: "dark",
    });
    await saveUserPreferences(null, "user-bob", {
      defaultPriceEditor: "spreadsheet",
      density: "spacious",
      theme: "system",
    });

    const { preferences: alice, hasStoredRecord: aliceStored } = await getUserPreferences(null, "user-alice");
    const { preferences: bob, hasStoredRecord: bobStored } = await getUserPreferences(null, "user-bob");

    expect(aliceStored).toBe(true);
    expect(alice.defaultPriceEditor).toBe("legacy");
    expect(alice.density).toBe("compact");
    expect(alice.theme).toBe("dark");

    expect(bobStored).toBe(true);
    expect(bob.defaultPriceEditor).toBe("spreadsheet");
    expect(bob.density).toBe("spacious");
    expect(bob.theme).toBe("system");

    expect(userPreferencesKey("user-alice")).not.toBe(userPreferencesKey("user-bob"));
  });

  it("merges partial updates without resetting other saved fields", async () => {
    await saveUserPreferences(null, "user-merge", {
      defaultPriceEditor: "legacy",
      density: "spacious",
      theme: "dark",
    });
    await saveUserPreferences(null, "user-merge", { density: "compact" });

    const { preferences: prefs } = await getUserPreferences(null, "user-merge");
    expect(prefs.defaultPriceEditor).toBe("legacy");
    expect(prefs.density).toBe("compact");
    expect(prefs.theme).toBe("dark");
  });

  it("sanitizes invalid or corrupt preference values safely", () => {
    const cleaned = sanitizeUserPreferences({
      mode: "invalid",
      theme: "neon",
      accent: "rainbow",
      density: "giant",
      defaultPriceEditor: "excel",
    });
    expect(cleaned.mode).toBe(DEFAULT_USER_PREFERENCES.mode);
    expect(cleaned.theme).toBe(DEFAULT_USER_PREFERENCES.theme);
    expect(cleaned.accent).toBe(DEFAULT_USER_PREFERENCES.accent);
    expect(cleaned.density).toBe(DEFAULT_USER_PREFERENCES.density);
    expect(cleaned.defaultPriceEditor).toBe("spreadsheet");
  });
});

describe("Effective Theme Resolution (Light, Dark, Follow System)", () => {
  it("resolves dark/light/system properly in New UI", () => {
    expect(resolveEffectiveTheme("new", "light", true)).toBe("light");
    expect(resolveEffectiveTheme("new", "dark", false)).toBe("dark");
    expect(resolveEffectiveTheme("new", "system", true)).toBe("dark");
    expect(resolveEffectiveTheme("new", "system", false)).toBe("light");
  });

  it("always resolves to light in Classic UI", () => {
    expect(resolveEffectiveTheme("classic", "dark", true)).toBe("light");
    expect(resolveEffectiveTheme("classic", "system", true)).toBe("light");
  });
});

describe("Popover Viewport Collision Positioning (All Inventory & Table Filter Menus)", () => {
  it("keeps menu inside right viewport edge for rightmost columns", () => {
    const pos = computePopoverPosition({
      anchorRect: { top: 120, left: 1180, right: 1250, bottom: 148, width: 70, height: 28 },
      menuWidth: 240,
      menuHeight: 220,
      viewportWidth: 1280,
      viewportHeight: 800,
    });
    expect(pos.left + 240).toBeLessThanOrEqual(1280 - 8);
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.placement).toBe("bottom");
  });

  it("clamps menu to left viewport padding when anchor is scrolled off the left edge", () => {
    const pos = computePopoverPosition({
      anchorRect: { top: 120, left: -40, right: 10, bottom: 148, width: 50, height: 28 },
      menuWidth: 220,
      menuHeight: 180,
      viewportWidth: 1280,
      viewportHeight: 800,
    });
    expect(pos.left).toBe(8);
  });

  it("flips above the trigger when insufficient space exists below", () => {
    const pos = computePopoverPosition({
      anchorRect: { top: 680, left: 300, right: 380, bottom: 710, width: 80, height: 30 },
      menuWidth: 240,
      menuHeight: 260,
      viewportWidth: 1280,
      viewportHeight: 760,
    });
    expect(pos.placement).toBe("top");
    expect(pos.top).toBeLessThan(680);
    expect(pos.top).toBeGreaterThanOrEqual(8);
  });

  it("caps maxHeight and maxWidth for small viewports", () => {
    const pos = computePopoverPosition({
      anchorRect: { top: 80, left: 20, right: 100, bottom: 110, width: 80, height: 30 },
      menuWidth: 400,
      menuHeight: 600,
      viewportWidth: 360,
      viewportHeight: 400,
    });
    expect(pos.maxWidth).toBe(344);
    expect(pos.left).toBe(8);
    expect(pos.maxHeight).toBeLessThanOrEqual(400 - 110 - 6 - 8);
  });
});
