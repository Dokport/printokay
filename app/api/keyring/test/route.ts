/**
 * Admin-only: build a keyring file straight from a configurator state, with no
 * order, no Stripe and no cart. Used to test-print a shape before it goes live.
 *
 * The 3MF carries both filament colours and the filament change, so BambuStudio
 * slices it in two colours untouched. `format: "stl"` gives the plain single-colour
 * mesh instead, for when only the geometry matters.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/isAdmin";
import { generateKeyring3mf } from "@/lib/keyring3mf";
import { generateKeyringStl } from "@/lib/stl";
import { DEFAULT_KEYRING_SETTINGS, calcFontSize, type KeyringConfig } from "@/lib/keyring";
import { readJsonFile } from "@/lib/storage";
import type { SiteSettings } from "@/lib/settings";
import { joinTextLines } from "@/lib/textpaths";

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const font = typeof body.font === "string" ? body.font : "";
  const shapeType = typeof body.shapeType === "string" ? (body.shapeType as KeyringConfig["shapeType"]) : null;
  const sizeId = typeof body.sizeId === "string" ? body.sizeId : "";
  if (!text || !font || !shapeType || !sizeId) {
    return NextResponse.json(
      { error: "Manglende parametre: text, font, shapeType, sizeId" },
      { status: 400 }
    );
  }

  // Prefer the sizes the shop is actually selling, so a test print matches what a
  // customer would receive rather than the built-in defaults.
  let sizes = DEFAULT_KEYRING_SETTINGS.sizes;
  try {
    const stored = await readJsonFile<Partial<SiteSettings>>("settings.json", {});
    const saved = stored?.keyring?.sizes;
    if (saved?.length) sizes = saved;
  } catch { /* fall back to defaults */ }

  const size = sizes.find((s) => s.id === sizeId);
  if (!size) {
    return NextResponse.json(
      { error: `Ukendt størrelse "${sizeId}". Kendte: ${sizes.map((s) => s.id).join(", ")}` },
      { status: 400 }
    );
  }

  const config: KeyringConfig = {
    text,
    font,
    shapeType,
    holePosition: body.holePosition === "side" ? "side" : "top",
    sizeId,
    baseFilamentId: "",
    textFilamentId: "",
    fontSize:
      typeof body.fontSize === "number" && body.fontSize > 0
        ? body.fontSize
        : (calcFontSize(text, font, size) ?? 0),
  };

  const hex = (v: unknown, fallback: string) =>
    typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
  const baseColorHex = hex(body.baseColorHex, "#000000");
  const textColorHex = hex(body.textColorHex, "#ffffff");

  const stlOnly = body.format === "stl";
  const safeText = joinTextLines(text, "-").replace(/[^a-zA-Z0-9æøåÆØÅ-]/g, "_").slice(0, 24) || "noglering";
  const filename = `test_${shapeType}_${config.holePosition}_${sizeId}_${safeText}.${stlOnly ? "stl" : "3mf"}`;

  try {
    const file = stlOnly
      ? await generateKeyringStl(config, size)
      : await generateKeyring3mf(config, size, baseColorHex, textColorHex);

    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": stlOnly ? "model/stl" : "model/3mf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Testfil-generering fejlede:", err);
    return NextResponse.json(
      { error: "Generering fejlede", details: String(err) },
      { status: 500 }
    );
  }
}
