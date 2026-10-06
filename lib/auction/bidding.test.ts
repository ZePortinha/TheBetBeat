import { describe, expect, it } from "vitest";
import { closeOutcome, countdownState, decideBid, minIncrement, minNextBid, quickBids } from "./bidding";
import { DEFAULT_AUCTION_CONFIG as rules } from "./config";

const S = Date.UTC(2026, 9, 3, 1, 15); // planned close
const open = S - 240_000;
const bid = (over: Partial<Parameters<typeof decideBid>[0]>) =>
  decideBid(
    { opensAtMs: open, closesAtMs: S, scheduledClosesAtMs: S, topCents: 1000, minPriceCents: 500, totalCents: 1100, now: S - 120_000, ...over },
    rules,
  );

describe("minimum increment: the larger of 1 € and 5%", () => {
  it("is 1 € up to 20 € and 5% above", () => {
    expect(minIncrement(1000, rules)).toBe(100);
    expect(minIncrement(2000, rules)).toBe(100);
    expect(minIncrement(4000, rules)).toBe(200);
    expect(minIncrement(4010, rules)).toBe(201); // rounds up, never down
    expect(minNextBid(null, 500, rules)).toBe(500); // first bid: the minimum price
    expect(minNextBid(4000, 500, rules)).toBe(4200);
  });

  it("accepts exactly the minimum and rejects a cent less", () => {
    expect(bid({ totalCents: 1100 })).toEqual({ ok: true, closesAtMs: S, extended: false });
    expect(bid({ totalCents: 1099 })).toEqual({ ok: false, reason: "below_minimum" });
    expect(bid({ topCents: null, totalCents: 499 })).toEqual({ ok: false, reason: "below_minimum" });
    expect(bid({ totalCents: rules.maxBidCents + 1 })).toEqual({ ok: false, reason: "above_maximum" });
  });

  it("offers +1 € / +5 € / +10 € as totals, lifted to the minimum", () => {
    expect(quickBids(null, 500, rules)).toEqual([500, 900, 1400]);
    expect(quickBids(2000, 500, rules)).toEqual([2100, 2500, 3000]);
    expect(quickBids(4000, 500, rules)).toEqual([4200, 4500, 5000]); // +1 € is below the 5% step
  });
});

describe("server clock and soft close", () => {
  it("only takes bids while open (the close instant is already closed)", () => {
    expect(bid({ now: open - 1 })).toEqual({ ok: false, reason: "not_open" });
    expect(bid({ now: S })).toEqual({ ok: false, reason: "closed" });
  });

  it("pushes the close 30 s for a bid in the last 30 s", () => {
    expect(bid({ now: S - 31_000 })).toEqual({ ok: true, closesAtMs: S, extended: false });
    expect(bid({ now: S - 20_000 })).toEqual({ ok: true, closesAtMs: S + 30_000, extended: true });
  });

  it("never extends past 3 minutes in total", () => {
    // Already at +170 s: the next extension stops at +180 s…
    expect(bid({ closesAtMs: S + 170_000, now: S + 150_000 })).toEqual({ ok: true, closesAtMs: S + 180_000, extended: true });
    // …and at the cap the bid still counts, without moving the close.
    expect(bid({ closesAtMs: S + 180_000, now: S + 179_000 })).toEqual({ ok: true, closesAtMs: S + 180_000, extended: false });
    expect(bid({ closesAtMs: S + 180_000, now: S + 180_000 })).toEqual({ ok: false, reason: "closed" });
  });

  it("warns in the last minute and settles on the minimum price", () => {
    expect(countdownState(S, S - 61_000, rules)).toBe("open");
    expect(countdownState(S, S - 60_000, rules)).toBe("last_minute");
    expect(countdownState(S, S, rules)).toBe("closed");
    expect(closeOutcome(null, 500)).toBe("no_winner"); // nobody reached it: the slot is the DJ's, no charge
    expect(closeOutcome(500, 500)).toBe("won");
  });
});
