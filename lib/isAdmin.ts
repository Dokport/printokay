import { NextRequest } from "next/server";

export function isAdmin(req: NextRequest): boolean {
  const header = req.headers.get("x-admin-token");
  const cookie = req.cookies.get("admin_session")?.value;
  const pw = process.env.ADMIN_PASSWORD;
  return !!(pw && (header === pw || cookie === pw));
}
