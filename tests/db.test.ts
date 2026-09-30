import { describe, expect, it } from "vitest";
import { dbUnreachableResponse, isDbConnectionError } from "@/lib/db";

describe("db connection errors", () => {
  it("detects Prisma P1001 by code", () => {
    expect(isDbConnectionError({ code: "P1001", message: "anything" })).toBe(true);
  });
  it("detects unreachable-server message", () => {
    expect(isDbConnectionError(new Error("Can't reach database server at db.x.supabase.co:5432"))).toBe(true);
  });
  it("ignores non-connection errors", () => {
    expect(isDbConnectionError(new Error("Unique constraint failed"))).toBe(false);
  });
  it("returns a 503 DatabaseUnavailable response", async () => {
    const res = dbUnreachableResponse();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("DatabaseUnavailable");
  });
});
