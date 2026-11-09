/**
 * Next.js instrumentation (server + edge). Sentry starts only when
 * SENTRY_DSN is set, so local runs and E2E send nothing (B12.4). Every
 * event is scrubbed by lib/observability/scrub.ts before it leaves.
 */
import type { Instrumentation } from "next";

const dsn = process.env.SENTRY_DSN;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const { launchReadiness, readinessReport } = await import("@/lib/security/launch-readiness");
    const report = readinessReport(launchReadiness(process.env));
    if (report) console.warn(report);
  }
  if (!dsn) return;
  const Sentry = await import("@sentry/nextjs");
  const { sentryBaseOptions } = await import("@/lib/observability/sentry-options");
  const base = sentryBaseOptions({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE,
  });
  Sentry.init({
    ...base,
    // Handled 500s are logged with a correlation id (console.error) and
    // never rethrown: forward those lines too, scrubbed like everything else.
    integrations:
      process.env.NEXT_RUNTIME === "nodejs" ? [Sentry.captureConsoleIntegration({ levels: ["error"] })] : [],
  });
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!dsn) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
