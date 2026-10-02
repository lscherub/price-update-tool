import { describe, expect, it } from "vitest";
import { storeCountNewPrice } from "@/app/api/sessions/[id]/storecount/route";

describe("store count PDF New Price rule", () => {
  it("leaves New Price blank when Nearest 9 equals Old Retail", () => {
    expect(storeCountNewPrice("61.99", "61.99")).toBe("");
  });

  it("shows Nearest 9 when it differs from Old Retail", () => {
    expect(storeCountNewPrice("62.29", "61.99")).toBe("62.29");
  });

  it("handles missing values without new calculation", () => {
    expect(storeCountNewPrice(null, "61.99")).toBe("");
    expect(storeCountNewPrice("62.29", null)).toBe("62.29");
    expect(storeCountNewPrice("61.9", "61.90")).toBe("");
  });
});
