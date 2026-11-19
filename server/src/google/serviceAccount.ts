import { createSign } from "crypto";
import { readFileSync } from "fs";

/**
 * A Google Cloud service account: a robot Google identity with its own email
 * (…@….iam.gserviceaccount.com). Share a Drive file (the school calendar
 * sheet) with that email and the app can read that file, and only files
 * shared with it, without anyone's personal Google sign-in.
 *
 * Configure with GOOGLE_SERVICE_ACCOUNT_KEY_FILE (path to the downloaded JSON
 * key) or GOOGLE_SERVICE_ACCOUNT_JSON (the JSON itself, or base64 of it, for
 * cloud hosts). Read-only Drive access.
 */
export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

export function serviceAccountKey(): ServiceAccountKey | null {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.trim();
  let text = inline || (file ? readFileSync(file, "utf8") : "");
  if (!text) return null;
  if (!text.startsWith("{")) text = Buffer.from(text, "base64").toString("utf8");
  const key = JSON.parse(text) as ServiceAccountKey;
  if (!key.client_email || !key.private_key) throw new Error("The Google service account key is missing client_email or private_key.");
  return key;
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** The signed request Google's token endpoint expects (JWT bearer grant). */
export function signedAssertion(key: ServiceAccountKey, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: key.token_uri || DEFAULT_TOKEN_URI, iat: nowSeconds, exp: nowSeconds + 3600 })
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(key.private_key);
  return `${header}.${claims}.${base64url(signature)}`;
}

let cached: { email: string; token: string; expiresAt: number } | null = null;

/** A short-lived access token, reused until five minutes before it expires. */
export async function serviceAccountAccessToken(key: ServiceAccountKey, fetchImpl: typeof fetch = fetch, now: number = Date.now()): Promise<string> {
  if (cached && cached.email === key.client_email && cached.expiresAt - 300_000 > now) return cached.token;
  const res = await fetchImpl(key.token_uri || DEFAULT_TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedAssertion(key, Math.floor(now / 1000)),
    }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`Google refused the service account (${body.error_description || body.error || res.status}).`);
  }
  cached = { email: key.client_email, token: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

/** For tests. */
export function forgetServiceAccountToken() {
  cached = null;
}
