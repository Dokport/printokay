import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/isAdmin";

export async function GET(req: NextRequest) {
  if (isAdmin(req)) return NextResponse.json({ ok: true });
  return NextResponse.json({ ok: false }, { status: 401 });
}
