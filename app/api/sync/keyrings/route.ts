/**
 * Keyring sync state for the home-server sidecar (sync-token auth).
 *
 * Returns the custom keyrings from orders whose 2-colour 3MF hasn't been uploaded to
 * Bambuddy yet — same idea as products, but sourced from orders.json. The sidecar
 * uploads each into a "Nøgleringe" folder and calls /done. Once synced (they carry a
 * bambuddySyncedAt) they drop off this list, so a steady loop does no work.
 */
import { NextRequest, NextResponse } from "next/server";
import { readOrders } from "@/lib/orders";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

export async function GET(req: NextRequest) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const orders = await readOrders();

  const toUpload = orders.flatMap((o) =>
    o.items
      .filter((it) => it.keyring && !it.keyring.bambuddySyncedAt)
      .map((it) => {
        const k = it.keyring!;
        const text = (k.config.text || "Nøglering").trim();
        return {
          stlId: k.stlId,
          // A human-readable Bambuddy filename: text, size and short order id.
          name: `${text} (${k.size.label})`,
          orderId: o.id,
          folder: "Nøgleringe",
          downloadPath: `/api/sync/keyrings/${encodeURIComponent(k.stlId)}`,
        };
      })
  );

  return NextResponse.json({ toUpload });
}
