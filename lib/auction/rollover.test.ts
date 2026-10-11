import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { balanceDeadline, canPlaceRollover, expiredCents, rolloverShares, runnerUp } from "./rollover";

const DAY = 86_400_000;

describe("runnerUp", () => {
  it("picks the loser that led with the highest total", () => {
    const losers = [
      { id: "a", lastTotalCents: 500 },
      { id: "b", lastTotalCents: 900 },
      { id: "c", lastTotalCents: 700 },
    ];
    expect(runnerUp(losers)?.id).toBe("b");
  });

  it("is null when no other bid ever led", () => {
    expect(runnerUp([{ id: "a", lastTotalCents: 0 }])).toBeNull();
    expect(runnerUp([])).toBeNull();
  });
});

describe("rolloverShares", () => {
  it("rolls each contributor's part, capped by their balance", () => {
    const shares = rolloverShares(
      [
        { guestId: "owner", amountCents: 600 },
        { guestId: "friend", amountCents: 400 },
        { guestId: "owner", amountCents: 200 },
      ],
      new Map([
        ["owner", 1000],
        ["friend", 150],
      ]),
    );
    expect(shares).toEqual([
      { guestId: "owner", amountCents: 800 },
      { guestId: "friend", amountCents: 150 },
    ]);
  });

  it("drops guests whose balance is empty", () => {
    expect(rolloverShares([{ guestId: "x", amountCents: 500 }], new Map([["x", 0]]))).toEqual([]);
  });

  it("never rolls more than asked or more than the balance", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ guestId: fc.constantFrom("a", "b", "c"), amountCents: fc.integer({ min: 1, max: 10_000 }) })),
        fc.dictionary(fc.constantFrom("a", "b", "c"), fc.integer({ min: -100, max: 10_000 })),
        (parts, bal) => {
          const balances = new Map(Object.entries(bal));
          for (const s of rolloverShares(parts, balances)) {
            const asked = parts.filter((p) => p.guestId === s.guestId).reduce((n, p) => n + p.amountCents, 0);
            expect(s.amountCents).toBeGreaterThan(0);
            expect(s.amountCents).toBeLessThanOrEqual(asked);
            expect(s.amountCents).toBeLessThanOrEqual(balances.get(s.guestId) ?? 0);
          }
        },
      ),
    );
  });
});

describe("canPlaceRollover", () => {
  it("opens the auction when it reaches the minimum", () => {
    expect(canPlaceRollover(1000, 1000, false)).toEqual({ ok: true });
  });
  it("says why it cannot", () => {
    expect(canPlaceRollover(500, 1000, false)).toEqual({ ok: false, reason: "below_minimum" });
    expect(canPlaceRollover(500, 1000, true)).toEqual({ ok: false, reason: "outbid_already" });
  });
});

describe("balance 7 days", () => {
  const now = 100 * DAY;

  it("only money older than the window expires, oldest first", () => {
    const credits = [
      { amountCents: 1000, atMs: now - 10 * DAY },
      { amountCents: 500, atMs: now - 2 * DAY },
    ];
    // 1500 in, 300 spent since: the spend ate old money first.
    expect(expiredCents(1200, credits, now, 7)).toBe(700);
    expect(expiredCents(400, credits, now, 7)).toBe(0);
  });

  it("the deadline is set by the oldest euro still there", () => {
    const credits = [
      { amountCents: 1000, atMs: now - 10 * DAY },
      { amountCents: 500, atMs: now - 2 * DAY },
    ];
    expect(balanceDeadline(400, credits, 7)).toBe(now - 2 * DAY + 7 * DAY);
    expect(balanceDeadline(1200, credits, 7)).toBe(now - 10 * DAY + 7 * DAY);
    expect(balanceDeadline(0, credits, 7)).toBeNull();
  });

  it("expired money is exactly what is past the deadline", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ amountCents: fc.integer({ min: 1, max: 5000 }), atMs: fc.integer({ min: 0, max: 30 * DAY }) }), {
          minLength: 1,
        }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 40 * DAY }),
        (credits, keepPct, now) => {
          const total = credits.reduce((n, c) => n + c.amountCents, 0);
          const balance = Math.floor((total * keepPct) / 100);
          const deadline = balanceDeadline(balance, credits, 7);
          const expired = expiredCents(balance, credits, now, 7);
          if (deadline === null) expect(balance).toBe(0);
          // Nothing expires before the deadline; something does after it.
          if (deadline !== null && now < deadline) expect(expired).toBe(0);
          if (deadline !== null && now >= deadline) expect(expired).toBeGreaterThan(0);
        },
      ),
    );
  });
});
