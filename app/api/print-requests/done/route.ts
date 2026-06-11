/**
 * Mark a print-request as handled by the sidecar (sync-token auth).
 * Body: { requestId, status: "done" | "failed", error? }
 */
import { NextRequest, NextResponse } from "next/server";
import { PrintRequest } from "@/lib/products";
import { readJsonFile, writeJsonFile } from "@/lib/storage";
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

  const requests = await readJsonFile<PrintRequest[]>(FILE, []);
  const idx = requests.findIndex((r) => r.id === requestId);
  if (idx === -1) {
    return NextResponse.json({ error: "Request ikke fundet" }, { status: 404 });
  }

  requests[idx] = {
    ...requests[idx],
    status: status === "failed" ? "failed" : "done",
    handledAt: new Date().toISOString(),
    ...(error ? { error: String(error).slice(0, 300) } : {}),
  };

  await writeJsonFile(FILE, requests);
  return NextResponse.json({ ok: true });
}
