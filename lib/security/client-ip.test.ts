import { describe, expect, it } from "vitest";
import { clientIpFrom, trustedProxyHops } from "./client-ip";

describe("clientIpFrom", () => {
  it("takes the address the trusted proxy saw, not the one the client typed", () => {
    const headers = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" });
    expect(clientIpFrom(headers, 1)).toBe("203.0.113.7");
    expect(clientIpFrom(headers, 2)).toBe("6.6.6.6");
  });

  it("copes with short chains, x-real-ip and nothing at all", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "203.0.113.7" }), 3)).toBe("203.0.113.7");
    expect(clientIpFrom(new Headers({ "x-real-ip": "198.51.100.1" }))).toBe("198.51.100.1");
    expect(clientIpFrom(new Headers())).toBe("local");
  });

  it("reads TRUSTED_PROXY_HOPS defensively", () => {
    expect(trustedProxyHops(undefined)).toBe(1);
    expect(trustedProxyHops("2")).toBe(2);
    expect(trustedProxyHops("-1")).toBe(1);
    expect(trustedProxyHops("abc")).toBe(1);
  });
});
