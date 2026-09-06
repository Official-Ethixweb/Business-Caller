import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { verifyAccessCode } from "@/lib/auth";
import { getRpID } from "@/lib/webauthn";
import { getWebAuthnClient, readCredentials } from "@/lib/webauthnStore";

export const runtime = "nodejs";

const IP_RATE_LIMIT = 20;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_SYNC_SERVICE_SID",
  "APP_ACCESS_CODE",
  "PUBLIC_BASE_URL",
] as const;

// Registering a new Face ID / Touch ID credential requires the real access
// code first - otherwise anyone who found the URL could register their own
// face/fingerprint as a permanent backdoor. This is the only gate; once
// registered, the credential itself is what proves identity from then on.
export async function POST(req: Request) {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[api/webauthn/register-options] Missing required environment variable: ${key}`);
      return NextResponse.json(
        { error: "Server misconfiguration. Please contact the administrator." },
        { status: 500 },
      );
    }
  }

  const ip = getClientIp(req);
  const limit = rateLimit(`webauthn-reg-opts:${ip}`, IP_RATE_LIMIT, IP_RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a few minutes and try again." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(limit.retryAfterMs / 1000).toString() },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const fields = (body ?? {}) as Record<string, unknown>;
  const accessCode = typeof fields.accessCode === "string" ? fields.accessCode : "";
  if (!accessCode || !verifyAccessCode(accessCode, process.env.APP_ACCESS_CODE!)) {
    return NextResponse.json({ error: "Invalid access code." }, { status: 401 });
  }

  const rpID = getRpID();
  if (!rpID) {
    return NextResponse.json(
      { error: "Server misconfiguration: PUBLIC_BASE_URL is not a valid URL." },
      { status: 500 },
    );
  }

  const client = getWebAuthnClient();
  const existing = await readCredentials(client);

  const options = await generateRegistrationOptions({
    rpName: "Business Caller",
    rpID,
    userName: "amar-dialer",
    userDisplayName: "Business Caller",
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  return NextResponse.json({ options });
}
