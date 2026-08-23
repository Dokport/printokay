/**
 * Where the admin password lives in the browser. Client-safe (no next/server
 * imports), so both the admin page and the shop can read it without drifting apart.
 *
 * sessionStorage, not localStorage: the login dies with the tab. That means the
 * admin-only controls in the shop appear once you've navigated there from /admin
 * in the same tab.
 */
export const ADMIN_SESSION_KEY = "po_adm";

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(ADMIN_SESSION_KEY);
  } catch {
    return null;
  }
}
