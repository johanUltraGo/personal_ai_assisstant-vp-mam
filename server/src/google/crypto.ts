import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * AES-256-GCM for Google refresh tokens at rest. TOKEN_ENCRYPTION_KEY is a
 * base64 32-byte key (generate with:
 * node -e "console.log(require('crypto').randomBytes(32).toString('base64'))").
 * Format: v1:<iv>:<tag>:<ciphertext>, all base64.
 */
function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  const buf = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (buf.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be set to a base64 32-byte key before connecting Google accounts.");
  }
  return buf;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decrypt(blob: string): string {
  const [version, iv, tag, data] = blob.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unreadable encrypted token.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
