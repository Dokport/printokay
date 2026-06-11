/**
 * Mark a product as synced to Bambuddy (sync-token auth).
 *
 * New flow (Bambuddy Projects): the sidecar created a Project + linked folder and
 * uploaded both files, and sends the resulting ids.
 *   Body: { productId, bambuddy: { projectId, folderId, projectFileId, printFileId } }
 *
 * Legacy flow (single-file upload) still supported for back-compat:
 *   Body: { productId, bambuddyId }
 */
import { NextRequest, NextResponse } from "next/server";
import { Product } from "@/lib/products";
import { readJsonFile, writeJsonFile } from "@/lib/storage";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

export async function POST(req: NextRequest) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { productId, bambuddy, bambuddyId } = await req.json();
  if (!productId) {
    return NextResponse.json({ error: "productId påkrævet" }, { status: 400 });
  }

  const products = await readJsonFile<Product[]>("products.json", []);
  const idx = products.findIndex((p) => p.id === productId);
  if (idx === -1) {
    return NextResponse.json({ error: "Produkt ikke fundet" }, { status: 404 });
  }

  const now = new Date().toISOString();

  if (bambuddy && typeof bambuddy === "object") {
    const link = {
      ...(bambuddy.projectId != null ? { projectId: String(bambuddy.projectId) } : {}),
      ...(bambuddy.folderId != null ? { folderId: String(bambuddy.folderId) } : {}),
      ...(bambuddy.projectFileId != null ? { projectFileId: String(bambuddy.projectFileId) } : {}),
      ...(bambuddy.printFileId != null ? { printFileId: String(bambuddy.printFileId) } : {}),
      syncedAt: now,
    };
    products[idx] = {
      ...products[idx],
      bambuddy: link,
      modelSyncedAt: now,
      // Keep legacy id pointing at the sliced file so stats fetch still works.
      ...(link.printFileId ? { bambuddyId: link.printFileId } : link.projectFileId ? { bambuddyId: link.projectFileId } : {}),
    };
  } else {
    // Legacy single-file path.
    products[idx] = {
      ...products[idx],
      modelSyncedAt: now,
      ...(bambuddyId ? { bambuddyId: String(bambuddyId) } : {}),
    };
  }

  await writeJsonFile("products.json", products);
  return NextResponse.json({ ok: true });
}
