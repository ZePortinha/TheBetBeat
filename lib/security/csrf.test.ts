import { describe, expect, it } from "vitest";
import { isCrossSiteApiWrite } from "./csrf";

const h = (init: Record<string, string>) => new Headers(init);

describe("isCrossSiteApiWrite", () => {
  it("refuses an API write from another site", () => {
    expect(isCrossSiteApiWrite("POST", "/api/guest/auction/bid", h({ host: "betbeat.pt", origin: "https://evil.example" }), false)).toBe(true);
    expect(isCrossSiteApiWrite("DELETE", "/api/guest/phone", h({ host: "betbeat.pt", origin: "null" }), false)).toBe(true);
  });

  it("lets same-site writes, reads, webhooks and Origin-less clients through", () => {
    expect(isCrossSiteApiWrite("POST", "/api/guest/auction/bid", h({ host: "betbeat.pt", origin: "https://betbeat.pt" }), false)).toBe(false);
    expect(isCrossSiteApiWrite("GET", "/api/guest/profile", h({ host: "betbeat.pt", origin: "https://evil.example" }), false)).toBe(false);
    expect(isCrossSiteApiWrite("POST", "/api/webhooks/payments", h({ host: "betbeat.pt", origin: "https://psp.example" }), false)).toBe(false);
    expect(isCrossSiteApiWrite("POST", "/api/guest/auction/bid", h({ host: "betbeat.pt" }), false)).toBe(false);
    expect(isCrossSiteApiWrite("POST", "/s/abc", h({ host: "betbeat.pt", origin: "https://evil.example" }), false)).toBe(false);
  });

  it("uses the proxy's forwarded host", () => {
    const headers = h({ host: "internal:3000", "x-forwarded-host": "betbeat.pt", origin: "https://betbeat.pt" });
    expect(isCrossSiteApiWrite("POST", "/api/guest/push", headers, false)).toBe(false);
  });

  it("allows the dev tunnel only in development", () => {
    const headers = h({ host: "localhost:3000", origin: "https://abc.trycloudflare.com" });
    expect(isCrossSiteApiWrite("POST", "/api/guest/push", headers, true)).toBe(false);
    expect(isCrossSiteApiWrite("POST", "/api/guest/push", headers, false)).toBe(true);
  });
});
