/**
 * Automated security header + gate checks (BRIEF B12.4, Phase 8 criterion).
 */
import { test, expect } from "@playwright/test";

test.describe("security headers", () => {
  test("every HTML response carries the B12.4 headers", async ({ request }) => {
    const res = await request.get("/login");
    expect(res.status()).toBe(200);
    const h = res.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    // Camera only for this origin (the guests' QR reader); microphone and location stay off.
    expect(h["permissions-policy"]).toContain("camera=(self)");
    expect(h["permissions-policy"]).toContain("microphone=()");
    expect(h["permissions-policy"]).toContain("geolocation=()");
    expect(h["strict-transport-security"]).toContain("max-age=");
    const csp = h["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("the CSP nonce changes per request", async ({ request }) => {
    const a = (await request.get("/login")).headers()["content-security-policy"] ?? "";
    const b = (await request.get("/login")).headers()["content-security-policy"] ?? "";
    const nonceA = /'nonce-([^']+)'/.exec(a)?.[1];
    const nonceB = /'nonce-([^']+)'/.exec(b)?.[1];
    expect(nonceA).toBeTruthy();
    expect(nonceA).not.toBe(nonceB);
  });
});

test.describe("staff gates", () => {
  for (const path of ["/cockpit", "/console"]) {
    test(`${path} redirects anonymous visitors to /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login\?next=/);
    });
  }

  test("staff API routes reject anonymous callers", async ({ request }) => {
    for (const path of [
      "/api/cockpit/state",
      "/api/console/sessions",
    ]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect([401, 403, 302, 307, 404]).toContain(res.status());
      expect(res.status()).not.toBe(200);
    }
  });

  test("payment webhook rejects unsigned bodies", async ({ request }) => {
    const res = await request.post("/api/webhooks/payments", {
      data: { id: "evt_x", type: "payment.confirmed" },
      headers: { "content-type": "application/json" },
    });
    expect([400, 401, 403]).toContain(res.status());
  });
});
