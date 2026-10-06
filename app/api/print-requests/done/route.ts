/**
 * Mark a print-request as handled by the sidecar (sync-token auth).
 * Body: { requestId, status: "done" | "failed", error? }
 */
import { NextRequest, NextResponse } from "next/server";
import { PrintRequest } from "@/lib/products";
import { updateJsonFile } from "@/lib/storage";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

const FILE = "print-requests.json";

export async function POST(req: NextRequest) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { requestId, status, error } = await req.json();
  if (!requestId) {
    return NextResponse.json({ error: "requestId påkrævet" }, { status: 400 });
  }

  const handledAt = new Date().toISOString();
  let found = false;
  await updateJsonFile<PrintRequest[]>(FILE, [], (requests) => {
    const idx = requests.findIndex((r) => r.id === requestId);
    found = idx !== -1;
    if (!found) return null;
    requests[idx] = {
      ...requests[idx],
      status: status === "failed" ? "failed" : "done",
      handledAt,
      ...(error ? { error: String(error).slice(0, 300) } : {}),
    };
    return requests;
  });
  if (!found) return NextResponse.json({ error: "Request ikke fundet" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
