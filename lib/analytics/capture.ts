import "server-only";
import type { EventName, EventProperties } from "./events";

/**
 * Server-side analytics capture via PostHog's HTTP API (no SDK, B12.6).
 * No-op while POSTHOG_KEY is unset (local dev, tests). Never blocks the
 * request path: fire-and-forget with a short timeout, errors swallowed.
 *
 * Privacy (B12.4, B13): callers pass opaque ids and enums only; values
 * under sensitive-looking keys and any non-primitive are dropped here as a
 * second line of defence; no person profiles are created, no IP is kept.
 */

const SENSITIVE_KEY = /(phone|telem|e-?mail|iban|token|password|secret|name|handle|message|address|^ip$)/i;
const DEFAULT_HOST = "https://eu.i.posthog.com";

export interface CaptureConfig {
  key: string;
  host: string;
}

export function captureConfig(env: NodeJS.ProcessEnv = process.env): CaptureConfig | null {
  // NEXT_PUBLIC_POSTHOG_* are the pre-Phase-8 names, still honoured.
  const key = env.POSTHOG_KEY || env.NEXT_PUBLIC_POSTHOG_KEY || "";
  if (!key) return null;
  const host = (env.POSTHOG_HOST || env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_HOST).replace(/\/+$/, "");
  if (!host.startsWith("https://")) return null;
  return { key, host };
}

export function sanitizeProperties(properties: EventProperties): EventProperties {
  const out: EventProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (value === null || typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (typeof value === "string" && value.length <= 64) out[key] = value;
  }
  return out;
}

export function buildCapturePayload(
  config: CaptureConfig,
  event: EventName,
  distinctId: string,
  properties: EventProperties,
  at: number,
) {
  return {
    api_key: config.key,
    event,
    distinct_id: distinctId,
    properties: {
      ...sanitizeProperties(properties),
      $lib: "discontrol-server",
      $process_person_profile: false,
      $ip: null,
    },
    timestamp: new Date(at).toISOString(),
  };
}

/**
 * @param at event time in ms (the domain's injected `now`); defaults to
 *   the wall clock for callers outside domain logic.
 */
export function capture(
  event: EventName,
  distinctId: string,
  properties: EventProperties = {},
  at: number = Date.now(),
): void {
  const config = captureConfig();
  if (!config) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  void fetch(`${config.host}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCapturePayload(config, event, distinctId, properties, at)),
    signal: controller.signal,
    keepalive: true,
  })
    .catch(() => undefined)
    .finally(() => clearTimeout(timer));
}
