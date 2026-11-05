/**
 * Client-side report for errors caught by a React error boundary (they
 * never reach the global handlers). No-op until Sentry is loaded.
 */
export function reportBoundaryError(error: Error & { digest?: string }, area: string): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureException(error, { tags: { area, ...(error.digest ? { digest: error.digest } : {}) } });
    })
    .catch(() => undefined);
}
