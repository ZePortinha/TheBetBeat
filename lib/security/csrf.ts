/**
 * CSRF defense in depth for /api (B12.4). A browser always sends Origin on
 * a cross-site POST/PUT/PATCH/DELETE; when it names another host, the
 * middleware refuses the request before any route runs. Webhooks are
 * server-to-server (no Origin) and keep their own signatures; clients
 * without Origin (scripts, tests) still pass and authenticate as usual.
 */

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Dev only: phone testing through a temporary cloudflared tunnel (next.config allowedDevOrigins). */
const DEV_TUNNEL_SUFFIX = ".trycloudflare.com";

export function isCrossSiteApiWrite(
  method: string,
  pathname: string,
  headers: Headers,
  isDev = process.env.NODE_ENV !== "production",
): boolean {
  if (!pathname.startsWith("/api/") || pathname.startsWith("/api/webhooks/")) return false;
  if (!UNSAFE_METHODS.has(method.toUpperCase())) return false;
  const origin = headers.get("origin");
  if (!origin) return false;
  if (origin === "null") return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }
  if (isDev && originHost.endsWith(DEV_TUNNEL_SUFFIX)) return false;
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0]!.trim();
  return host.length === 0 || originHost !== host;
}
