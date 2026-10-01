import { describe, expect, it } from "vitest";
import { apiErrorText } from "../src/lib/apiError";

describe("apiErrorText", () => {
  it("prefers the actionable message (503 DatabaseUnavailable)", () => {
    expect(
      apiErrorText({ error: "DatabaseUnavailable", message: "Set DATABASE_URL to the Supabase pooler URI." }),
    ).toBe("Set DATABASE_URL to the Supabase pooler URI.");
  });

  it("falls back to 'error' when there is no message", () => {
    expect(apiErrorText({ error: "Invalid credentials" })).toBe("Invalid credentials");
  });

  it("uses the provided fallback for empty / malformed bodies", () => {
    expect(apiErrorText({}, "fallback text")).toBe("fallback text");
    expect(apiErrorText({ error: "   " }, "fallback text")).toBe("fallback text");
    expect(apiErrorText(null, "fallback text")).toBe("fallback text");
    expect(apiErrorText("boom", "fallback text")).toBe("fallback text");
    expect(apiErrorText({ error: 42 }, "fallback text")).toBe("fallback text");
  });

  it("has a sensible default fallback", () => {
    expect(apiErrorText(undefined)).toBe("Something went wrong. Please try again.");
  });
});
