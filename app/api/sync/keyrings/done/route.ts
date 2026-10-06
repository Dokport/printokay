/**
 * Mark a keyring as synced to Bambuddy (sync-token auth). The sidecar sends the
 * uploaded file's id after putting the 3MF into the "Nøgleringe" folder.
 *   Body: { stlId, bambuddy: { fileId, folderId } }
 */
import { NextRequest, NextResponse } from "next/server";
import { mutateOrders } from "@/lib/orders";
import { KEYRING_3MF_VERSION } from "@/lib/keyring3mf";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

export async function POST(req: NextRequest) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { stlId, bambuddy } = await req.json();
  if (!stlId) {
    return NextResponse.json({ error: "stlId påkrævet" }, { status: 400 });
  }

  // Through mutateOrders, not read-then-write: a new order landing while this
  // runs would otherwise be overwritten by the copy read here.
  const syncedAt = new Date().toISOString();
  const found = await mutateOrders((orders) => {
    let hit = false;
    for (const o of orders) {
      for (const it of o.items) {
        const k = it.keyring;
        if (k && k.stlId === stlId) {
          k.bambuddySyncedAt = syncedAt;
          k.bambuddyFormatVersion = KEYRING_3MF_VERSION;
          if (bambuddy?.fileId != null) k.bambuddyFileId = String(bambuddy.fileId);
          if (bambuddy?.folderId != null) k.bambuddyFolderId = String(bambuddy.folderId);
          hit = true;
        }
      }
    }
    return { result: hit, changed: hit };
  });

  if (!found) {
    return NextResponse.json({ error: "Nøglering ikke fundet" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
