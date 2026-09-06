import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { getRpID } from "@/lib/webauthn";
import { getWebAuthnClient, readCredentials } from "@/lib/webauthnStore";

export const runtime = "nodejs";

const IP_RATE_LIMIT = 30;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_SYNC_SERVICE_SID",
  "PUBLIC_BASE_URL",
] as const;

// No access-code gate here - this is the pre-unlock path. Populating
// allowCredentials (with each credential's stored transports, e.g.
// "internal") is what lets the browser skip its full "how do you want to
// sign in" picker - QR code for another device, USB security key - and go
// straight to this device's Face ID/Touch ID/Windows Hello prompt. This
// does mean an unauthenticated caller can learn how many credentials are
// registered and their opaque IDs; those IDs are public identifiers that
// grant no ability to authenticate without the matching private key, which
// never leaves the authenticator, so this is a standard, low-risk tradeoff
// for the much better sign-in experience.
export async function POST(req: Request) {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[api/webauthn/login-options] Missing required environment variable: ${key}`);
      return NextResponse.json(
        { error: "Server misconfiguration. Please contact the administrator." },
        { status: 500 },
      );
    }
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

  const client = getWebAuthnClient();
  const stored = await readCredentials(client);

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: stored.map((c) => ({ id: c.id, transports: c.transports })),
  });

  return NextResponse.json({ options });
}
