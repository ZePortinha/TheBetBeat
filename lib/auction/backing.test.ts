import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { bidLeader, checkBackingMessage } from "./backing";

describe("who a bid belongs to", () => {
  it("stays with the bidder until a backer puts in more than them", () => {
    expect(bidLeader("a", [{ guestId: "a", amountCents: 1000, atMs: 1 }])).toBe("a");
    expect(
      bidLeader("a", [
        { guestId: "a", amountCents: 1000, atMs: 1 },
        { guestId: "b", amountCents: 1000, atMs: 2 },
      ]),
    ).toBe("a");
    expect(
      bidLeader("a", [
        { guestId: "a", amountCents: 1000, atMs: 1 },
        { guestId: "b", amountCents: 1001, atMs: 2 },
      ]),
    ).toBe("b");
  });

  it("adds up each guest's actions, and the bidder can take it back by raising", () => {
    const parts = [
      { guestId: "a", amountCents: 1000, atMs: 1 },
      { guestId: "b", amountCents: 600, atMs: 2 },
      { guestId: "b", amountCents: 600, atMs: 3 },
    ];
    expect(bidLeader("a", parts)).toBe("b");
    expect(bidLeader("a", [...parts, { guestId: "a", amountCents: 200, atMs: 4 }])).toBe("a");
  });

  it("between two backers on a tie, whoever got there first", () => {
    expect(
      bidLeader("a", [
        { guestId: "a", amountCents: 500, atMs: 1 },
        { guestId: "c", amountCents: 900, atMs: 3 },
        { guestId: "b", amountCents: 900, atMs: 2 },
      ]),
    ).toBe("b");
  });

  it("no money in it (a rolled bid before its shares land): the bidder", () => {
    expect(bidLeader("a", [])).toBe("a");
  });

  it("is always someone with the most money in it", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ guestId: fc.constantFrom("a", "b", "c", "d"), amountCents: fc.integer({ min: 1, max: 5000 }), atMs: fc.nat() }), { minLength: 1 }),
        (parts) => {
          const sum = new Map<string, number>();
          for (const p of parts) sum.set(p.guestId, (sum.get(p.guestId) ?? 0) + p.amountCents);
          const top = Math.max(...sum.values());
          const leader = bidLeader("a", parts);
          expect(sum.get(leader)).toBe(top);
          if ((sum.get("a") ?? 0) === top) expect(leader).toBe("a");
        },
      ),
    );
  });
});

describe("backing message", () => {
  it("is optional, trimmed, and at most 10 characters (an emoji counts as one)", () => {
    expect(checkBackingMessage("")).toEqual({ ok: true, message: null });
    expect(checkBackingMessage("   ")).toEqual({ ok: true, message: null });
    expect(checkBackingMessage("  força  ")).toEqual({ ok: true, message: "força" });
    expect(checkBackingMessage("bora lá 🔥🔥")).toEqual({ ok: true, message: "bora lá 🔥🔥" });
    expect(checkBackingMessage("👨‍👩‍👧 top")).toMatchObject({ ok: true });
    expect(checkBackingMessage("onze letras")).toEqual({ ok: false, reason: "too_long" });
  });

  it("refuses links and control characters", () => {
    expect(checkBackingMessage("ver x.com")).toEqual({ ok: false, reason: "invalid" });
    expect(checkBackingMessage("www.a")).toEqual({ ok: false, reason: "invalid" });
    expect(checkBackingMessage("<b>oi</b>")).toEqual({ ok: false, reason: "invalid" });
    expect(checkBackingMessage("oi\u0007")).toEqual({ ok: false, reason: "invalid" });
  });

  it("blocks insults in Portuguese and English, also disguised", () => {
    for (const bad of ["puta", "és corno", "sh1t", "c0rno", "FUUUCK", "p.u.t.a", "Caralhos", "merda!", "idiota", "s h i t"]) {
      expect(checkBackingMessage(bad), bad).toEqual({ ok: false, reason: "blocked" });
    }
  });

  it("does not block ordinary words that contain a short one", () => {
    for (const fine of ["curti", "computador", "skills", "picante", "class", "Diego", "Mesa 7", "obrigado!"]) {
      expect(checkBackingMessage(fine).ok, fine).toBe(true);
    }
  });
});
