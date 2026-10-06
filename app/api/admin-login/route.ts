import { NextRequest, NextResponse } from "next/server";
import { passwordMatches, startSession } from "@/lib/adminAuth";
import { clientIp, loginRetryAfter, recordLoginFailure, recordLoginSuccess } from "@/lib/loginThrottle";

/**
 * The one place the admin password is accepted. On success the browser gets a
 * session cookie — never the password back, which is what this used to return.
 */
export async function POST(req: NextRequest) {
  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Admin-login er ikke sat op" }, { status: 500 });
  }

  const ip = clientIp(req.headers);
  const wait = await loginRetryAfter(ip);
  if (wait > 0) {
    return NextResponse.json(
      { error: `For mange forsøg. Prøv igen om ${Math.ceil(wait / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(wait) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  if (!passwordMatches(body?.password)) {
    await recordLoginFailure(ip);
    return NextResponse.json({ error: "Forkert adgangskode" }, { status: 401 });
  }

  await recordLoginSuccess(ip);
  const res = NextResponse.json({ ok: true });
  startSession(res);
  return res;
}
