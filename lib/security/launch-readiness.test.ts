import { describe, expect, it } from "vitest";
import { launchReadiness, readinessReport } from "./launch-readiness";

describe("launchReadiness", () => {
  it("flags a demo build", () => {
    const warnings = launchReadiness({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    });
    expect(warnings).toEqual([
      "supabase_captcha_off",
      "turnstile_test_keys",
      "payments_mock",
      "sms_mock",
      "sentry_off",
      "app_url_not_https",
    ]);
    expect(readinessReport(warnings)).toContain("always-pass");
  });

  it("is quiet for a launch build", () => {
    const warnings = launchReadiness({
      NEXT_PUBLIC_APP_URL: "https://discontrol.app",
      NEXT_PUBLIC_SUPABASE_CAPTCHA: "1",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAA-real",
      TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-secret",
      PAYMENT_PROVIDER: "ifthenpay",
      SMS_PROVIDER: "twilio",
      SENTRY_DSN: "https://k@o1.ingest.de.sentry.io/2",
    });
    expect(warnings).toEqual([]);
    expect(readinessReport(warnings)).toBeNull();
  });
});
