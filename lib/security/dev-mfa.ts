import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Development-only stand-in for the TOTP second factor (B12.3).
 *
 * Outside production, a manager/admin can type a fixed test code on
 * /login/mfa instead of a code from an authenticator app. The server then
 * sets an httpOnly cookie bound to that user (HMAC), which the staff gates
 * accept in place of AAL2. With NODE_ENV=production every function here
 * refuses, whatever the environment variables say.
 */

export const DEV_MFA_COOKIE = "bb_dev_mfa";
export const DEV_MFA_DEFAULT_CODE = "000000";
/** Cookie lifetime: one working session. */
export const DEV_MFA_MAX_AGE_S = 12 * 60 * 60;

type Env = Record<string, string | undefined>;

/** The accepted test code, or null when the bypass is off. */
export function devMfaCode(envVars: Env = process.env): string | null {
  if (envVars.NODE_ENV === "production") return null;
  const raw = (envVars.DEV_MFA_CODE ?? DEV_MFA_DEFAULT_CODE).trim();
  if (raw === "" || raw === "off") return null;
  return /^\d{6}$/.test(raw) ? raw : null;
}

export function isDevMfaCode(code: string, envVars: Env = process.env): boolean {
  const expected = devMfaCode(envVars);
  if (!expected) return false;
  const a = Buffer.from(code.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function mac(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(`dev-mfa:${userId}`).digest("base64url");
}

export function signDevMfa(userId: string, secret: string): string {
  return mac(userId, secret);
}

/** True only outside production, with the bypass on and a cookie for this user. */
export function verifyDevMfa(
  cookie: string | undefined,
  userId: string,
  secret: string,
  envVars: Env = process.env,
): boolean {
  if (!cookie || !devMfaCode(envVars)) return false;
  const a = Buffer.from(cookie);
  const b = Buffer.from(mac(userId, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}
