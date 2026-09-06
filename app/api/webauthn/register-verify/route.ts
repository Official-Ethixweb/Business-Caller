import { NextResponse } from "next/server";
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { verifyAccessCode } from "@/lib/auth";
import { getRpID, getExpectedOrigin, toPublicCredentialInfo, type StoredCredential } from "@/lib/webauthn";
import { getWebAuthnClient, readCredentials, writeCredentials } from "@/lib/webauthnStore";

export const runtime = "nodejs";

const IP_RATE_LIMIT = 20;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;
const MAX_LABEL_LENGTH = 60;

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_SYNC_SERVICE_SID",
  "APP_ACCESS_CODE",
  "PUBLIC_BASE_URL",
] as const;

export async function POST(req: Request) {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[api/webauthn/register-verify] Missing required environment variable: ${key}`);
      return NextResponse.json(
        { error: "Server misconfiguration. Please contact the administrator." },
        { status: 500 },
      );
    }
  }

  const ip = getClientIp(req);
  const limit = rateLimit(`webauthn-reg-verify:${ip}`, IP_RATE_LIMIT, IP_RATE_WINDOW_MS);
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

  const response = fields.response as RegistrationResponseJSON | undefined;
  const expectedChallenge = typeof fields.expectedChallenge === "string" ? fields.expectedChallenge : "";
  const deviceLabel =
    typeof fields.deviceLabel === "string" && fields.deviceLabel.trim()
      ? fields.deviceLabel.trim().slice(0, MAX_LABEL_LENGTH)
      : "Unnamed device";

  if (!response || !expectedChallenge) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const rpID = getRpID();
  const origin = getExpectedOrigin();
  if (!rpID || !origin) {
    return NextResponse.json(
      { error: "Server misconfiguration: PUBLIC_BASE_URL is not a valid URL." },
      { status: 500 },
    );
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch (err) {
    console.error("[api/webauthn/register-verify] verification threw:", err);
    return NextResponse.json({ error: "Could not verify registration." }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "Registration could not be verified." }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  const stored: StoredCredential = {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64"),
    counter: credential.counter,
    transports: credential.transports,
    deviceLabel,
    createdAt: Date.now(),
  };

  const client = getWebAuthnClient();
  const existing = await readCredentials(client);
  const next = [...existing.filter((c) => c.id !== stored.id), stored];
  await writeCredentials(client, next);

  return NextResponse.json({ verified: true, devices: next.map(toPublicCredentialInfo) });
}
