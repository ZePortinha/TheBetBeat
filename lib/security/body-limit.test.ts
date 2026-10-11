import { describe, expect, it } from "vitest";
import { API_BODY_MAX, UPLOAD_BODY_MAX, isApiBodyTooLarge } from "./body-limit";

const h = (len?: string) => new Headers(len === undefined ? {} : { "content-length": len });

describe("isApiBodyTooLarge", () => {
  it("ignores pages and requests without a declared length", () => {
    expect(isApiBodyTooLarge("/login", h(String(API_BODY_MAX * 10)))).toBe(false);
    expect(isApiBodyTooLarge("/api/guest/requests", h())).toBe(false);
  });

  it("caps JSON routes", () => {
    expect(isApiBodyTooLarge("/api/guest/requests", h(String(API_BODY_MAX)))).toBe(false);
    expect(isApiBodyTooLarge("/api/guest/requests", h(String(API_BODY_MAX + 1)))).toBe(true);
    expect(isApiBodyTooLarge("/api/webhooks/payments", h(String(API_BODY_MAX + 1)))).toBe(true);
  });

  it("lets the library import upload a file", () => {
    expect(isApiBodyTooLarge("/api/cockpit/library/import", h(String(5 * 1024 * 1024)))).toBe(false);
    expect(isApiBodyTooLarge("/api/cockpit/library/import", h(String(UPLOAD_BODY_MAX + 1)))).toBe(true);
  });

  it("refuses a malformed length", () => {
    expect(isApiBodyTooLarge("/api/guest/requests", h("abc"))).toBe(true);
    expect(isApiBodyTooLarge("/api/guest/requests", h("-1"))).toBe(true);
  });
});
