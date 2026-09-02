/**
 * Admin: list, create, email and delete promo codes.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/isAdmin";
import {
  readPromos, createPromos, deletePromo, markPromoSent, promoStatus,
} from "@/lib/promos";
import { sendPromoCodeEmail } from "@/lib/email";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  const promos = await readPromos();
  return NextResponse.json(
    promos.map((p) => ({ ...p, status: promoStatus(p) })),
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const emails: string[] = Array.isArray(body.emails)
    ? body.emails.map((e: unknown) => String(e).trim()).filter(Boolean)
    : [];
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const expiresAt = typeof body.expiresAt === "string" && body.expiresAt ? body.expiresAt : undefined;

  // One code per recipient when emailing; otherwise however many were asked for.
  const count = emails.length > 0 ? emails.length : Math.max(1, Math.min(Number(body.count) || 1, 50));
  const created = await createPromos(count, { note, expiresAt });

  // Email is best-effort and per-recipient: one bad address must not lose the
  // other codes, which are already saved and usable by hand.
  const sent: string[] = [];
  const failed: { email: string; reason: string }[] = [];
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const promo = created[i];
    try {
      await sendPromoCodeEmail(promo.code, email, promo.expiresAt);
      await markPromoSent(promo.code, email);
      sent.push(email);
    } catch (err) {
      failed.push({ email, reason: String(err) });
      console.error(`Promokode-mail til ${email} fejlede:`, err);
    }
  }

  return NextResponse.json({ created, sent, failed });
}

export async function DELETE(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  const code = new URL(req.url).searchParams.get("code") ?? "";
  const ok = await deletePromo(code);
  if (!ok) {
    return NextResponse.json(
      { error: "Kunne ikke slettes — koden findes ikke, eller den er allerede brugt." },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true });
}
