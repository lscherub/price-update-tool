import fs from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";
import { cuid, loadFileStore, saveFileStore, type HelpImageRow } from "@/lib/store";

/**
 * Screenshot & image storage abstraction for the Help Centre.
 *
 * Storage strategy (never stores large image blobs in article text fields):
 * 1. If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured, stores
 *    binary objects in Supabase Storage (`HELP_STORAGE_BUCKET`, default `help-centre-images`).
 * 2. Otherwise, when PostgreSQL (Prisma) is active, stores binary bytes in the
 *    dedicated `HelpImage.data` (`BYTEA`) table, served via `/api/help/images/[id]`.
 * 3. In local development without Postgres, stores files on disk in `data/help-images/`.
 */

export const MAX_HELP_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export const ALLOWED_IMAGE_MIME_TYPES: ReadonlyMap<string, string> = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

function localImagesDir(): string {
  if (process.env.TEST_STORE_FILE?.trim()) {
    return path.join(path.dirname(process.env.TEST_STORE_FILE.trim()), "help-images");
  }
  return path.join(process.cwd(), "data", "help-images");
}

function getSupabaseStorageConfig(): { url: string; serviceKey: string; bucket: string } | null {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;
  const bucket = process.env.HELP_STORAGE_BUCKET?.trim() || "help-centre-images";
  return { url, serviceKey, bucket };
}

function sanitizeFilename(name: string, ext: string): string {
  const base = path
    .basename(name || `screenshot.${ext}`)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  if (!base) return `screenshot.${ext}`;
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

export type StoredHelpImageDTO = {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: string;
  altText: string;
  caption: string;
  uploadedBy: string;
  createdAt: string;
};

function toImageDto(row: {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: string;
  altText: string;
  caption: string;
  uploadedBy: string;
  createdAt: Date | string;
}): StoredHelpImageDTO {
  return {
    id: row.id,
    url: `/api/help/images/${row.id}`,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    storageProvider: row.storageProvider,
    altText: row.altText,
    caption: row.caption,
    uploadedBy: row.uploadedBy,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString(),
  };
}

export async function uploadHelpImage(
  prisma: PrismaClient | null,
  input: {
    buffer: Buffer;
    mimeType: string;
    originalFilename: string;
    altText?: string;
    caption?: string;
    uploadedBy: string;
  },
): Promise<{ ok: true; image: StoredHelpImageDTO } | { ok: false; error: string; status: number }> {
  const mime = input.mimeType.trim().toLowerCase();
  const ext = ALLOWED_IMAGE_MIME_TYPES.get(mime);
  if (!ext) {
    return {
      ok: false,
      error: "Unsupported image format. Upload a PNG, JPG, WebP, or GIF image.",
      status: 400,
    };
  }
  if (!input.buffer.length) {
    return { ok: false, error: "The uploaded image file is empty.", status: 400 };
  }
  if (input.buffer.length > MAX_HELP_IMAGE_BYTES) {
    return {
      ok: false,
      error: "Image is too large. Maximum allowed size is 5 MB.",
      status: 400,
    };
  }

  const filename = sanitizeFilename(input.originalFilename, ext);
  const altText = String(input.altText ?? "").trim().slice(0, 300);
  const caption = String(input.caption ?? "").trim().slice(0, 500);
  const id = cuid();

  // Attempt Supabase Storage when configured
  const supa = getSupabaseStorageConfig();
  let storageProvider: "supabase" | "database" | "local" = prisma ? "database" : "local";
  let storagePath: string | null = null;

  if (supa) {
    const objectKey = `help/${id}.${ext}`;
    const uploadRes = await fetch(`${supa.url}/storage/v1/object/${supa.bucket}/${objectKey}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${supa.serviceKey}`,
        apikey: supa.serviceKey,
        "Content-Type": mime,
        "x-upsert": "true",
      },
      body: new Uint8Array(input.buffer),
    });
    if (uploadRes.ok) {
      storageProvider = "supabase";
      storagePath = objectKey;
    } else {
      // Fall back safely if bucket isn't provisioned yet
      storageProvider = prisma ? "database" : "local";
    }
  }

  if (storageProvider === "local") {
    const dir = localImagesDir();
    fs.mkdirSync(dir, { recursive: true });
    const fileKey = `${id}.${ext}`;
    fs.writeFileSync(path.join(dir, fileKey), input.buffer);
    storagePath = fileKey;
  }

  if (!prisma) {
    const store = loadFileStore();
    const row: HelpImageRow = {
      id,
      filename,
      mimeType: mime,
      sizeBytes: input.buffer.length,
      storageProvider,
      storagePath,
      altText,
      caption,
      uploadedBy: input.uploadedBy,
      createdAt: new Date().toISOString(),
    };
    store.helpImages = [...(store.helpImages ?? []), row];
    saveFileStore(store);
    return { ok: true, image: toImageDto(row) };
  }

  const created = await prisma.helpImage.create({
    data: {
      id,
      filename,
      mimeType: mime,
      sizeBytes: input.buffer.length,
      storageProvider,
      storagePath,
      data: storageProvider === "database" ? new Uint8Array(input.buffer) : null,
      altText,
      caption,
      uploadedBy: input.uploadedBy,
    },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      storageProvider: true,
      altText: true,
      caption: true,
      uploadedBy: true,
      createdAt: true,
    },
  });

  return { ok: true, image: toImageDto(created) };
}

