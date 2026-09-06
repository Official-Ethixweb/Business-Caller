/**
 * Shared WebAuthn (Face ID / Touch ID / Windows Hello) types and Relying
 * Party config, used by both the API routes and, for the type, the UI.
 *
 * Credentials are stored in the same Twilio Sync Service already used for
 * the Phone Book (see app/api/contacts/route.ts) - one more small shared
 * JSON document, no new infrastructure.
 */

export interface StoredCredential {
  /** Base64url credential ID, as returned by the browser. */
  id: string;
  /** Base64-encoded (standard, not url-safe) COSE public key bytes. */
  publicKey: string;
  counter: number;
  transports?: string[];
  /** Human-readable label shown in the "manage devices" list, e.g. "Safari on Mac". */
  deviceLabel: string;
  createdAt: number;
}

/**
 * Derives the WebAuthn Relying Party ID (bare hostname, no scheme/port)
 * from PUBLIC_BASE_URL - the same env var already used to validate Twilio's
 * webhook signature, so no separate WebAuthn-specific env var is needed.
 * Returns null if PUBLIC_BASE_URL isn't set or isn't a valid URL.
 */
export function getRpID(): string | null {
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) return null;
  try {
    return new URL(base).hostname;
  } catch {
    return null;
  }
}

export function getExpectedOrigin(): string | null {
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) return null;
  return base.replace(/\/$/, "");
}

/** The subset of a stored credential that's safe to send to the browser -
 * never the public key bytes, which have no reason to leave the server. */
export interface PublicCredentialInfo {
  id: string;
  deviceLabel: string;
  createdAt: number;
}

export function toPublicCredentialInfo(c: StoredCredential): PublicCredentialInfo {
  return { id: c.id, deviceLabel: c.deviceLabel, createdAt: c.createdAt };
}
