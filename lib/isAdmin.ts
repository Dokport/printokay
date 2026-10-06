import { NextRequest } from "next/server";
import { isAdminRequest } from "./adminAuth";

/**
 * Admin check for API routes: a valid session cookie, set by /api/admin-login.
 * The password itself is no longer accepted here — only at login, where attempts
 * are limited.
 */
export function isAdmin(req: NextRequest): boolean {
  return isAdminRequest(req);
}
