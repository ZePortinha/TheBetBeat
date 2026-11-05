/**
 * Worker error monitoring (B12.4). Off while SENTRY_DSN is unset. The
 * worker logs every handled failure with console.error (refund retries,
 * reconciliation, deadlines), so those lines are forwarded too, after the
 * same scrubbing as the web app (lib/observability/scrub.ts).
 */
import { sentryBaseOptions } from "../lib/observability/sentry-options";

export async function startWorkerSentry(): Promise<{ flush: () => Promise<void> } | null> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  const Sentry = await import("@sentry/node");
  Sentry.init({
    ...sentryBaseOptions({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT,
      release: process.env.SENTRY_RELEASE,
      tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE,
    }),
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
  });
  Sentry.setTag("surface", "worker");
  return { flush: async () => void (await Sentry.flush(2000)) };
}
