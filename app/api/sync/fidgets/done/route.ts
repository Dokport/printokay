/**
 * Mark a fidget as synced to Bambuddy (sync-token auth).
 *   Body: { fileId, bambuddy: { fileId, folderId } }
 */
import { NextRequest, NextResponse } from "next/server";
import { mutateOrders } from "@/lib/orders";
import { FIDGET_3MF_VERSION } from "@/lib/fidget3mf";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

export async function POST(req: NextRequest) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { fileId, bambuddy } = await req.json().catch(() => ({}));
  if (!fileId) {
    return NextResponse.json({ error: "fileId påkrævet" }, { status: 400 });
  }

  // Through mutateOrders, not read-then-write: a new order landing while this
  // runs would otherwise be overwritten by the copy read here.
  const syncedAt = new Date().toISOString();
  const found = await mutateOrders((orders) => {
    let hit = false;
    for (const o of orders) {
      for (const it of o.items) {
        const f = it.fidget;
        if (f && f.fileId === fileId) {
          f.bambuddySyncedAt = syncedAt;
          f.bambuddyFormatVersion = FIDGET_3MF_VERSION;
          if (bambuddy?.fileId != null) f.bambuddyFileId = String(bambuddy.fileId);
          if (bambuddy?.folderId != null) f.bambuddyFolderId = String(bambuddy.folderId);
          hit = true;
        }
      }
    }
    return { result: hit, changed: hit };
  });

  if (!found) {
    return NextResponse.json({ error: "Fidget ikke fundet" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
