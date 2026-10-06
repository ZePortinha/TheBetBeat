/**
 * SMS sign-in codes for the guest phone login (2026-10-05). Pure rules so
 * they stay unit-testable; the keyed hash lives in lib/security/crypto.ts.
 */
import { randomInt, timingSafeEqual } from "node:crypto";

export const SMS_CODE_TTL_MS = 5 * 60_000;
export const SMS_CODE_MAX_ATTEMPTS = 5;

/** Six random digits, leading zeros kept. */
export function newSmsCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export interface StoredSmsCode {
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

export type SmsCodeCheck = "ok" | "mismatch" | "expired" | "too_many_attempts";

/** Decides one verification attempt; a used code reads as expired. */
export function checkSmsCode(
  stored: StoredSmsCode,
  candidateHash: string,
  now: number,
): SmsCodeCheck {
  if (stored.consumedAt || stored.expiresAt.getTime() <= now) return "expired";
  if (stored.attempts >= SMS_CODE_MAX_ATTEMPTS) return "too_many_attempts";
  const a = Buffer.from(stored.codeHash, "hex");
  const b = Buffer.from(candidateHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "mismatch";
}
