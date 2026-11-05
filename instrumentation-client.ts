/**
 * Browser instrumentation. The Sentry SDK (and our scrubber) are fetched as
 * a separate chunk and only when NEXT_PUBLIC_SENTRY_DSN is set, so the
 * guest app pays no JavaScript for them otherwise. No replay, no tracing,
 * no default PII, every event scrubbed (lib/observability/scrub.ts).
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn && typeof window !== "undefined") {
  void Promise.all([import("@sentry/nextjs"), import("@/lib/observability/sentry-options")])
    .then(([Sentry, { sentryBaseOptions }]) => {
      Sentry.init({
        ...sentryBaseOptions({
          dsn,
          environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
          release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
        }),
        tracesSampleRate: 0,
        integrations: (defaults) => defaults.filter((i) => i.name !== "BrowserTracing"),
      });
    })
    .catch(() => undefined);
}
