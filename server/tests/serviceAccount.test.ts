import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateKeyPairSync, createVerify } from "crypto";
import { signedAssertion, serviceAccountAccessToken, forgetServiceAccountToken } from "../src/google/serviceAccount";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = { client_email: "vp-calendar@school-project.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };

describe("Google service account (shared calendar sheet)", () => {
  beforeEach(() => forgetServiceAccountToken());

  it("signs a read-only Drive request with the account's own key", () => {
    const jwt = signedAssertion(key, 1_800_000_000);
    const [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    const ok = createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, "base64url"));
    expect(ok).toBe(true);
  });

  it("trades it for an access token once and reuses it until near expiry", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: "ya29.robot", expires_in: 3600 }), { status: 200 }));
    const now = Date.now();
    expect(await serviceAccountAccessToken(key, fetchImpl as unknown as typeof fetch, now)).toBe("ya29.robot");
    expect(await serviceAccountAccessToken(key, fetchImpl as unknown as typeof fetch, now + 30 * 60_000)).toBe("ya29.robot");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = new URLSearchParams(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    await serviceAccountAccessToken(key, fetchImpl as unknown as typeof fetch, now + 56 * 60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("explains when Google refuses the key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid JWT Signature." }), { status: 400 }));
    await expect(serviceAccountAccessToken(key, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/Invalid JWT Signature/);
  });
});
