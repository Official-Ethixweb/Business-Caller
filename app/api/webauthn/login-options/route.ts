import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { getRpID } from "@/lib/webauthn";

export const runtime = "nodejs";

const IP_RATE_LIMIT = 30;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;

// No access-code gate here - this is the pre-unlock path. Deliberately
// doesn't look up or reveal which credentials exist: allowCredentials is
// left unset so the browser resolves a matching discoverable passkey from
// its own local keychain purely by rpID, without the server disclosing
// anything about who's registered.
export async function POST(req: Request) {
  if (!process.env.PUBLIC_BASE_URL) {
    console.error("[api/webauthn/login-options] Missing required environment variable: PUBLIC_BASE_URL");
    return NextResponse.json(
      { error: "Server misconfiguration. Please contact the administrator." },
      { status: 500 },
    );
  }

  const ip = getClientIp(req);
  const limit = rateLimit(`webauthn-login-opts:${ip}`, IP_RATE_LIMIT, IP_RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a few minutes and try again." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(limit.retryAfterMs / 1000).toString() },
      },
    );
  }

  const rpID = getRpID();
  if (!rpID) {
    return NextResponse.json(
      { error: "Server misconfiguration: PUBLIC_BASE_URL is not a valid URL." },
      { status: 500 },
    );
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
  });

  return NextResponse.json({ options });
}
