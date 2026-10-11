import "server-only";
import { env } from "@/lib/security/env";

/** Cloudflare Turnstile server-side verification (B12.4). */
export async function verifyTurnstile(
  token: string,
  remoteIp?: string,
): Promise<boolean> {
  // Cloudflare caps tokens at 2048 characters; never send junk upstream.
  if (token.length === 0 || token.length > 4096) return false;
  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(5_000),
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET_KEY,
          response: token,
          ...(remoteIp && remoteIp !== "local" ? { remoteip: remoteIp } : {}),
        }),
      },
    );
    const data = (await res.json()) as { success: boolean };
    return data.success === true;
  } catch {
    // Network failure to Cloudflare: fail closed in production, open in dev.
    return process.env.NODE_ENV !== "production";
  }
}
