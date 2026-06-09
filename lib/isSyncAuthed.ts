import { NextRequest } from "next/server";

/**
 * Auth for the Bambuddy sync endpoints (`/api/sync/*`).
 *
 * Uses a dedicated token (`SYNC_TOKEN`) — separate from the admin password — so
 * the long-lived home-server sidecar has its own credential that can be rotated
 * independently and only grants access to the sync endpoints, nothing else.
 */
export function isSyncAuthed(req: NextRequest): boolean {
  const header = req.headers.get("x-sync-token");
  const token = process.env.SYNC_TOKEN;
  return !!(token && header === token);
}
