/**
 * Admin sessions. Server-only.
 *
 * Logging in used to hand the browser ADMIN_PASSWORD itself, which then rode along
 * on every request — so any script that could read the page could read the
 * password, permanently, and every admin route was a place to guess it. Now the
 * password is checked once, at login, and what the browser keeps is a session:
 *
 *   v1.<expiry>.<nonce>.<HMAC>
 *
 * signed with a key derived from the password, in an httpOnly cookie script can't
 * read. It expires on its own, and changing the password ends every session at
 * once. Stateless on purpose: checking it costs no storage read.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

export const ADMIN_COOKIE = "po_admin";
/** Not a credential — only tells the shop's pages it is worth asking /api/admin-check. */
export const ADMIN_HINT_COOKIE = "po_admin_hint";
const SESSION_TTL_S = 12 * 60 * 60;

function signingKey(): Buffer | null {
  const pw = process.env.ADMIN_PASSWORD;
  return pw ? createHash("sha256").update(`printokay-admin-session\0${pw}`).digest() : null;
}

const sha = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time: the comparison takes as long whichever character is wrong. */
export function passwordMatches(given: unknown): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw || typeof given !== "string") return false;
  return timingSafeEqual(sha(given), sha(pw));
}

function sign(body: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(body).digest();
}

export function sessionValid(token: string | undefined): boolean {
  const key = signingKey();
  if (!key || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const given = Buffer.from(parts[3], "base64url");
  const expected = sign(parts.slice(0, 3).join("."), key);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const expiry = Number(parts[1]);
  return Number.isFinite(expiry) && expiry > Date.now() / 1000;
}

const cookieBase = {
  path: "/",
  sameSite: "strict" as const,
  // Plain http on localhost would refuse a Secure cookie in some browsers.
  secure: process.env.NODE_ENV === "production",
};

export function startSession(res: NextResponse): void {
  const key = signingKey();
  if (!key) throw new Error("ADMIN_PASSWORD mangler");
  const body = `v1.${Math.floor(Date.now() / 1000) + SESSION_TTL_S}.${randomBytes(16).toString("base64url")}`;
  const token = `${body}.${sign(body, key).toString("base64url")}`;
  res.cookies.set(ADMIN_COOKIE, token, { ...cookieBase, httpOnly: true, maxAge: SESSION_TTL_S });
  res.cookies.set(ADMIN_HINT_COOKIE, "1", { ...cookieBase, httpOnly: false, maxAge: SESSION_TTL_S });
}

export function endSession(res: NextResponse): void {
  res.cookies.set(ADMIN_COOKIE, "", { ...cookieBase, httpOnly: true, maxAge: 0 });
  res.cookies.set(ADMIN_HINT_COOKIE, "", { ...cookieBase, httpOnly: false, maxAge: 0 });
}

/**
 * Is this request from a logged-in admin?
 *
 * A cookie is sent by the browser on its own, so a cookie session is open to
 * cross-site request forgery where a header token was not. SameSite=Strict
 * already keeps the cookie off requests started by other sites; on top of that a
 * request that changes something must say it came from this site.
 */
export function isAdminRequest(req: NextRequest): boolean {
  if (!sessionValid(req.cookies.get(ADMIN_COOKIE)?.value)) return false;
  if (req.method === "GET" || req.method === "HEAD") return true;

  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  if (!origin) return true; // not a browser cross-site request; SameSite covers browsers
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}
