/**
 * Is the person looking at this page a logged-in admin? Client-safe.
 *
 * The session itself is an httpOnly cookie this code cannot read — that is the
 * point: a script injected into the page can't read it either. What can be read
 * is a hint cookie set beside it, which carries no authority; it only saves every
 * ordinary visitor a call to /api/admin-check. The server's answer is what counts.
 */
export function hasAdminHint(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((c) => c.trim() === "po_admin_hint=1");
}

/** Ask the server. The session cookie is sent along automatically. */
export async function checkAdmin(): Promise<boolean> {
  if (!hasAdminHint()) return false;
  try {
    return (await fetch("/api/admin-check")).ok;
  } catch {
    return false;
  }
}
