import { describe, expect, it } from "vitest";
import { isCrossSiteApiWrite } from "./csrf";

const h = (init: Record<string, string>) => new Headers(init);

describe("isCrossSiteApiWrite", () => {
  it("refuses an API write from another site", () => {
    expect(isCrossSiteApiWrite("POST", "/api/guest/auction/bid", h({ host: "discontrol.app", origin: "https://evil.example" }), false)).toBe(true);
    expect(isCrossSiteApiWrite("DELETE", "/api/guest/phone", h({ host: "discontrol.app", origin: "null" }), false)).toBe(true);
  });

  it("lets same-site writes, reads, webhooks and Origin-less clients through", () => {
    expect(isCrossSiteApiWrite("POST", "/api/guest/auction/bid", h({ host: "discontrol.app", origin: "https://discontrol.app" }), false)).toBe(false);
    expect(isCrossSiteApiWrite("GET", "/api/guest/profile", h({ host: "discontrol.app", origin: "https://evil.example" }), false)).toBe(false);
    expect(isCrossSiteApiWrite("POST", "/api/webhooks/payments", h({ host: "discontrol.app", origin: "https://psp.example" }), false)).toBe(false);
    expect(isCrossSiteApiWrite("POST", "/api/guest/auction/bid", h({ host: "discontrol.app" }), false)).toBe(false);
    expect(isCrossSiteApiWrite("POST", "/s/abc", h({ host: "discontrol.app", origin: "https://evil.example" }), false)).toBe(false);
  });

  it("uses the proxy's forwarded host", () => {
    const headers = h({ host: "internal:3000", "x-forwarded-host": "discontrol.app", origin: "https://discontrol.app" });
    expect(isCrossSiteApiWrite("POST", "/api/guest/push", headers, false)).toBe(false);
  });

  it("allows the dev tunnel only in development", () => {
    const headers = h({ host: "localhost:3000", origin: "https://abc.trycloudflare.com" });
    expect(isCrossSiteApiWrite("POST", "/api/guest/push", headers, true)).toBe(false);
    expect(isCrossSiteApiWrite("POST", "/api/guest/push", headers, false)).toBe(true);
  });
});
