import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ACCOUNTS, type LedgerLine } from "./accounts";
import { computeSplit } from "./split";
import {
  assertZeroSum,
  captureGroup,
  payoutGroup,
  recognitionGroup,
  refundGroup,
  type LedgerMeta,
} from "./groups";

const meta: LedgerMeta = {
  venueId: "venue-1",
  sessionId: "session-1",
  requestId: "request-1",
  memo: "test",
};

function sum(lines: LedgerLine[]): number {
  return lines.reduce((acc, l) => acc + l.amountCents, 0);
}

describe("assertZeroSum", () => {
  it("accepts a balanced group", () => {
    expect(() =>
      assertZeroSum([
        { account: ACCOUNTS.pspClearing, amountCents: 500 },
        { account: ACCOUNTS.guestEscrow, amountCents: -500 },
      ]),
    ).not.toThrow();
  });

  it("throws when the group does not sum to zero", () => {
    expect(() =>
      assertZeroSum([
        { account: ACCOUNTS.pspClearing, amountCents: 500 },
        { account: ACCOUNTS.guestEscrow, amountCents: -499 },
      ]),
    ).toThrow(/does not sum to zero/);
  });

  it("throws on zero-amount or non-integer lines", () => {
    expect(() => assertZeroSum([{ account: ACCOUNTS.pspClearing, amountCents: 0 }])).toThrow(
      /zero-amount/,
    );
    expect(() =>
      assertZeroSum([
        { account: ACCOUNTS.pspClearing, amountCents: 0.5 },
        { account: ACCOUNTS.guestEscrow, amountCents: -0.5 },
      ]),
    ).toThrow(/safe integer/);
  });
});

describe("captureGroup", () => {
  it("debits psp_clearing and credits guest_escrow, stamped with meta", () => {
    const lines = captureGroup(1100, meta);
    expect(lines).toEqual([
      { account: ACCOUNTS.pspClearing, amountCents: 1100, ...meta },
      { account: ACCOUNTS.guestEscrow, amountCents: -1100, ...meta },
    ]);
    expect(sum(lines)).toBe(0);
  });

  it("rejects non-positive amounts", () => {
    expect(() => captureGroup(0, meta)).toThrow(RangeError);
    expect(() => captureGroup(-100, meta)).toThrow(RangeError);
    expect(() => captureGroup(10.5, meta)).toThrow(RangeError);
  });
});

describe("recognitionGroup", () => {
  it("releases escrow into fee, venue and DJ payables", () => {
    const lines = recognitionGroup(computeSplit(1100, 2000, 5000), meta);
    expect(lines).toEqual([
      { account: ACCOUNTS.guestEscrow, amountCents: 1100, ...meta },
      { account: ACCOUNTS.betbeatRevenue, amountCents: -220, ...meta },
      { account: ACCOUNTS.venuePayable, amountCents: -440, ...meta },
      { account: ACCOUNTS.djPayable, amountCents: -440, ...meta },
    ]);
  });

  it("omits zero-amount lines (forbidden by the ledger table)", () => {
    // 0% fee, 100% venue → no betbeat_revenue line and no dj_payable line.
    const lines = recognitionGroup(computeSplit(100, 0, 10000), meta);
    expect(lines).toEqual([
      { account: ACCOUNTS.guestEscrow, amountCents: 100, ...meta },
      { account: ACCOUNTS.venuePayable, amountCents: -100, ...meta },
    ]);
  });

  it("sums to zero for every valid split (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_000_000 }),
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 0, max: 10000 }),
        (amount, feeBps, venueBps) => {
          const lines = recognitionGroup(computeSplit(amount, feeBps, venueBps), meta);
          expect(sum(lines)).toBe(0);
          expect(lines.every((l) => l.amountCents !== 0)).toBe(true);
        },
      ),
    );
  });

  it("rejects inconsistent or negative splits", () => {
    expect(() =>
      recognitionGroup({ amountCents: 1000, betbeatFeeCents: 200, venueCents: 400, djCents: 500 }, meta),
    ).toThrow(/do not sum/);
    expect(() =>
      recognitionGroup({ amountCents: 100, betbeatFeeCents: -50, venueCents: 100, djCents: 50 }, meta),
    ).toThrow(RangeError);
    expect(() =>
      recognitionGroup({ amountCents: 0, betbeatFeeCents: 0, venueCents: 0, djCents: 0 }, meta),
    ).toThrow(RangeError);
  });
});

describe("refundGroup", () => {
  it("returns escrow money through psp_clearing", () => {
    const lines = refundGroup(1400, meta);
    expect(lines).toEqual([
      { account: ACCOUNTS.guestEscrow, amountCents: 1400, ...meta },
      { account: ACCOUNTS.pspClearing, amountCents: -1400, ...meta },
    ]);
  });

  it("rejects non-positive amounts", () => {
    expect(() => refundGroup(0, meta)).toThrow(RangeError);
    expect(() => refundGroup(-1, meta)).toThrow(RangeError);
  });
});

describe("payoutGroup", () => {
  it("settles the venue payable through psp_clearing", () => {
    expect(payoutGroup("venue", 880, meta)).toEqual([
      { account: ACCOUNTS.venuePayable, amountCents: 880, ...meta },
      { account: ACCOUNTS.pspClearing, amountCents: -880, ...meta },
    ]);
  });

  it("settles the DJ payable through psp_clearing", () => {
    expect(payoutGroup("dj", 880, meta)).toEqual([
      { account: ACCOUNTS.djPayable, amountCents: 880, ...meta },
      { account: ACCOUNTS.pspClearing, amountCents: -880, ...meta },
    ]);
  });

  it("rejects non-positive amounts", () => {
    expect(() => payoutGroup("venue", 0, meta)).toThrow(RangeError);
    expect(() => payoutGroup("dj", -5, meta)).toThrow(RangeError);
  });
});