export async function readHelpImageBinary(
  prisma: PrismaClient | null,
  id: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
  if (!prisma) {
    const store = loadFileStore();
    const meta = (store.helpImages ?? []).find((x) => x.id === id);
    if (!meta) return null;
    if (meta.storageProvider === "supabase" && meta.storagePath) {
      const supa = getSupabaseStorageConfig();
      if (!supa) return null;
      const r = await fetch(`${supa.url}/storage/v1/object/${supa.bucket}/${meta.storagePath}`, {
        headers: { Authorization: `Bearer ${supa.serviceKey}`, apikey: supa.serviceKey },
      });
      if (!r.ok) return null;
      return { buffer: Buffer.from(await r.arrayBuffer()), mimeType: meta.mimeType, filename: meta.filename };
    }
    if (!meta.storagePath) return null;
    const fp = path.join(localImagesDir(), path.basename(meta.storagePath));
    if (!fs.existsSync(fp)) return null;
    return { buffer: fs.readFileSync(fp), mimeType: meta.mimeType, filename: meta.filename };
  }

  const row = await prisma.helpImage.findUnique({ where: { id } });
  if (!row) return null;

  if (row.storageProvider === "supabase" && row.storagePath) {
    const supa = getSupabaseStorageConfig();
    if (!supa) return null;
    const r = await fetch(`${supa.url}/storage/v1/object/${supa.bucket}/${row.storagePath}`, {
      headers: { Authorization: `Bearer ${supa.serviceKey}`, apikey: supa.serviceKey },
    });
    if (!r.ok) return null;
    return { buffer: Buffer.from(await r.arrayBuffer()), mimeType: row.mimeType, filename: row.filename };
  }

  if (row.data) {
    return { buffer: Buffer.from(row.data), mimeType: row.mimeType, filename: row.filename };
  }
  return null;
}

export async function listHelpImages(prisma: PrismaClient | null): Promise<StoredHelpImageDTO[]> {
  if (!prisma) {
    const store = loadFileStore();
    return [...(store.helpImages ?? [])]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toImageDto);
  }
  const rows = await prisma.helpImage.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      storageProvider: true,
      altText: true,
      caption: true,
      uploadedBy: true,
      createdAt: true,
    },
  });
  return rows.map(toImageDto);
}

export async function deleteHelpImage(prisma: PrismaClient | null, id: string): Promise<boolean> {
  if (!prisma) {
    const store = loadFileStore();
    const meta = (store.helpImages ?? []).find((x) => x.id === id);
    if (!meta) return false;
    if (meta.storageProvider === "local" && meta.storagePath) {
      const fp = path.join(localImagesDir(), path.basename(meta.storagePath));
      if (fs.existsSync(fp)) {
        try { fs.unlinkSync(fp); } catch { /* ignore */ }
      }
    } else if (meta.storageProvider === "supabase" && meta.storagePath) {
      const supa = getSupabaseStorageConfig();
      if (supa) {
        await fetch(`${supa.url}/storage/v1/object/${supa.bucket}/${meta.storagePath}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${supa.serviceKey}`, apikey: supa.serviceKey },
        }).catch(() => null);
      }
    }
    store.helpImages = (store.helpImages ?? []).filter((x) => x.id !== id);
    saveFileStore(store);
    return true;
  }

  const row = await prisma.helpImage.findUnique({
    where: { id },
    select: { id: true, storageProvider: true, storagePath: true },
  });
  if (!row) return false;
  if (row.storageProvider === "supabase" && row.storagePath) {
    const supa = getSupabaseStorageConfig();
    if (supa) {
      await fetch(`${supa.url}/storage/v1/object/${supa.bucket}/${row.storagePath}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${supa.serviceKey}`, apikey: supa.serviceKey },
      }).catch(() => null);
    }
  }
  await prisma.helpImage.delete({ where: { id } });
  return true;
}
