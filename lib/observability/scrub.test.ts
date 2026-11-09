import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { scrubBreadcrumb, scrubEvent, scrubString, scrubValue } from "./scrub";

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJndWVzdC0xIn0.c2lnbmF0dXJlLXZhbHVlLWhlcmU";

describe("scrubString", () => {
  it.each([
    ["MB WAY push to +351 912 345 678 failed", "MB WAY push to [phone] failed"],
    ["sms to 912345678", "sms to [phone]"],
    ["sms to 00351912345678", "sms to [phone]"],
    ["invite marta.f@exemplo.pt now", "invite [email] now"],
    ["payout PT50 0002 0123 1234 5678 9015 4 queued", "payout [iban] queued"],
    [`token ${JWT}`, "token [token]"],
    ["Authorization: Bearer abc.def-123", "Authorization: Bearer [token]"],
    ["key sb_secret_AbC123-xyz", "key [token]"],
    ["GET /s/qr_9f8e7d6c5b4a/search?q=house", "GET /s/[token]/search?q=house"],
    ["/display/abc.def.ghi", "/display/[token]"],
    ["/api/display/abc.def.ghi/state", "/api/display/[token]/state"],
    ["/login?next=/cockpit&token=abc", "/login?next=/cockpit&token=[filtered]"],
    ["/x?email=a%40b.pt&page=2", "/x?email=[filtered]&page=2"],
  ])("%s", (input, expected) => {
    expect(scrubString(input)).toBe(expected);
  });

  it("keeps ids, amounts, dates and correlation ids", () => {
    const safe = [
      "request 3f2a9c1e-7b4d-4e0a-9c1f-2d3e4f5a6b7c moved to PLAYED",
      "refund 1250 cents for reason dj_reject",
      "2026-11-05T10:20:01.000Z",
      "[cockpit:accept] 9f3c2a1b: deadline passed",
      "event 0123456789abcdef0123456789abcdef",
    ];
    for (const line of safe) expect(scrubString(line)).toBe(line);
  });

  it("never leaves a Portuguese mobile number in any sentence", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("9", "2"),
        fc.stringMatching(/^\d{8}$/),
        fc.constantFrom("", "+351", "+351 ", "00351"),
        fc.string({ maxLength: 20 }).filter((s) => !/[\w.+-]$/.test(s)),
        fc.string({ maxLength: 20 }).filter((s) => !/^[\w-]/.test(s)),
        (first, rest, prefix, before, after) => {
          const phone = `${prefix}${first}${rest}`;
          const out = scrubString(`${before} ${phone} ${after}`);
          expect(out).not.toContain(`${first}${rest}`);
        },
      ),
    );
  });
});

describe("scrubValue", () => {
  it("filters sensitive keys at any depth", () => {
    expect(
      scrubValue({
        password: "hunter2",
        nested: { phoneE164: "+351912345678", cf_turnstile_response: "x", ok: "fine" },
        list: [{ accessToken: "t" }, "mail: a@b.pt"],
      }),
    ).toEqual({
      password: "[filtered]",
      nested: { phoneE164: "[filtered]", cf_turnstile_response: "[filtered]", ok: "fine" },
      list: [{ accessToken: "[filtered]" }, "mail: [email]"],
    });
  });

  it("does not mutate its input", () => {
    const input = { password: "x" };
    scrubValue(input);
    expect(input.password).toBe("x");
  });
});

describe("scrubEvent", () => {
  it("drops bodies, cookies, extra headers and identity", () => {
    const event = {
      event_id: "0123456789abcdef0123456789abcdef",
      server_name: "host-1",
      message: "SMS to +351 912 345 678 failed",
      exception: { values: [{ type: "Error", value: "guest marta@exemplo.pt not found" }] },
      request: {
        url: "https://discontrol.pt/s/qr_abc123/requests?code=123456",
        method: "POST",
        data: { phone: "912345678" },
        cookies: { "sb-access-token": JWT },
        query_string: "code=123456&page=1",
        headers: {
          "user-agent": "Mozilla/5.0",
          authorization: `Bearer ${JWT}`,
          cookie: "sb=1",
          "x-forwarded-for": "203.0.113.9",
        },
      },
      user: { id: "guest-1", email: "a@b.pt", ip_address: "203.0.113.9" },
      extra: { iban: "PT50000201231234567890154" },
    };
    const out = scrubEvent(event);
    expect(out).toEqual({
      event_id: "0123456789abcdef0123456789abcdef",
      message: "SMS to [phone] failed",
      exception: { values: [{ type: "Error", value: "guest [email] not found" }] },
      request: {
        url: "https://discontrol.pt/s/[token]/requests?code=[filtered]",
        method: "POST",
        query_string: "code=[filtered]&page=1",
        headers: { "user-agent": "Mozilla/5.0" },
      },
      user: { id: "guest-1" },
      extra: { iban: "[filtered]" },
    });
    expect(JSON.stringify(out)).not.toMatch(/912|marta|eyJ|203\.0\.113/);
  });

  it("scrubs breadcrumbs", () => {
    expect(
      scrubBreadcrumb({
        category: "fetch",
        data: { url: "/api/guest/phone?phone=912345678", status_code: 200 },
        message: "to marta@exemplo.pt",
      }),
    ).toEqual({
      category: "fetch",
      data: { url: "/api/guest/phone?phone=[filtered]", status_code: 200 },
      message: "to [email]",
    });
  });
});
