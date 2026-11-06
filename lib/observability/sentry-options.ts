import { scrubBreadcrumb, scrubEvent } from "./scrub";

/**
 * Options shared by every Sentry entry point (server, edge, browser,
 * worker). Privacy first (B12.4): no default PII, every event and
 * breadcrumb scrubbed before it leaves, no session replay, and tracing off
 * unless a sample rate is configured.
 */
export interface SentryBaseOptions {
  dsn: string;
  environment: string;
  release?: string;
  sendDefaultPii: false;
  tracesSampleRate: number;
  maxBreadcrumbs: number;
  beforeSend: <E extends object>(event: E) => E;
  beforeSendTransaction: <E extends object>(event: E) => E;
  beforeBreadcrumb: <B extends object>(breadcrumb: B) => B | null;
}

export function sampleRate(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

export function sentryBaseOptions(input: {
  dsn: string;
  environment?: string;
  release?: string;
  tracesSampleRate?: string;
}): SentryBaseOptions {
  return {
    dsn: input.dsn,
    environment: input.environment || process.env.NODE_ENV || "development",
    ...(input.release ? { release: input.release } : {}),
    sendDefaultPii: false,
    tracesSampleRate: sampleRate(input.tracesSampleRate),
    maxBreadcrumbs: 50,
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  };
}

/** `https://key@o1.ingest.de.sentry.io/2` → `https://o1.ingest.de.sentry.io`. */
export function sentryOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}
