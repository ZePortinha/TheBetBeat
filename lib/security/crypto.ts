import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { env } from "@/lib/security/env";

/**
 * AES-256-GCM encryption at rest (B12.5) for phones, payout data and
 * third-party tokens. Key lives in DATA_ENCRYPTION_KEY, outside the database.
 * Format: base64(iv[12] || ciphertext || authTag[16]).
 */
const key = Buffer.from(env.DATA_ENCRYPTION_KEY, "base64");

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, enc, cipher.getAuthTag()]).toString("base64");
}

export function decrypt(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const data = raw.subarray(12, raw.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Salted phone hash for limits/anti-abuse (never the raw number). */
export function hashPhone(phoneE164: string): string {
  return createHash("sha256")
    .update(env.QR_TOKEN_SECRET) // static salt, separate from the DB
    .update(phoneE164)
    .digest("hex");
}

/** Mask a phone for logs: +3519******21. */
export function maskPhone(phoneE164: string): string {
  if (phoneE164.length < 7) return "***";
  return `${phoneE164.slice(0, 5)}${"*".repeat(phoneE164.length - 7)}${phoneE164.slice(-2)}`;
}
