import { describe, expect, it } from "vitest";
import { ACCOUNTS, type LedgerLine } from "./accounts";
import { computeSplit } from "./split";
import { captureGroup, payoutGroup, recognitionGroup, refundGroup } from "./groups";
import { deriveBalances, sessionStatement, type LedgerEntryRow } from "./balances";

const sessionId = "session-1";
const venueId = "venue-1";

function asRows(lines: LedgerLine[]): LedgerEntryRow[] {
  return lines.map((l) => ({ account: l.account, amount_cents: l.amountCents }));
}

describe("deriveBalances", () => {
  it("returns zero for every account when the ledger is empty", () => {
    expect(deriveBalances([])).toEqual({
      psp_clearing: 0,
      guest_escrow: 0,
      betbeat_revenue: 0,
      venue_payable: 0,
      dj_payable: 0,
      psp_fees: 0,
    });
  });

  it("accepts number, string and bigint amounts (pg returns bigint as string)", () => {
    const balances = deriveBalances([
      { account: ACCOUNTS.pspClearing, amount_cents: 1100 },
      { account: ACCOUNTS.pspClearing, amount_cents: "2500" },
      { account: ACCOUNTS.pspClearing, amount_cents: -600n },
      { account: ACCOUNTS.guestEscrow, amount_cents: "-3000" },
    ]);
    expect(balances.psp_clearing).toBe(3000);
    expect(balances.guest_escrow).toBe(-3000);
  });

  it("rejects non-integer and overflowing amounts", () => {
    expect(() =>
      deriveBalances([{ account: ACCOUNTS.pspClearing, amount_cents: 1.5 }]),
    ).toThrow(RangeError);
    expect(() =>
      deriveBalances([{ account: ACCOUNTS.pspClearing, amount_cents: "12.5" }]),
    ).toThrow(RangeError);
    expect(() =>
      deriveBalances([
        { account: ACCOUNTS.pspClearing, amount_cents: "9007199254740993" },
      ]),
    ).toThrow(/overflows/);
  });
});

describe("full lifecycle: capture → recognition → partial refund → payout", () => {
  // Session defaults (B4.5): 20% BetBeat fee, remainder split 50/50.
  const feeBps = 2000;
  const venueBps = 5000;

  // Request 1: QUEUE at 11 €, played in full.
  const r1 = { venueId, sessionId, requestId: "req-1" };
  // Request 2: SOON at 25 €, promise missed → demoted to the 11 € QUEUE value,
  // 14 € refunded (B4.2: failed promises refund the difference), then played.
  const r2 = { venueId, sessionId, requestId: "req-2" };

  const ledger: LedgerLine[] = [
    ...captureGroup(1100, { ...r1, memo: "capture QUEUE" }),
    ...captureGroup(2500, { ...r2, memo: "capture SOON" }),
    ...refundGroup(1400, { ...r2, memo: "sla_missed partial refund" }),
    ...recognitionGroup(computeSplit(1100, feeBps, venueBps), { ...r1, memo: "played" }),
    ...recognitionGroup(computeSplit(1100, feeBps, venueBps), { ...r2, memo: "played demoted" }),
    // Session close: pay out everything owed (440 + 440 each).
    ...payoutGroup("venue", 880, { venueId, sessionId, memo: "sepa payout" }),
    ...payoutGroup("dj", 880, { venueId, sessionId, memo: "sepa payout" }),
  ];

  it("nets every account to its expected balance", () => {
    const balances = deriveBalances(asRows(ledger));
    expect(balances).toEqual({
      // Captures 3600 − refund 1400 − payouts 1760 = 440 (BetBeat's fee cash).
      psp_clearing: 440,
      // Everything captured was either recognized or refunded.
      guest_escrow: 0,
      // Fee on 2 × 1100 recognized.
      betbeat_revenue: -440,
      // Fully paid out.
      venue_payable: 0,
      dj_payable: 0,
      psp_fees: 0,
    });
  });

  it("the whole ledger sums to zero", () => {
    const balances = deriveBalances(asRows(ledger));
    const total = Object.values(balances).reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });

  it("derives the session statement", () => {
    expect(sessionStatement(asRows(ledger))).toEqual({
      gmv: 3600, // 1100 + 2500 captured
      refunds: 1400, // SOON → QUEUE difference
      betbeatFee: 440, // 20% of 2 × 1100
      venueNet: 880, // 50% of the remainder
      djNet: 880, // the other 50%
    });
  });

  it("statement math holds mid-session too (before refund and payout)", () => {
    const midSession = [
      ...captureGroup(1100, r1),
      ...captureGroup(2500, r2),
      ...recognitionGroup(computeSplit(1100, feeBps, venueBps), r1),
    ];
    const statement = sessionStatement(asRows(midSession));
    expect(statement).toEqual({
      gmv: 3600,
      refunds: 0,
      betbeatFee: 220,
      venueNet: 440,
      djNet: 440,
    });
    // gmv − refunds = recognized + still in escrow.
    const balances = deriveBalances(asRows(midSession));
    expect(statement.gmv - statement.refunds).toBe(
      statement.betbeatFee + statement.venueNet + statement.djNet + -balances.guest_escrow,
    );
  });
});
