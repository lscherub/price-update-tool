import { describe, expect, it } from "vitest";
import {
  buildHistorySearchParams,
  buildHistorySqlWhere,
  buildHistoryWhere,
  matchesHistoryRow,
  normalizeHistoryText,
  parseHistoryDateQuery,
} from "@/lib/sessionSearch";

describe("price update history search", () => {
  it("matches vendor name case-insensitively", () => {
    const row = { vendor: "A.O.R. INC.", name: "A.O.R. INC. - October 1, 2026", createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z" };
    expect(matchesHistoryRow(row, "AOR")).toBe(true);
    expect(normalizeHistoryText("A.O.R. INC.")).toContain("aor");
    expect(matchesHistoryRow(row, "aor")).toBe(true);
    expect(matchesHistoryRow(row, "Flora")).toBe(false);
  });

  it("matches update name", () => {
    const row = { vendor: "Flora", name: "Flora Fall Promo", createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z" };
    expect(matchesHistoryRow(row, "promo")).toBe(true);
    expect(matchesHistoryRow(row, "AOR")).toBe(false);
  });

  it("matches dates in several formats", () => {
    const row = { vendor: "AOR", name: "AOR update", createdAt: "2026-10-01T15:00:00.000Z", updatedAt: "2026-10-01T15:00:00.000Z" };
    expect(matchesHistoryRow(row, "2026-10-01")).toBe(true);
    expect(matchesHistoryRow(row, "October 2026")).toBe(true);
    expect(matchesHistoryRow(row, "2026-09-01")).toBe(false);
    expect(parseHistoryDateQuery("AOR")).toBeNull();
  });

  it("builds a Prisma where clause over vendor/name/date", () => {
    expect(buildHistoryWhere("")).toBeUndefined();
    const where = buildHistoryWhere("2026-10-01") as { OR: unknown[] };
    expect(where.OR.length).toBe(6);
    const textOnly = buildHistoryWhere("AOR") as { OR: unknown[] };
    expect(textOnly.OR.length).toBe(2);
  });

  it("builds parameterized server-side search params", () => {
    expect(buildHistorySearchParams("").like).toBe("%%");
    const p = buildHistorySearchParams("AOR");
    expect(p.like).toBe("%AOR%");
    expect(p.normLike).toBe("%aor%");
    expect(p.from).toBeNull();
    const dated = buildHistorySearchParams("2026-10-01");
    expect(dated.from).toBeInstanceOf(Date);
    expect(dated.to).toBeInstanceOf(Date);
    const { sql, params } = buildHistorySqlWhere("AOR", 1);
    expect(sql).toContain("regexp_replace");
    expect(params).toEqual(["%AOR%", "%aor%"]);
  });
});
