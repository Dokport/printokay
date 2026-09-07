/**
 * Admin-only: build a fidget clicker straight from a configurator state, with no
 * order, no Stripe and no cart. Used to test-print a layout before it goes live —
 * the same hook the keyring has.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/isAdmin";
import { generateFidget3mf, generateFidgetTolerance3mf } from "@/lib/fidget3mf";
import { normalizeLabels, MAX_COLS, MAX_ROWS, type FidgetConfig } from "@/lib/fidget";
import { loadPricing } from "@/lib/pricing";

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

  // The stem tolerance comb: a row of caps with the cross slot cut a little wider
  // each time, for dialling in what this printer actually needs.
  if (body.tolerance) {
    const file = generateFidgetTolerance3mf(
      typeof body.capColorHex === "string" ? body.capColorHex : undefined,
      typeof body.textColorHex === "string" ? body.textColorHex : undefined
    );
    return fileResponse(file, "test_fidget_stem_tolerance.3mf");
  }

  const cols = Number(body.cols);
  const rows = Number(body.rows);
  if (!Number.isInteger(cols) || cols < 1 || cols > MAX_COLS ||
      !Number.isInteger(rows) || rows < 1 || rows > MAX_ROWS) {
    return NextResponse.json(
      { error: `cols skal være 1–${MAX_COLS} og rows 1–${MAX_ROWS}` },
      { status: 400 }
    );
  }

  const hex = (v: unknown, fallback: string) =>
    typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;

  const config: FidgetConfig = {
    cols, rows,
    labels: Array.isArray(body.labels) ? body.labels.map((l) => String(l ?? "")) : [],
    keyring: !!body.keyring,
    boxFilamentId: "", capFilamentId: "", textFilamentId: "",
  };

  // The calibrated slot width lives in settings, so a test print matches what a
  // customer would receive rather than the built-in default.
  let crossWidthMm: number | undefined;
  try {
    crossWidthMm = (await loadPricing()).settings.fidget?.crossWidthMm;
  } catch { /* fall back to the default */ }

  try {
    const { file } = generateFidget3mf(
      config,
      {
        box: hex(body.boxColorHex, "#1f2937"),
        cap: hex(body.capColorHex, "#f3f4f6"),
        text: hex(body.textColorHex, "#dc2626"),
      },
      crossWidthMm
    );
    const labels = normalizeLabels(config).filter(Boolean).join("-").replace(/[^A-Za-z0-9ÆØÅæøå-]/g, "_");
    return fileResponse(file, `test_fidget_${cols}x${rows}${labels ? `_${labels}` : ""}.3mf`.slice(0, 90));
  } catch (err) {
    console.error("Fidget-testfil fejlede:", err);
    return NextResponse.json({ error: "Generering fejlede", details: String(err) }, { status: 500 });
  }
}

function fileResponse(file: Buffer, filename: string): NextResponse {
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "model/3mf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
