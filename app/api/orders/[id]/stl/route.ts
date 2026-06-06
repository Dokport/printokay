/**
 * Admin-only endpoint: download the STL ZIP for a specific order.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/isAdmin";
import { readOrders, readStl } from "@/lib/orders";
import JSZip from "jszip";

const README = `PRINTOKAY — Nøglering STL-filer
================================

Importer i BambuStudio (multi-farve print):

1. Åbn BambuStudio → Klik "+ Tilføj" → Vælg base.stl
2. Højreklik på objektet i venstre panel → "Load as part" → Vælg text.stl
3. Klik på base-delen i panelet → Vælg Filament 1 (basis-farve)
4. Klik på tekst-delen → Vælg Filament 2 (tekst-farve)
5. Slic og print!

Printer: Bambu Lab X1 Carbon
Lag-højde: 0.2mm
Basis: 0–2.4mm (Filament 1)
Tekst: 2.4–3.0mm (Filament 2)

Genereret af printokay.dk
`;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { id } = await params;

  // Verify order exists
  const orders = readOrders();
  const order = orders.find((o) => o.id === id);
  if (!order) {
    return NextResponse.json({ error: "Ordre ikke fundet" }, { status: 404 });
  }

  // Read STL files
  const stlFiles = readStl(id);
  if (!stlFiles) {
    return NextResponse.json(
      { error: "STL-filer ikke fundet for denne ordre" },
      { status: 404 }
    );
  }

  const { baseStl, textStl } = stlFiles;

  const zip = new JSZip();
  zip.file("base.stl", baseStl);
  zip.file("text.stl", textStl);
  zip.file("README.txt", README);

  const zipBuffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

  const safeText = (order.config.text ?? "noglering")
    .replace(/[^a-zA-Z0-9æøåÆØÅ]/g, "_")
    .slice(0, 20);
  const filename = `${id}_${safeText}.zip`;

  return new NextResponse(new Uint8Array(zipBuffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
