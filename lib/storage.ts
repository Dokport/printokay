/**
 * Isomorphic storage layer.
 *
 * - On Vercel (BLOB_READ_WRITE_TOKEN set): reads/writes files to Vercel Blob.
 * - Locally (no token): reads/writes from/to the local `data/` directory.
 *
 * The Vercel Blob store is configured with **private** access, so we use
 * `access: "private"` on writes and the authenticated `get()` helper on reads
 * (the public CDN URL is not fetchable on a private store). `useCache: false`
 * guarantees we always read the freshly-written content, never a stale CDN copy.
 *
 * All functions are async so callers work the same way in both environments.
 */

import { put, get, del } from "@vercel/blob";
import fs from "fs";
import path from "path";

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

// ─── JSON files ───────────────────────────────────────────────────────────────

export async function readJsonFile<T>(filename: string, fallback: T): Promise<T> {
  if (useBlob) {
    try {
      const result = await get(filename, { access: "private", useCache: false });
      if (!result || !result.stream) return fallback;
      const text = await new Response(result.stream).text();
      return JSON.parse(text) as T;
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
      access: "private",
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

/**
 * Create a JSON file only if it does not exist yet — atomically, so of several
 * callers racing for the same name exactly one gets `true`. This is the one
 * primitive here that can serve as a lock; read-then-write cannot.
 *
 * Blob reports "already exists" as a generic bad_request, so rather than match
 * on an error message the file is read back: there means someone else won,
 * missing means the write failed for a real reason and the error is rethrown.
 */
export async function createJsonFileIfAbsent<T>(filename: string, data: T): Promise<boolean> {
  if (useBlob) {
    try {
      await put(filename, JSON.stringify(data, null, 2), {
        access: "private",
        contentType: "application/json",
        allowOverwrite: false,
      });
      return true;
    } catch (err) {
      const existing = await readJsonFile<T | null>(filename, null);
      if (existing !== null) return false;
      throw err;
    }
  }
  const filePath = path.join(process.cwd(), "data", filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

/** Best-effort delete. Never throws — a lingering file is harmless. */
export async function deleteFile(filename: string): Promise<void> {
  try {
    if (useBlob) {
      await del(filename);
      return;
    }
    const filePath = path.join(process.cwd(), "data", filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

// ─── Binary files (e.g. STL) ──────────────────────────────────────────────────

export async function writeBinaryFile(filename: string, data: Buffer): Promise<string> {
  if (useBlob) {
    const blob = await put(filename, data, {
      access: "private",
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
      const result = await get(filename, { access: "private", useCache: false });
      if (!result || !result.stream) return null;
      const buf = await new Response(result.stream).arrayBuffer();
      return Buffer.from(buf);
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
