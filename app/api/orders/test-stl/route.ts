/**
 * Admin-only test endpoint: generate a keyring STL without going through Stripe.
 * Returns a ZIP file containing base.stl + text.stl + README.txt.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/isAdmin";
import { generateKeyringStl } from "@/lib/stl";
import type { KeyringConfig, KeyringSizeOption } from "@/lib/keyring";
import { DEFAULT_KEYRING_SETTINGS } from "@/lib/keyring";
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

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      text,
      font,
      shapeType,
      sizeId,
      fontSize,
    } = body;

    if (!text || !font || !shapeType || !sizeId) {
      return NextResponse.json({ error: "Manglende parametre: text, font, shapeType, sizeId" }, { status: 400 });
    }

    const config: KeyringConfig = {
      text,
      font,
      shapeType,
      sizeId,
      baseFilamentId: "",
      textFilamentId: "",
      fontSize: fontSize ?? 0,
    };

    const size: KeyringSizeOption =
      DEFAULT_KEYRING_SETTINGS.sizes.find((s) => s.id === sizeId) ??
      DEFAULT_KEYRING_SETTINGS.sizes[1]; // medium fallback

    const { baseStl, textStl } = await generateKeyringStl(config, size);

    const zip = new JSZip();
    zip.file("base.stl", baseStl);
    zip.file("text.stl", textStl);
    zip.file("README.txt", README);

    const zipBuffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

    const safeText = text.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 20);
    const filename = `test_noglering_${safeText}.zip`;

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("Test STL generation error:", err);
    return NextResponse.json(
      { error: "STL-generering fejlede", details: String(err) },
      { status: 500 }
    );
  }
}
