import { describe, expect, it } from "vitest";
import { devMfaCode, isDevMfaCode, signDevMfa, verifyDevMfa } from "./dev-mfa";

const SECRET = "s".repeat(32);

describe("dev MFA bypass", () => {
  it("defaults to 000000 in development", () => {
    expect(devMfaCode({ NODE_ENV: "development" })).toBe("000000");
    expect(isDevMfaCode("000000", { NODE_ENV: "development" })).toBe(true);
    expect(isDevMfaCode("123456", { NODE_ENV: "development" })).toBe(false);
  });

  it("uses DEV_MFA_CODE when set, and can be switched off", () => {
    expect(isDevMfaCode("424242", { NODE_ENV: "development", DEV_MFA_CODE: "424242" })).toBe(true);
    expect(devMfaCode({ NODE_ENV: "development", DEV_MFA_CODE: "off" })).toBeNull();
    expect(devMfaCode({ NODE_ENV: "development", DEV_MFA_CODE: "12ab" })).toBeNull();
  });

  it("never works in production", () => {
    const prod = { NODE_ENV: "production", DEV_MFA_CODE: "000000" };
    expect(devMfaCode(prod)).toBeNull();
    expect(isDevMfaCode("000000", prod)).toBe(false);
    expect(verifyDevMfa(signDevMfa("u1", SECRET), "u1", SECRET, prod)).toBe(false);
  });

  it("binds the cookie to one user", () => {
    const dev = { NODE_ENV: "development" };
    const cookie = signDevMfa("u1", SECRET);
    expect(verifyDevMfa(cookie, "u1", SECRET, dev)).toBe(true);
    expect(verifyDevMfa(cookie, "u2", SECRET, dev)).toBe(false);
    expect(verifyDevMfa(undefined, "u1", SECRET, dev)).toBe(false);
    expect(verifyDevMfa(cookie, "u1", "t".repeat(32), dev)).toBe(false);
  });
});
