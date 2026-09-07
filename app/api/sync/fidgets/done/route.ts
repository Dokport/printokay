/**
 * Mark a fidget as synced to Bambuddy (sync-token auth).
 *   Body: { fileId, bambuddy: { fileId, folderId } }
 */
import { NextRequest, NextResponse } from "next/server";
import { readOrders, writeOrders } from "@/lib/orders";
import { FIDGET_3MF_VERSION } from "@/lib/fidget3mf";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

export async function POST(req: NextRequest) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { fileId, bambuddy } = await req.json();
  if (!fileId) {
    return NextResponse.json({ error: "fileId påkrævet" }, { status: 400 });
  }

  const orders = await readOrders();
  let found = false;
  for (const o of orders) {
    for (const it of o.items) {
      const f = it.fidget;
      if (f && f.fileId === fileId) {
        f.bambuddySyncedAt = new Date().toISOString();
        f.bambuddyFormatVersion = FIDGET_3MF_VERSION;
        if (bambuddy?.fileId != null) f.bambuddyFileId = String(bambuddy.fileId);
        if (bambuddy?.folderId != null) f.bambuddyFolderId = String(bambuddy.folderId);
        found = true;
      }
    }
  }

  if (!found) {
    return NextResponse.json({ error: "Fidget ikke fundet" }, { status: 404 });
  }

  await writeOrders(orders);
  return NextResponse.json({ ok: true });
}
