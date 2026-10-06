import { describe, expect, it } from "vitest";
import { guestPathFrom } from "./guest-path";

describe("scanned QR → guest path", () => {
  // A made-up guest link segment (shape only; nothing secret).
  const token = ["sample", "guest", "link"].join(".");

  it("keeps only the /s/<token> path, whatever the host", () => {
    expect(guestPathFrom(`https://betbeat.pt/s/${token}`)).toBe(`/s/${token}`);
    expect(guestPathFrom(`https://abc.trycloudflare.com/s/${token}?x=1#y`)).toBe(`/s/${token}`);
    expect(guestPathFrom(`  /s/${token}  `)).toBe(`/s/${token}`);
  });

  it("refuses anything that is not a guest link", () => {
    expect(guestPathFrom("https://evil.example/login")).toBeNull();
    expect(guestPathFrom(`https://betbeat.pt/s/${token}/../../console`)).toBeNull();
    expect(guestPathFrom("javascript:alert(1)")).toBeNull();
    expect(guestPathFrom("/s/short")).toBeNull();
    expect(guestPathFrom("WIFI:S:club;T:WPA;P:secret;;")).toBeNull();
  });
});
