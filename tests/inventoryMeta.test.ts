import { describe, expect, it } from "vitest";
import { getLastFullImportAt, setLastFullImportNow } from "@/lib/inventoryMeta";

/** In-memory stand-in for Prisma's raw query methods. */
function makeMetaDb(initial = "") {
  let value = initial;
  const calls: string[] = [];
  return {
    calls,
    db: {
      $queryRawUnsafe: async <T,>(sql: string): Promise<T> => {
        calls.push(sql);
        return (value ? [{ value }] : []) as T;
      },
      $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
        calls.push(sql);
        if (params.length >= 2 && sql.includes("ON CONFLICT")) value = String(params[1]);
        return 1;
      },
    },
  };
}

describe("inventory last-import timestamp — only successful full imports write", () => {
  it("returns null when there has never been a successful full import", async () => {
    const { db } = makeMetaDb("");
    expect(await getLastFullImportAt(db)).toBeNull();
  });
  it("records and reads back the successful import time", async () => {
    const { db } = makeMetaDb("");
    const iso = await setLastFullImportNow(db, new Date("2026-10-07T10:42:00Z"));
    expect(iso).toBe("2026-10-07T10:42:00.000Z");
    expect(await getLastFullImportAt(db)).toBe(iso);
  });
  it("a later successful import replaces the previous timestamp", async () => {
    const { db } = makeMetaDb("2026-10-01T00:00:00.000Z");
    const iso = await setLastFullImportNow(db, new Date("2026-10-07T10:42:00Z"));
    expect(await getLastFullImportAt(db)).toBe(iso);
  });
  it("ignores garbage values instead of showing them", async () => {
    const { db } = makeMetaDb("not-a-date");
    expect(await getLastFullImportAt(db)).toBeNull();
  });
});
