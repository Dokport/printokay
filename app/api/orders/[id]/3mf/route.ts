/**
 * Admin-only endpoint: download the 2-colour 3MF for a keyring line item.
 *
 * The `id` path segment is the item's stlId. Unlike the STL, this 3MF has the two
 * filament colours + the filament change embedded, so BambuStudio slices it in two
 * colours with no manual filament change.
 *
 * If the file doesn't exist yet (e.g. an order placed before 3MF export existed), we
 * regenerate it on the fly from the order's stored keyring config and cache it.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/isAdmin";
import { readOrders, read3mf, save3mf, type OrderItemKeyring } from "@/lib/orders";
import { generateKeyring3mf } from "@/lib/keyring3mf";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { id: stlId } = await params;

  // Find the keyring item (needed for the filename, and to regenerate if missing).
  const orders = await readOrders();
  let keyring: OrderItemKeyring | undefined;
  for (const o of orders) {
    const item = o.items.find((it) => it.keyring?.stlId === stlId);
    if (item?.keyring) { keyring = item.keyring; break; }
  }

  let file = await read3mf(stlId);
  if (!file) {
    if (!keyring) {
      return NextResponse.json({ error: "3MF-fil ikke fundet" }, { status: 404 });
    }
    try {
      file = await generateKeyring3mf(
        keyring.config,
        keyring.size,
        keyring.baseColorHex,
        keyring.textColorHex
      );
      await save3mf(stlId, file); // cache for next time
    } catch (err) {
      console.error(`On-demand 3MF generation failed for ${stlId}:`, err);
      return NextResponse.json({ error: "Kunne ikke generere 3MF" }, { status: 500 });
    }
  }

  const text = keyring?.config.text ?? "noglering";
  const safeText = text.replace(/[^a-zA-Z0-9æøåÆØÅ]/g, "_").slice(0, 20);
  const filename = `${stlId}_${safeText}.3mf`;

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "model/3mf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
