/**
 * Admin-only test endpoint: generate a keyring STL without going through Stripe.
 * Returns the binary STL file directly.
 *
 * 2-color printing: in BambuStudio add a filament change at Z = 2.4mm.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/isAdmin";
import { generateKeyringStl } from "@/lib/stl";
import type { KeyringConfig, KeyringSizeOption } from "@/lib/keyring";
import { DEFAULT_KEYRING_SETTINGS } from "@/lib/keyring";

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { text, font, shapeType, sizeId, fontSize } = body;

    if (!text || !font || !shapeType || !sizeId) {
      return NextResponse.json(
        { error: "Manglende parametre: text, font, shapeType, sizeId" },
        { status: 400 }
      );
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
      DEFAULT_KEYRING_SETTINGS.sizes[1];

    const stl = await generateKeyringStl(config, size);

    const safeText = text.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 20);
    const filename = `test_noglering_${safeText}.stl`;

    return new NextResponse(new Uint8Array(stl), {
      headers: {
        "Content-Type": "model/stl",
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
