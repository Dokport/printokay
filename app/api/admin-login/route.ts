import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "ADMIN_PASSWORD er ikke sat i .env.local" }, { status: 500 });
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Forkert adgangskode" }, { status: 401 });
  }

  // Return a token the client stores in localStorage
  return NextResponse.json({ ok: true, token: process.env.ADMIN_PASSWORD });
}
