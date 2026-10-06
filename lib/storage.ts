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

import { put, get, del, head, BlobNotFoundError } from "@vercel/blob";
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
 * Read, change and write back a shared JSON file without losing anyone else's
 * change made in between.
 *
 * Several things save the same file — a new order, the admin marking it printed,
 * the printer sidecar marking it synced — and a plain read-then-write lets the
 * slower writer silently overwrite the faster one. Here the write only lands if
 * the file is still the version that was read (its ETag); otherwise it is read
 * again and `mutate` re-applied to the fresh copy. So `mutate` must be a pure
 * function of what it is given: it can run more than once.
 *
 * Unlike readJsonFile, a failed read is an ERROR, never "the file is empty" —
 * treating a network hiccup as an empty order list and saving that would wipe
 * every order. Only a missing file starts from `fallback`.
 *
 * `mutate` may return null to say "nothing to change", which skips the write.
 */
export async function updateJsonFile<T>(
  filename: string,
  fallback: T,
  mutate: (current: T) => T | null | Promise<T | null>
): Promise<T> {
  if (!useBlob) return updateLocalJsonFile(filename, fallback, mutate);

  const writePlain = async (next: T, why: string, err?: unknown) => {
    console.warn(`[updateJsonFile] ${filename}: ${why} — skriver uden betingelse`, err ?? "");
    await put(filename, JSON.stringify(next, null, 2), {
      access: "private",
      contentType: "application/json",
      allowOverwrite: true,
    });
    return next;
  };

  for (let attempt = 0; ; attempt++) {
    // The ETag must come from head(), which asks the Blob API — the same place the
    // conditional write is checked. get() reports the ETag of the DOWNLOAD instead,
    // a different value that never matches; using it failed every save.
    //
    // And it must be taken BEFORE the content is read. If someone writes in
    // between, the content is then newer than the ETag and the write fails and
    // retries; the other order would let a newer ETag bless stale content.
    let etag: string | null;
    try {
      etag = await apiEtag(filename);
    } catch (err) {
      // Can't learn the version: do it the old way (minus treating a failed read
      // as empty, which is the one thing that must never come back).
      const next = await mutate(await readStrict(filename, fallback));
      return next === null ? fallback : writePlain(next, "kunne ikke slå version op", err);
    }

    const current = await readStrict(filename, fallback);
    const next = await mutate(current);
    if (next === null) return current;

    try {
      await put(filename, JSON.stringify(next, null, 2), {
        access: "private",
        contentType: "application/json",
        ...(etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false }),
      });
      return next;
    } catch (err) {
      // Did anyone actually write in between? Only then is this a lost race worth
      // retrying. A refusal while the file is still exactly the version we read
      // means the condition itself can't be trusted, and every retry would fail
      // the same way — so degrade to the old behaviour rather than fail the save.
      const now = await apiEtag(filename).catch(() => undefined);
      const someoneWrote = now !== undefined && now !== etag;
      if (!someoneWrote) return writePlain(next, "betinget skrivning afvist uden samtidig ændring", err);
      if (attempt >= 9) return writePlain(next, "blev ved med at kollidere", err);
      // Back off with jitter so two writers that collided don't collide again.
      await new Promise((r) => setTimeout(r, 25 * 2 ** Math.min(attempt, 5) * (0.5 + Math.random())));
    }
  }
}

/** The blob's version as the Blob API sees it, or null if there is no such blob. */
async function apiEtag(filename: string): Promise<string | null> {
  try {
    return (await head(filename)).etag || null;
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
}

/** Like readJsonFile, but a failed read throws instead of looking like an empty file. */
async function readStrict<T>(filename: string, fallback: T): Promise<T> {
  const result = await get(filename, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return fallback;
  return JSON.parse(await new Response(result.stream).text()) as T;
}

/** Local dev is one process: serialise writers per file instead. */
const localQueues = new Map<string, Promise<unknown>>();

function updateLocalJsonFile<T>(
  filename: string,
  fallback: T,
  mutate: (current: T) => T | null | Promise<T | null>
): Promise<T> {
  const run = async (): Promise<T> => {
    const filePath = path.join(process.cwd(), "data", filename);
    let current = fallback;
    try {
      current = JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const next = await mutate(current);
    if (next === null) return current;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2));
    return next;
  };
  const queued = (localQueues.get(filename) ?? Promise.resolve()).then(run, run);
  localQueues.set(filename, queued.catch(() => undefined));
  return queued;
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
