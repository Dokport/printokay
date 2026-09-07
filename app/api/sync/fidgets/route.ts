/**
 * Fidget sync state for the home-server sidecar (sync-token auth).
 *
 * Same shape as the keyring list: the fidgets from orders whose 3MF hasn't reached
 * Bambuddy yet. Once synced they carry a bambuddySyncedAt and drop off, so a steady
 * loop does no work.
 */
import { NextRequest, NextResponse } from "next/server";
import { readOrders } from "@/lib/orders";
import { FIDGET_3MF_VERSION } from "@/lib/fidget3mf";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

export async function GET(req: NextRequest) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const orders = await readOrders();
  const toUpload = orders.flatMap((o) =>
    o.items
      .filter((it) => it.fidget && (!it.fidget.bambuddySyncedAt || it.fidget.bambuddyFormatVersion !== FIDGET_3MF_VERSION))
      .map((it) => {
        const f = it.fidget!;
        const written = f.labels.filter(Boolean).join(" ");
        return {
          fileId: f.fileId,
          name: `Fidget ${f.cols}x${f.rows}${written ? ` ${written}` : ""}`,
          orderId: o.id,
          folder: "Fidgets",
          downloadPath: `/api/sync/fidgets/${encodeURIComponent(f.fileId)}`,
          oldFileId: f.bambuddySyncedAt ? f.bambuddyFileId ?? null : null,
          version: FIDGET_3MF_VERSION,
        };
      })
  );

  return NextResponse.json(toUpload, { headers: { "Cache-Control": "no-store" } });
}
