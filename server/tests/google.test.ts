import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { randomBytes } from "crypto";
import { prisma } from "../src/db";
import { createApp } from "../src/app";
import { encrypt, decrypt } from "../src/google/crypto";
import * as google from "../src/google/accounts";

function idToken(email: string) {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part({ email })}.sig`;
}

let calls: { url: string; body: string }[] = [];
function fakeFetch(responses: Record<string, object>) {
  return (async (url: any, init?: any) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    const grant = new URLSearchParams(String(init?.body ?? "")).get("grant_type") ?? "";
    const payload = responses[grant] ?? responses[String(url)] ?? {};
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

describe("Google accounts", () => {
  beforeEach(() => {
    calls = [];
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost:4000/api/google/oauth/callback";
    google.resetTokenCache();
  });
  afterEach(() => {
    google.setFetch(fetch);
    delete process.env.TOKEN_ENCRYPTION_KEY;
  });

  it("encrypts tokens and detects tampering", () => {
    const blob = encrypt("refresh-secret");
    expect(blob).not.toContain("refresh-secret");
    expect(decrypt(blob)).toBe("refresh-secret");
    const tampered = blob.slice(0, -2) + (blob.endsWith("A") ? "BB" : "AA");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("builds a consent URL asking only for send and read-only Drive", () => {
    const url = new URL(google.authUrl("School"));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("gmail.send");
    expect(url.searchParams.get("scope")).toContain("drive.readonly");
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("rejects a callback with an unknown state", async () => {
    await expect(google.handleCallback("code", "forged")).rejects.toThrow(/expired|unknown/i);
  });

  it("stores the account email and only the encrypted refresh token", async () => {
    google.setFetch(fakeFetch({
      authorization_code: { access_token: "at-1", refresh_token: "rt-secret", expires_in: 3600, id_token: idToken("uma@school.edu") },
    }));
    const state = new URL(google.authUrl("School")).searchParams.get("state")!;
    const account = await google.handleCallback("code-123", state);
    expect(account.email).toBe("uma@school.edu");
    expect(account.isDefault).toBe(true);
    const row = await prisma.googleAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.refreshTokenEnc).not.toContain("rt-secret");
    // state is single-use
    await expect(google.handleCallback("code-123", state)).rejects.toThrow();
  });

  it("refreshes an access token once and reuses it", async () => {
    google.setFetch(fakeFetch({ refresh_token: { access_token: "fresh", expires_in: 3600 } }));
    const account = await prisma.googleAccount.create({
      data: { email: "a@school.edu", scopes: "x", refreshTokenEnc: encrypt("rt"), isDefault: true },
    });
    expect(await google.accessTokenFor(account.id)).toBe("fresh");
    expect(await google.accessTokenFor(account.id)).toBe("fresh");
    expect(calls.filter((c) => c.body.includes("refresh_token"))).toHaveLength(1);
  });

  it("lists connected accounts in the connection health check", async () => {
    await prisma.googleAccount.create({ data: { email: "b@school.edu", scopes: "x", refreshTokenEnc: encrypt("rt"), isDefault: true } });
    const res = await request(createApp()).get("/api/connectors/health");
    const gmail = res.body.find((c: any) => c.type === "gmail");
    expect(gmail.configured).toBe(true);
    expect(gmail.detail).toContain("b@school.edu");
  });
});
