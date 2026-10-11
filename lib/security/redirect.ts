/**
 * Post-login destinations (B12.4). Only same-site paths: "/console/x",
 * never "//evil.example", "https://evil.example", "/\\evil" or "javascript:".
 * Anything else falls back, so a crafted ?next= cannot send a staff member
 * to a phishing page right after a real sign-in.
 */
const SAFE_PATH = /^\/(?!\/)[\w\-/?=&%.]*$/;

export function safeNextPath(raw: unknown, fallback: string): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.length <= 512 && SAFE_PATH.test(value) ? value : fallback;
}
