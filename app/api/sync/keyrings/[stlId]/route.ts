/**
 * Serve a keyring's 2-colour 3MF to the home-server sidecar (sync-token auth), so it
 * can upload it to Bambuddy. Regenerates on the fly from the order's stored config if
 * the file isn't cached yet.
 */
import { NextRequest, NextResponse } from "next/server";
import { readOrders, read3mf, save3mf, type OrderItemKeyring } from "@/lib/orders";
import { generateKeyring3mf } from "@/lib/keyring3mf";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ stlId: string }> }
) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { stlId } = await params;

  let file = await read3mf(stlId);
  if (!file) {
    const orders = await readOrders();
    let keyring: OrderItemKeyring | undefined;
    for (const o of orders) {
      const item = o.items.find((it) => it.keyring?.stlId === stlId);
      if (item?.keyring) { keyring = item.keyring; break; }
    }
    if (!keyring) {
      return NextResponse.json({ error: "Nøglering ikke fundet" }, { status: 404 });
    }
    try {
      file = await generateKeyring3mf(keyring.config, keyring.size, keyring.baseColorHex, keyring.textColorHex);
      await save3mf(stlId, file);
    } catch (err) {
      console.error(`3MF generation failed for keyring ${stlId}:`, err);
      return NextResponse.json({ error: "Kunne ikke generere 3MF" }, { status: 500 });
    }
  }

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "model/3mf",
      "Content-Disposition": `attachment; filename="${stlId}.3mf"`,
    },
  });
}
