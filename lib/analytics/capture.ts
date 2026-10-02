import "server-only";
import type { EventName } from "./events";

/**
 * Server-side analytics capture via PostHog's HTTP API (no SDK dependency).
 * No-op when NEXT_PUBLIC_POSTHOG_KEY is unset (local dev). Never blocks the
 * request path: fire-and-forget with a short timeout. Never sends PII —
 * callers pass ids and enums only (B12.4).
 */
export function capture(
  event: EventName,
  distinctId: string,
  properties: Record<string, string | number | boolean | null> = {},
): void {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.posthog.com";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  void fetch(`${host}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      event,
      distinct_id: distinctId,
      properties: { ...properties, $lib: "betbeat-server" },
      timestamp: new Date().toISOString(),
    }),
    signal: controller.signal,
    keepalive: true,
  })
    .catch(() => undefined)
    .finally(() => clearTimeout(timer));
}
