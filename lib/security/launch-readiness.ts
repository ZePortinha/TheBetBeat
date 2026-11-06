/**
 * Launch readiness (B12, Phase 8): what a production server still runs on
 * simulators, test keys or with protection switched off. Printed once at
 * boot by instrumentation.ts so a demo build is never mistaken for a launch
 * build. Pure: takes the environment, returns warnings.
 */

/** Cloudflare's documented always-pass keys (dev and E2E only). */
const TURNSTILE_TEST_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "3x00000000000000000000FF",
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
]);

export type ReadinessWarning =
  | "supabase_captcha_off"
  | "turnstile_test_keys"
  | "payments_mock"
  | "sms_mock"
  | "sentry_off"
  | "app_url_not_https";

export function launchReadiness(env: Record<string, string | undefined>): ReadinessWarning[] {
  const out: ReadinessWarning[] = [];
  if (env.NEXT_PUBLIC_SUPABASE_CAPTCHA !== "1") out.push("supabase_captcha_off");
  if (TURNSTILE_TEST_KEYS.has(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "") || TURNSTILE_TEST_KEYS.has(env.TURNSTILE_SECRET_KEY ?? "")) {
    out.push("turnstile_test_keys");
  }
  if ((env.PAYMENT_PROVIDER ?? "mock") === "mock") out.push("payments_mock");
  if ((env.SMS_PROVIDER ?? "mock") === "mock") out.push("sms_mock");
  if (!env.SENTRY_DSN) out.push("sentry_off");
  if (!(env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://")) out.push("app_url_not_https");
  return out;
}

const HINTS: Record<ReadinessWarning, string> = {
  supabase_captcha_off: "anonymous and staff sign-ins skip Supabase CAPTCHA (NEXT_PUBLIC_SUPABASE_CAPTCHA=1 + Auth > CAPTCHA)",
  turnstile_test_keys: "Turnstile uses Cloudflare's always-pass test keys",
  payments_mock: "PAYMENT_PROVIDER=mock (no real MB WAY)",
  sms_mock: "SMS_PROVIDER=mock (codes are not sent)",
  sentry_off: "SENTRY_DSN is empty (errors are not reported)",
  app_url_not_https: "NEXT_PUBLIC_APP_URL is not https",
};

export function readinessReport(warnings: ReadinessWarning[]): string | null {
  if (warnings.length === 0) return null;
  return `[launch] not launch-ready:\n${warnings.map((w) => `  - ${HINTS[w]}`).join("\n")}`;
}
