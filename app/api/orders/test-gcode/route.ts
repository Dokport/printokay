import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/isAdmin";
import { generateKeyringGcode } from "@/lib/gcode";
import { DEFAULT_KEYRING_SETTINGS } from "@/lib/keyring";
import type { KeyringConfig, KeyringSizeOption } from "@/lib/keyring";

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const body = await req.json();
  const {
    text = "Test",
    font = "Roboto-Bold",
    shapeType = "auto",
    sizeId = "medium",
    fontSize = 8,
    baseColorHex = "#7c3aed",
    textColorHex = "#ffffff",
    baseFilamentName = "Base",
    textFilamentName = "Tekst",
  } = body;

  const sizes: KeyringSizeOption[] = DEFAULT_KEYRING_SETTINGS.sizes;
  const size = sizes.find((s) => s.id === sizeId) ?? sizes[1];

  const config: KeyringConfig = {
    text,
    font,
    shapeType,
    sizeId,
    baseFilamentId: "test-base",
    textFilamentId: "test-text",
    fontSize,
  };

  try {
    const gcode = await generateKeyringGcode(
      config,
      size,
      baseColorHex,
      textColorHex,
      baseFilamentName,
      textFilamentName
    );

    const safeText = text.replace(/[^a-zA-Z0-9æøåÆØÅ]/g, "_").slice(0, 20);

    return new NextResponse(gcode, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="test_noglering_${safeText}.gcode"`,
      },
    });
  } catch (err) {
    console.error("G-code test generation failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
