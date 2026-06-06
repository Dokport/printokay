// This endpoint is deprecated — use /api/orders/[id]/stl instead.
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  _ctx: { params: Promise<{ id: string }> }
) {
  return NextResponse.json(
    { error: "G-code eksport er ikke længere understøttet. Brug /api/orders/[id]/stl i stedet." },
    { status: 410 }
  );
}
