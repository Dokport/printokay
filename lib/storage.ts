/**
 * Isomorphic storage layer.
 *
 * - On Vercel (BLOB_READ_WRITE_TOKEN set): reads/writes JSON files to Vercel Blob.
 * - Locally (no token): reads/writes from/to the local `data/` directory.
 *
 * All functions are async so callers work the same way in both environments.
 */

import { put, list } from "@vercel/blob";
import fs from "fs";
import path from "path";

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

// ─── JSON files ───────────────────────────────────────────────────────────────

export async function readJsonFile<T>(filename: string, fallback: T): Promise<T> {
  if (useBlob) {
    try {
      const { blobs } = await list({ prefix: filename });
      const blob = blobs.find((b) => b.pathname === filename);
      if (!blob) return fallback;
      const res = await fetch(blob.url, { cache: "no-store" });
      if (!res.ok) return fallback;
      return (await res.json()) as T;
    } catch {
      return fallback;
    }
  }
  // Local filesystem
  try {
    const filePath = path.join(process.cwd(), "data", filename);
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile<T>(filename: string, data: T): Promise<void> {
  if (useBlob) {
    await put(filename, JSON.stringify(data, null, 2), {
      access: "public",
      contentType: "application/json",
      allowOverwrite: true,
    });
    return;
  }
  // Local filesystem
  const filePath = path.join(process.cwd(), "data", filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ─── Binary files (e.g. STL) ──────────────────────────────────────────────────

export async function writeBinaryFile(filename: string, data: Buffer): Promise<string> {
  if (useBlob) {
    const blob = await put(filename, data, {
      access: "public",
      allowOverwrite: true,
    });
    return blob.url;
  }
  // Local filesystem
  const filePath = path.join(process.cwd(), "data", filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
  return filePath;
}

export async function readBinaryFile(filename: string): Promise<Buffer | null> {
  if (useBlob) {
    try {
      const { blobs } = await list({ prefix: filename });
      const blob = blobs.find((b) => b.pathname === filename);
      if (!blob) return null;
      const res = await fetch(blob.url);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
  // Local filesystem
  try {
    const filePath = path.join(process.cwd(), "data", filename);
    return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  } catch {
    return null;
  }
}
