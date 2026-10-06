import { describe, expect, it } from "vitest";
import { normalizePtMobile, parsePtMobiles } from "./phone";

describe("PT mobile numbers", () => {
  it("normalizes the usual ways of writing a number", () => {
    for (const raw of ["912345678", "912 345 678", "+351 912 345 678", "00351912345678", "351-912-345-678", "(+351) 912.345.678"]) {
      expect(normalizePtMobile(raw)).toBe("+351912345678");
    }
  });

  it("rejects landlines, short numbers and other countries", () => {
    for (const raw of ["212345678", "91234567", "9123456789", "+34612345678", "abc"]) {
      expect(normalizePtMobile(raw)).toBeNull();
    }
  });

  it("parses a pasted list, dropping duplicates and keeping the rejects", () => {
    expect(parsePtMobiles("912345678\n+351 912 345 678, 935550001;\n\n212345678")).toEqual({
      valid: ["+351912345678", "+351935550001"],
      invalid: ["212345678"],
    });
  });
});
