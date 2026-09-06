import { NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { verifyAccessCode } from "@/lib/auth";
import { toPublicCredentialInfo } from "@/lib/webauthn";
import { getWebAuthnClient, readCredentials, writeCredentials } from "@/lib/webauthnStore";

export const runtime = "nodejs";

const IP_RATE_LIMIT = 30;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_SYNC_SERVICE_SID",
  "APP_ACCESS_CODE",
] as const;

async function requireAccessCode(
  req: Request,
  limitKey: string,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[api/webauthn/devices] Missing required environment variable: ${key}`);
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Server misconfiguration. Please contact the administrator." },
          { status: 500 },
        ),
      };
    }
  }

  const ip = getClientIp(req);
  const limit = rateLimit(limitKey + ip, IP_RATE_LIMIT, IP_RATE_WINDOW_MS);
  if (!limit.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Too many requests. Please wait a few minutes and try again." },
        {
          status: 429,
          headers: { "Retry-After": Math.ceil(limit.retryAfterMs / 1000).toString() },
        },
      ),
    };
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Invalid request body." }, { status: 400 }) };
  }

  const fields = (body ?? {}) as Record<string, unknown>;
  const accessCode = typeof fields.accessCode === "string" ? fields.accessCode : "";
  if (!accessCode || !verifyAccessCode(accessCode, process.env.APP_ACCESS_CODE!)) {
    return { ok: false, response: NextResponse.json({ error: "Invalid access code." }, { status: 401 }) };
  }

  return { ok: true, body: fields };
}

export async function POST(req: Request) {
  const auth = await requireAccessCode(req, "webauthn-devices-list:");
  if (!auth.ok) return auth.response;

  const client = getWebAuthnClient();
  const credentials = await readCredentials(client);
  return NextResponse.json({ devices: credentials.map(toPublicCredentialInfo) });
}

export async function DELETE(req: Request) {
  const auth = await requireAccessCode(req, "webauthn-devices-delete:");
  if (!auth.ok) return auth.response;

  const id = typeof auth.body.id === "string" ? auth.body.id : "";
  if (!id) {
    return NextResponse.json({ error: "Invalid device id." }, { status: 400 });
  }

  const client = getWebAuthnClient();
  const existing = await readCredentials(client);
  const next = existing.filter((c) => c.id !== id);
  await writeCredentials(client, next);

  return NextResponse.json({ devices: next.map(toPublicCredentialInfo) });
}
