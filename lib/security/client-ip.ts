/**
 * Client IP for per-IP rate limits and Turnstile (B12.4).
 *
 * The LEFT end of X-Forwarded-For is whatever the client typed: a header
 * `X-Forwarded-For: 1.2.3.4` sent by a bot gave it a fresh rate-limit
 * bucket on every request. Each trusted proxy APPENDS the address it saw,
 * so the real client is the entry `TRUSTED_PROXY_HOPS` from the right
 * (default 1: one proxy, e.g. Vercel, Fly, nginx in front of the app).
 * With no header (local dev) everything is "local".
 */

/** Reads the hop count; anything odd falls back to 1. */
export function trustedProxyHops(raw = process.env.TRUSTED_PROXY_HOPS): number {
  const n = Number(raw ?? 1);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 1;
}

export function clientIpFrom(headers: Headers, hops = trustedProxyHops()): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const chain = forwarded
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 64);
    // Fewer entries than proxies: the chain is short, take the left-most we have.
    const ip = chain[Math.max(0, chain.length - hops)];
    if (ip) return ip;
  }
  const real = headers.get("x-real-ip")?.trim();
  return real && real.length <= 64 ? real : "local";
}
