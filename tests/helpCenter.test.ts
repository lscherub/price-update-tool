import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as helpListGet } from "@/app/api/help/route";
import { POST as createArticlePost } from "@/app/api/help/articles/route";
import {
  DELETE as deleteArticle,
  GET as getArticle,
  PATCH as patchArticle,
} from "@/app/api/help/articles/[slug]/route";
import { POST as restoreRevisionPost } from "@/app/api/help/articles/[slug]/revisions/route";
import { POST as createCategoryPost } from "@/app/api/help/categories/route";
import { GET as searchGet } from "@/app/api/help/search/route";
import { GET as contextGet } from "@/app/api/help/context/[key]/route";
import { POST as uploadImagePost } from "@/app/api/help/images/route";
import { DELETE as deleteImage, GET as getImage } from "@/app/api/help/images/[id]/route";
import { isHelpAdmin } from "@/lib/helpAuth";
import { extractToc } from "@/lib/helpTypes";
import { seedInitialHelpDrafts } from "@/lib/helpServer";
import * as authModule from "@/lib/auth";

vi.mock("@/lib/db", () => ({
  getPrisma: () => null,
  isDbConnectionError: () => false,
  dbUnreachableResponse: () => ({ status: 503 }),
  productionDbGuard: () => null,
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

const ADMIN_USER = { id: "u-admin", email: "owner@genesis.test", role: "admin" };
const STAFF_USER = { id: "u-staff", email: "staff@genesis.test", role: "staff" };

let tmpDir: string;
const origTestStore = process.env.TEST_STORE_FILE;
const origHelpAdmins = process.env.HELP_ADMIN_EMAILS;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "help-center-test-"));
  process.env.TEST_STORE_FILE = path.join(tmpDir, "store.json");
  delete process.env.HELP_ADMIN_EMAILS;
});

afterEach(() => {
  if (origTestStore === undefined) delete process.env.TEST_STORE_FILE;
  else process.env.TEST_STORE_FILE = origTestStore;
  if (origHelpAdmins === undefined) delete process.env.HELP_ADMIN_EMAILS;
  else process.env.HELP_ADMIN_EMAILS = origHelpAdmins;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Help Centre authorization (isHelpAdmin)", () => {
  it("reuses existing admin role when HELP_ADMIN_EMAILS is unset", () => {
    expect(isHelpAdmin(ADMIN_USER)).toBe(true);
    expect(isHelpAdmin(STAFF_USER)).toBe(false);
    expect(isHelpAdmin(null)).toBe(false);
  });

  it("enforces explicit HELP_ADMIN_EMAILS allowlist when configured (case-insensitive)", () => {
    process.env.HELP_ADMIN_EMAILS = "Owner@Genesis.Test, lead@genesis.test";
    expect(isHelpAdmin(ADMIN_USER)).toBe(true);
    expect(isHelpAdmin({ id: "u2", email: "other-admin@genesis.test", role: "admin" })).toBe(false);
    expect(isHelpAdmin({ id: "u3", email: "lead@genesis.test", role: "staff" })).toBe(true);
  });
});

describe("Help Centre TOC extraction & initial AI draft seeding", () => {
  it("builds unique anchor IDs for H2 and H3 headings", () => {
    const toc = extractToc([
      { id: "1", type: "heading", level: 2, text: "Overview" },
      { id: "2", type: "paragraph", text: "Body" },
      { id: "3", type: "heading", level: 3, text: "Step Details" },
      { id: "4", type: "heading", level: 2, text: "Overview" },
    ]);
    expect(toc).toEqual([
      { id: "1", anchor: "overview", level: 2, text: "Overview" },
      { id: "3", anchor: "step-details", level: 3, text: "Step Details" },
      { id: "4", anchor: "overview-2", level: 2, text: "Overview" },
    ]);
  });

  it("seeds all initial articles strictly as DRAFT awaiting admin review and is idempotent", async () => {
    const first = await seedInitialHelpDrafts(null, ADMIN_USER.email);
    expect(first.categoriesCreated).toBeGreaterThanOrEqual(7);
    expect(first.articlesCreated).toBeGreaterThanOrEqual(20);

    // Second run creates zero duplicates
    const second = await seedInitialHelpDrafts(null, ADMIN_USER.email);
    expect(second.categoriesCreated).toBe(0);
    expect(second.articlesCreated).toBe(0);

    // Staff sees ZERO drafts
    vi.mocked(authModule.getSession).mockResolvedValueOnce(STAFF_USER);
    const staffRes = await helpListGet();
    const staffData = await staffRes.json();
    expect(staffRes.status).toBe(200);
    expect(staffData.canManage).toBe(false);
    expect(staffData.articles).toEqual([]);
    expect(staffData.categories).toEqual([]);

    // Admin sees all seeded drafts
    vi.mocked(authModule.getSession).mockResolvedValueOnce(ADMIN_USER);
    const adminRes = await helpListGet();
    const adminData = await adminRes.json();
    expect(adminRes.status).toBe(200);
    expect(adminData.canManage).toBe(true);
    expect(adminData.articles.length).toBe(first.articlesCreated);
    expect(adminData.articles.every((a: { status: string }) => a.status === "DRAFT")).toBe(true);
  });
});

