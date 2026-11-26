/**
 * Per-user UI & Default Price Update Editor preferences backed by the existing
 * AppSetting table (PostgreSQL) with dev JSON file-store parity.
 *
 * Scope: Strictly user-specific (keyed by authenticated user ID), so each
 * employee keeps their own default editor, density, and appearance settings
 * across navigation, refreshes, logout/login, and different browser sessions
 * without requiring any database schema changes.
 */
import type { PrismaClient } from "@prisma/client";
import { loadFileStore, saveFileStore } from "./store";
import {
  DEFAULT_USER_PREFERENCES,
  sanitizeUserPreferences,
  type StoredUserPreferences,
} from "./userPreferencesShared";

export {
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
} from "./userPreferencesShared";

const USER_PREFS_KEY_PREFIX = "user_ui_prefs_v1:";

const ENSURE_APP_SETTING_SQL =
  `CREATE TABLE IF NOT EXISTS "AppSetting" (` +
  `"key" TEXT PRIMARY KEY, ` +
  `"value" TEXT NOT NULL DEFAULT '', ` +
  `"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()` +
  `)`;

export function userPreferencesKey(userId: string): string {
  return `${USER_PREFS_KEY_PREFIX}${userId}`;
}

async function readSetting(prisma: PrismaClient | null, key: string): Promise<string | null> {
  if (!prisma) {
    const store = loadFileStore();
    return store.appSettings?.[key] ?? null;
  }
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    return row ? row.value : null;
  } catch (e) {
    if ((e as { code?: string })?.code === "P2021") {
      await prisma.$executeRawUnsafe(ENSURE_APP_SETTING_SQL);
      return null;
    }
    throw e;
  }
}

async function writeSetting(prisma: PrismaClient | null, key: string, value: string): Promise<void> {
  if (!prisma) {
    const store = loadFileStore();
    if (!store.appSettings) store.appSettings = {};
    store.appSettings[key] = value;
    saveFileStore(store);
    return;
  }
  try {
    await prisma.appSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2021") {
      await prisma.$executeRawUnsafe(ENSURE_APP_SETTING_SQL);
      await prisma.appSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
      return;
    }
    throw e;
  }
}

export async function getUserPreferences(
  prisma: PrismaClient | null,
  userId: string,
): Promise<{ preferences: StoredUserPreferences; hasStoredRecord: boolean }> {
  const key = userPreferencesKey(userId);
  const raw = await readSetting(prisma, key);
  if (!raw) {
    return {
      preferences: sanitizeUserPreferences(null, DEFAULT_USER_PREFERENCES),
      hasStoredRecord: false,
    };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      preferences: sanitizeUserPreferences(parsed, DEFAULT_USER_PREFERENCES),
      hasStoredRecord: true,
    };
  } catch {
    return {
      preferences: sanitizeUserPreferences(null, DEFAULT_USER_PREFERENCES),
      hasStoredRecord: false,
    };
  }
}

export async function saveUserPreferences(
  prisma: PrismaClient | null,
  userId: string,
  patch: unknown,
): Promise<StoredUserPreferences> {
  const { preferences: existing } = await getUserPreferences(prisma, userId);
  const merged = sanitizeUserPreferences(patch, existing);
  const key = userPreferencesKey(userId);
  await writeSetting(prisma, key, JSON.stringify(merged));
  return merged;
}
