import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/security/env";

/**
 * Signed QR / display tokens (B4.7): identify venue, session scope and zone;
 * HMAC-SHA256 — unforgeable without QR_TOKEN_SECRET. URL-safe base64.
 */
export interface QrTokenPayload {
  /** zone = any night at the venue; session = this event only; display = the venue screen. */
  kind: "zone" | "display" | "session";
  venueId: string;
  /** zone qr_slug, session display_slug, or the session id (kind "session") */
  slug: string;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signToken(payload: QrTokenPayload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const mac = createHmac("sha256", env.QR_TOKEN_SECRET).update(body).digest();
  return `${body}.${b64url(mac)}`;
}

export function verifyToken(token: string): QrTokenPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac("sha256", env.QR_TOKEN_SECRET).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (
      (payload.kind === "zone" || payload.kind === "display" || payload.kind === "session") &&
      typeof payload.venueId === "string" &&
      typeof payload.slug === "string"
    ) {
      return payload as QrTokenPayload;
    }
    return null;
  } catch {
    return null;
  }
}
