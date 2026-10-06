import { describe, expect, it } from "vitest";
import { checkSmsCode, newSmsCode, SMS_CODE_MAX_ATTEMPTS } from "./otp";

const now = Date.parse("2026-10-05T23:00:00Z");
const stored = {
  codeHash: "ab".repeat(32),
  attempts: 0,
  expiresAt: new Date(now + 60_000),
  consumedAt: null,
};

describe("SMS sign-in codes", () => {
  it("generates six digits", () => {
    for (let i = 0; i < 200; i += 1) expect(newSmsCode()).toMatch(/^\d{6}$/);
  });

  it("accepts the right code once, inside the window", () => {
    expect(checkSmsCode(stored, "ab".repeat(32), now)).toBe("ok");
    expect(checkSmsCode(stored, "cd".repeat(32), now)).toBe("mismatch");
    expect(checkSmsCode(stored, "ab", now)).toBe("mismatch");
  });

  it("rejects expired, used and exhausted codes even when they match", () => {
    expect(checkSmsCode({ ...stored, expiresAt: new Date(now) }, stored.codeHash, now)).toBe("expired");
    expect(checkSmsCode({ ...stored, consumedAt: new Date(now) }, stored.codeHash, now)).toBe("expired");
    expect(
      checkSmsCode({ ...stored, attempts: SMS_CODE_MAX_ATTEMPTS }, stored.codeHash, now),
    ).toBe("too_many_attempts");
  });
});