describe("Help Centre server-side RBAC, dual-buffer draft/publish, search, revisions & images", () => {
  it("blocks regular staff with 403 on all write endpoints", async () => {
    vi.mocked(authModule.getSession).mockResolvedValue(STAFF_USER);

    const r1 = await createCategoryPost(
      new Request("http://localhost/api/help/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Unauthorized Cat" }),
      }),
    );
    expect(r1.status).toBe(403);

    const r2 = await createArticlePost(
      new Request("http://localhost/api/help/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: "c1", title: "Hack" }),
      }),
    );
    expect(r2.status).toBe(403);

    const r3 = await patchArticle(
      new Request("http://localhost/api/help/articles/some-slug", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish" }),
      }),
      { params: Promise.resolve({ slug: "some-slug" }) },
    );
    expect(r3.status).toBe(403);

    const r4 = await deleteArticle(new Request("http://localhost/api/help/articles/some-slug", { method: "DELETE" }), {
      params: Promise.resolve({ slug: "some-slug" }),
    });
    expect(r4.status).toBe(403);

    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" }));
    const r5 = await uploadImagePost(new Request("http://localhost/api/help/images", { method: "POST", body: fd }));
    expect(r5.status).toBe(403);
  });

  it("supports full lifecycle: create draft -> staff hidden -> publish -> edit draft without changing live view -> publish update -> restore revision -> unpublish -> delete", async () => {
    // 1. Admin creates a category and a draft article
    vi.mocked(authModule.getSession).mockResolvedValue(ADMIN_USER);
    const catRes = await createCategoryPost(
      new Request("http://localhost/api/help/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "SOP Guides" }),
      }),
    );
    expect(catRes.status).toBe(201);
    const catId = (await catRes.json()).category.id;

    const artRes = await createArticlePost(
      new Request("http://localhost/api/help/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: catId,
          title: "Exporting Raw Worksheets Guide",
          summary: "Version 1 summary",
          contextKeys: ["worksheet"],
          blocks: [
            { id: "h1", type: "heading", level: 2, text: "Steps" },
            { id: "p1", type: "paragraph", text: "Original published instructions." },
          ],
          publish: false,
        }),
      }),
    );
    expect(artRes.status).toBe(201);
    const slug: string = (await artRes.json()).article.slug;

    // 2. Staff CANNOT read or search draft article
    vi.mocked(authModule.getSession).mockResolvedValue(STAFF_USER);
    const staffDraftRes = await getArticle(new Request(`http://localhost/api/help/articles/${slug}`), {
      params: Promise.resolve({ slug }),
    });
    expect(staffDraftRes.status).toBe(404);

    const staffSearchDraft = await searchGet(new Request("http://localhost/api/help/search?q=Exporting"));
    expect((await staffSearchDraft.json()).results).toEqual([]);

    // 3. Admin publishes article -> staff sees it in reader, search, and contextual help
    vi.mocked(authModule.getSession).mockResolvedValue(ADMIN_USER);
    const pubRes = await patchArticle(
      new Request(`http://localhost/api/help/articles/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish" }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(pubRes.status).toBe(200);

    vi.mocked(authModule.getSession).mockResolvedValue(STAFF_USER);
    const staffLiveRes = await getArticle(new Request(`http://localhost/api/help/articles/${slug}`), {
      params: Promise.resolve({ slug }),
    });
    expect(staffLiveRes.status).toBe(200);
    const staffLive = await staffLiveRes.json();
    expect(staffLive.article.title).toBe("Exporting Raw Worksheets Guide");
    expect(staffLive.article.blocks[1].text).toBe("Original published instructions.");
    expect(staffLive.revisions).toBeUndefined();

    const staffSearchLive = await searchGet(new Request("http://localhost/api/help/search?q=Original"));
    expect((await staffSearchLive.json()).results.length).toBe(1);

    const ctxRes = await contextGet(new Request("http://localhost/api/help/context/worksheet"), {
      params: Promise.resolve({ key: "worksheet" }),
    });
    expect((await ctxRes.json()).articles.map((a: { slug: string }) => a.slug)).toContain(slug);

    // 4. Admin edits published article and saves as DRAFT -> staff MUST still see Version 1!
    vi.mocked(authModule.getSession).mockResolvedValue(ADMIN_USER);
    const draftEditRes = await patchArticle(
      new Request(`http://localhost/api/help/articles/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-draft",
          title: "Exporting Raw Worksheets Guide (v2 WIP)",
          blocks: [
            { id: "h1", type: "heading", level: 2, text: "Steps" },
            { id: "p1", type: "paragraph", text: "Unpublished v2 draft wording." },
          ],
        }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    const draftEditData = await draftEditRes.json();
    expect(draftEditRes.status).toBe(200);
    expect(draftEditData.article.hasUnpublishedChanges).toBe(true);

    vi.mocked(authModule.getSession).mockResolvedValue(STAFF_USER);
    const staffStillV1 = await (
      await getArticle(new Request(`http://localhost/api/help/articles/${slug}`), {
        params: Promise.resolve({ slug }),
      })
    ).json();
    expect(staffStillV1.article.title).toBe("Exporting Raw Worksheets Guide");
    expect(staffStillV1.article.blocks[1].text).toBe("Original published instructions.");

    // 5. Admin publishes v2 -> staff now sees v2
    vi.mocked(authModule.getSession).mockResolvedValue(ADMIN_USER);
    await patchArticle(
      new Request(`http://localhost/api/help/articles/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish" }),
      }),
      { params: Promise.resolve({ slug }) },
    );

    vi.mocked(authModule.getSession).mockResolvedValue(STAFF_USER);
    const staffNowV2 = await (
      await getArticle(new Request(`http://localhost/api/help/articles/${slug}`), {
        params: Promise.resolve({ slug }),
      })
    ).json();
    expect(staffNowV2.article.title).toBe("Exporting Raw Worksheets Guide (v2 WIP)");
    expect(staffNowV2.article.blocks[1].text).toBe("Unpublished v2 draft wording.");

    // 6. Admin restores earlier v1 revision into draft
    vi.mocked(authModule.getSession).mockResolvedValue(ADMIN_USER);
    const adminDetail = await (
      await getArticle(new Request(`http://localhost/api/help/articles/${slug}`), {
        params: Promise.resolve({ slug }),
      })
    ).json();
    const v1Rev = adminDetail.revisions.find((r: { version: number }) => r.version === 1);
    expect(v1Rev).toBeTruthy();
    const restoreRes = await restoreRevisionPost(
      new Request(`http://localhost/api/help/articles/${slug}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionId: v1Rev.id }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(restoreRes.status).toBe(200);
    expect((await restoreRes.json()).article.draftTitle).toBe("Exporting Raw Worksheets Guide");

    // 7. Admin unpublishes -> hidden from staff again
    await patchArticle(
      new Request(`http://localhost/api/help/articles/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unpublish" }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    vi.mocked(authModule.getSession).mockResolvedValue(STAFF_USER);
    const afterUnpub = await getArticle(new Request(`http://localhost/api/help/articles/${slug}`), {
      params: Promise.resolve({ slug }),
    });
    expect(afterUnpub.status).toBe(404);
  });

  it("uploads, serves, and deletes Help Centre screenshot images cleanly", async () => {
    vi.mocked(authModule.getSession).mockResolvedValue(ADMIN_USER);
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    const fd = new FormData();
    fd.append("file", new File([pngBytes], "worksheet-export.png", { type: "image/png" }));
    fd.append("caption", "Export toolbar");

    const upRes = await uploadImagePost(new Request("http://localhost/api/help/images", { method: "POST", body: fd }));
    expect(upRes.status).toBe(201);
    const upData = await upRes.json();
    expect(upData.image.url).toBe(`/api/help/images/${upData.image.id}`);
    expect(upData.image.mimeType).toBe("image/png");

    // Staff can read uploaded screenshot image
    vi.mocked(authModule.getSession).mockResolvedValue(STAFF_USER);
    const imgRes = await getImage(new Request(`http://localhost${upData.image.url}`), {
      params: Promise.resolve({ id: upData.image.id }),
    });
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await imgRes.arrayBuffer())).toEqual(pngBytes);

    // Admin can delete image; subsequent fetch returns 404
    vi.mocked(authModule.getSession).mockResolvedValue(ADMIN_USER);
    const delRes = await deleteImage(new Request(`http://localhost${upData.image.url}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: upData.image.id }),
    });
    expect(delRes.status).toBe(200);

    const goneRes = await getImage(new Request(`http://localhost${upData.image.url}`), {
      params: Promise.resolve({ id: upData.image.id }),
    });
    expect(goneRes.status).toBe(404);
  });
});
