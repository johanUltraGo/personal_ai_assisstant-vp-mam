import { randomBytes } from "crypto";
import { GoogleAccount } from "@prisma/client";
import { prisma } from "../db";
import { encrypt, decrypt } from "./crypto";
import { BadRequestError, NotFoundError } from "../http/errors";
import { logActivity } from "../services/activityService";

/**
 * Multiple Google accounts (spec §7) via the standard OAuth authorization-code
 * flow. Least access (design §8): send mail, read Drive. Access tokens live
 * only in memory; refresh tokens are stored encrypted.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive.readonly",
];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const STATE_TTL_MS = 10 * 60_000;

let fetchImpl: typeof fetch = (...args) => fetch(...args);
/** Test seam for Google's endpoints. */
export function setFetch(f: typeof fetch) {
  fetchImpl = f;
}

const pendingStates = new Map<string, { label?: string; expires: number }>();
const tokenCache = new Map<string, { token: string; expires: number }>();
export function resetTokenCache() {
  tokenCache.clear();
}

function oauthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new BadRequestError(
      "Google sign-in is not set up: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI are needed (see server/README.md)."
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function isOAuthConfigured(): boolean {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GOOGLE_OAUTH_REDIRECT_URI);
}

export function authUrl(label?: string): string {
  const { clientId, redirectUri } = oauthConfig();
  const state = randomBytes(24).toString("base64url");
  pendingStates.set(state, { label, expires: Date.now() + STATE_TTL_MS });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function postToken(params: Record<string, string>) {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok || data.error) {
    throw new BadRequestError(`Google refused the request: ${data.error_description ?? data.error ?? response.status}`);
  }
  return data;
}

/** The email comes from the id_token Google returned directly to us over TLS. */
function emailFromIdToken(idToken: string | undefined): string {
  const payload = idToken?.split(".")[1];
  const email = payload ? JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).email : undefined;
  if (!email) throw new BadRequestError("Google did not say which account was connected.");
  return String(email).toLowerCase();
}

export async function handleCallback(code: string, state: string): Promise<GoogleAccount> {
  const pending = pendingStates.get(state);
  pendingStates.delete(state);
  if (!pending || pending.expires < Date.now()) {
    throw new BadRequestError("This Google sign-in link expired or is unknown. Please start again.");
  }
  const { clientId, clientSecret, redirectUri } = oauthConfig();
  const data = await postToken({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (!data.refresh_token) {
    throw new BadRequestError("Google did not grant offline access. Remove the app from your Google account permissions and connect again.");
  }
  const email = emailFromIdToken(data.id_token);
  const hasDefault = (await prisma.googleAccount.count({ where: { isDefault: true } })) > 0;
  const account = await prisma.googleAccount.upsert({
    where: { email },
    create: {
      email,
      label: pending.label,
      scopes: String(data.scope ?? GOOGLE_SCOPES.join(" ")),
      refreshTokenEnc: encrypt(data.refresh_token),
      isDefault: !hasDefault,
    },
    update: { label: pending.label, scopes: String(data.scope ?? ""), refreshTokenEnc: encrypt(data.refresh_token) },
  });
  if (data.access_token) {
    tokenCache.set(account.id, { token: data.access_token, expires: Date.now() + (Number(data.expires_in ?? 3600) - 60) * 1000 });
  }
  await logActivity("google.connected", `Connected the Google account ${email}.`, { type: "GoogleAccount", id: account.id });
  return account;
}

export async function accessTokenFor(accountId: string): Promise<string> {
  const cached = tokenCache.get(accountId);
  if (cached && cached.expires > Date.now()) return cached.token;
  const account = await prisma.googleAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new NotFoundError("That Google account is no longer connected.");
  const { clientId, clientSecret } = oauthConfig();
  const data = await postToken({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: decrypt(account.refreshTokenEnc),
    grant_type: "refresh_token",
  });
  tokenCache.set(accountId, { token: data.access_token, expires: Date.now() + (Number(data.expires_in ?? 3600) - 60) * 1000 });
  await prisma.googleAccount.update({ where: { id: accountId }, data: { lastUsedAt: new Date() } });
  return data.access_token;
}

/** Default account first, then the rest in the order they were connected. */
export function listAccounts() {
  return prisma.googleAccount.findMany({
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, email: true, label: true, isDefault: true, createdAt: true, lastUsedAt: true, scopes: true },
  });
}

export async function setDefault(accountId: string) {
  await prisma.googleAccount.findUniqueOrThrow({ where: { id: accountId } });
  await prisma.$transaction([
    prisma.googleAccount.updateMany({ data: { isDefault: false } }),
    prisma.googleAccount.update({ where: { id: accountId }, data: { isDefault: true } }),
  ]);
}

export async function removeAccount(accountId: string) {
  const account = await prisma.googleAccount.findUniqueOrThrow({ where: { id: accountId } });
  try {
    await fetchImpl(`${REVOKE_URL}?token=${encodeURIComponent(decrypt(account.refreshTokenEnc))}`, { method: "POST" });
  } catch {
    // Best effort: the account is removed here either way.
  }
  await prisma.googleAccount.delete({ where: { id: accountId } });
  tokenCache.delete(accountId);
  if (account.isDefault) {
    const next = await prisma.googleAccount.findFirst({ orderBy: { createdAt: "asc" } });
    if (next) await prisma.googleAccount.update({ where: { id: next.id }, data: { isDefault: true } });
  }
  await logActivity("google.removed", `Disconnected the Google account ${account.email}.`);
}
