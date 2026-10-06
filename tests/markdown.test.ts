import { describe, expect, it } from "vitest";
import { applyPinnedOrder, markdownExcerpt, renderMarkdown } from "@/lib/markdown";

describe("markdown renderer", () => {
  it("renders bold, italic, headings, lists, and links", () => {
    expect(renderMarkdown("**bold**")).toContain("<strong>bold</strong>");
    expect(renderMarkdown("*italic*")).toContain("<em>italic</em>");
    expect(renderMarkdown("## Title")).toContain("<h2>Title</h2>");
    expect(renderMarkdown("- a\n- b")).toContain("<ul>");
    expect(renderMarkdown("1. a\n2. b")).toContain("<ol>");
    expect(renderMarkdown("[x](https://example.com)")).toContain('href="https://example.com"');
  });

  it("renders the vendor comparison table from the spec", () => {
    const md = [
      "| Vendor | Price |",
      "| ------ | ----: |",
      "| Vendor A | $24.99 |",
      "| Vendor B | $23.99 |",
    ].join("\n");
    const html = renderMarkdown(md);
    expect(html).toContain("<table");
    expect(html).toContain("Vendor B");
    expect(html).toContain("$23.99");
    expect(html).toContain("text-align:right");
  });

  it("escapes HTML so note content cannot inject markup", () => {
    const html = renderMarkdown('<script>alert("x")</script> **b**');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>b</strong>");
  });

  it("rejects unsafe link targets", () => {
    expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain("javascript:");
  });

  it("extracts a compact plain-text excerpt", () => {
    expect(markdownExcerpt("**Vendor Comparison**\n\n* Vendor A: $24.99")).toBe("Vendor Comparison");
    expect(markdownExcerpt("")).toBe("");
  });
});

describe("applyPinnedOrder", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("keeps the pinned visual order with fresh row objects", () => {
    const fresh = [{ id: "c" }, { id: "a" }, { id: "b" }];
    expect(applyPinnedOrder(fresh, ["a", "b", "c"]).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("appends unknown rows after the pin without disturbing it", () => {
    const fresh = [{ id: "z" }, { id: "b" }, { id: "a" }];
    expect(applyPinnedOrder(fresh, ["a", "b"]).map((r) => r.id)).toEqual(["a", "b", "z"]);
  });

  it("returns rows untouched when there is no pin", () => {
    expect(applyPinnedOrder(rows, [])).toBe(rows);
  });
});
