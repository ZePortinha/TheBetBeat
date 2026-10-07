/**
 * Where the integration and E2E suites run: a second local Supabase stack
 * (`betbeat-test`, the dev ports + 100, see scripts/test-stack.ts) and an
 * app server on port 3100, so tests never write to the dev database.
 * Keys still come from .env.local: both local stacks use the CLI defaults.
 */
export const TEST_APP_PORT = 3100;
export const TEST_APP_URL = `http://localhost:${TEST_APP_PORT}`;

export const testEnv: Record<string, string> = {
  NEXT_PUBLIC_APP_URL: TEST_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54422/postgres",
  // Simulators and always-pass Turnstile, whatever .env.local switches on:
  // a test run must never send a real SMS or MB WAY request.
  PAYMENT_PROVIDER: "mock",
  SMS_PROVIDER: "mock",
  EMAIL_PROVIDER: "mock",
  INVOICING_PROVIDER: "mock",
  CATALOG_PROVIDER: "mock",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  // Its own build folder: the dev server keeps .next.
  NEXT_DIST_DIR: ".next-e2e",
};
