/**
 * Limit password guesses at /api/admin-login. Server-only.
 *
 * Two counters over a 15-minute window: per address, so one guesser is stopped
 * after a handful of tries, and in total, so a guesser spreading over many
 * addresses is stopped too. The total lock also locks the real admin out for the
 * rest of the window — the price of not having the password guessed.
 *
 * Addresses are stored hashed, not in the clear. Failures are counted through
 * updateJsonFile, so parallel guesses can't overwrite each other's count back down.
 */
import { createHash } from "crypto";
import { readJsonFile, updateJsonFile } from "./storage";

const FILE = "login-attempts.json";
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_ADDRESS = 5;
const MAX_TOTAL = 30;

type Counter = { fails: number; since: number };
type Attempts = { byAddress: Record<string, Counter>; total: Counter };

const empty = (): Attempts => ({ byAddress: {}, total: { fails: 0, since: Date.now() } });
const live = (c: Counter | undefined, now: number) => !!c && now - c.since < WINDOW_MS;

function addressKey(ip: string): string {
  return createHash("sha256").update(`printokay-login\0${ip}`).digest("hex").slice(0, 24);
}

/** Seconds until another try is allowed, or 0 if it is allowed now. */
export async function loginRetryAfter(ip: string): Promise<number> {
  const a = await readJsonFile<Attempts>(FILE, empty());
  const now = Date.now();
  const mine = a.byAddress?.[addressKey(ip)];
  const blockedUntil = Math.max(
    live(mine, now) && mine!.fails >= MAX_PER_ADDRESS ? mine!.since + WINDOW_MS : 0,
    live(a.total, now) && a.total.fails >= MAX_TOTAL ? a.total.since + WINDOW_MS : 0
  );
  return blockedUntil > now ? Math.ceil((blockedUntil - now) / 1000) : 0;
}

export async function recordLoginFailure(ip: string): Promise<void> {
  const key = addressKey(ip);
  await updateJsonFile<Attempts>(FILE, empty(), (a) => {
    const now = Date.now();
    const byAddress: Record<string, Counter> = {};
    // Drop expired entries as we go, so the file can't grow without bound.
    for (const [k, c] of Object.entries(a.byAddress ?? {})) if (live(c, now)) byAddress[k] = c;
    const mine = byAddress[key];
    byAddress[key] = mine ? { fails: mine.fails + 1, since: mine.since } : { fails: 1, since: now };
    const total = live(a.total, now) ? { fails: a.total.fails + 1, since: a.total.since } : { fails: 1, since: now };
    return { byAddress, total };
  });
}

export async function recordLoginSuccess(ip: string): Promise<void> {
  const key = addressKey(ip);
  await updateJsonFile<Attempts>(FILE, empty(), (a) => {
    if (!a.byAddress?.[key]) return null;
    const byAddress = { ...a.byAddress };
    delete byAddress[key];
    return { ...a, byAddress };
  });
}

/** The caller's address as Vercel reports it (Vercel sets this header itself). */
export function clientIp(headers: Headers): string {
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}
