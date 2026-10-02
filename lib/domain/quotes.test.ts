import { describe, expect, it, vi } from "vitest";
import type { TierQuote } from "@/lib/pricing/types";

// quotes.ts is server-only and pulls the db module (which validates env
// at load); unit tests only exercise the PURE helpers.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/security/env", () => ({
  env: { DATABASE_URL: "postgresql://unit:test@localhost:5432/unused" },
}));

const { quotedPricesFromTiers, validateQuoteChoice, QUOTE_TTL_MS } = await import(
  "./quotes"
);

function tier(
  t: TierQuote["tier"],
  priceCents: number,
  available = true,
  reason?: TierQuote["reason"],
): TierQuote {
  const quote: TierQuote = {
    tier: t,
    priceCents,
    etaMin: 5,
    etaDisplayMin: 5,
    available,
  };
  if (reason) quote.reason = reason;
  return quote;
}

const TIERS_FIXTURE: TierQuote[] = [
  tier("QUEUE", 1100),
  tier("SOON", 2500),
  tier("NEXT", 4000, false, "next_taken"),
];

describe("quotedPricesFromTiers", () => {
  it("maps each tier's quoted price for the state machine", () => {
    expect(quotedPricesFromTiers(TIERS_FIXTURE)).toEqual({
      queueCents: 1100,
      soonCents: 2500,
      nextCents: 4000,
    });
  });

  it("defaults a missing tier to 0 instead of throwing", () => {
    expect(quotedPricesFromTiers([tier("QUEUE", 900)])).toEqual({
      queueCents: 900,
      soonCents: 0,
      nextCents: 0,
    });
  });
});

describe("validateQuoteChoice", () => {
  const now = 1_700_000_000_000;
  const base = {
    tiers: TIERS_FIXTURE,
    tierMaxCents: 6000,
    expiresAtMs: now + QUOTE_TTL_MS,
    now,
  };

  it("accepts the exact quoted price", () => {
    const res = validateQuoteChoice({ ...base, tier: "QUEUE", amountCents: 1100 });
    expect(res).toEqual({ ok: true, tierQuote: TIERS_FIXTURE[0] });
  });

  it("allows free extra value up to the tier max (B4.1)", () => {
    expect(
      validateQuoteChoice({ ...base, tier: "QUEUE", amountCents: 6000 }).ok,
    ).toBe(true);
  });

  it("rejects paying below the quoted price", () => {
    expect(validateQuoteChoice({ ...base, tier: "QUEUE", amountCents: 1099 })).toEqual({
      ok: false,
      error: "amount_below_price",
    });
  });

  it("rejects amounts above the tier limit", () => {
    expect(validateQuoteChoice({ ...base, tier: "QUEUE", amountCents: 6001 })).toEqual({
      ok: false,
      error: "amount_above_limit",
    });
  });

  it("rejects non-integer and non-positive amounts", () => {
    for (const amountCents of [1100.5, 0, -5, Number.NaN]) {
      expect(validateQuoteChoice({ ...base, tier: "QUEUE", amountCents })).toEqual({
        ok: false,
        error: "invalid_amount",
      });
    }
  });

  it("rejects an unavailable tier", () => {
    expect(validateQuoteChoice({ ...base, tier: "NEXT", amountCents: 4000 })).toEqual({
      ok: false,
      error: "tier_unavailable",
    });
  });

  it("rejects an expired quote — boundary is exact (B4.3: 120 s)", () => {
    expect(
      validateQuoteChoice({
        ...base,
        now: base.expiresAtMs,
        tier: "QUEUE",
        amountCents: 1100,
      }),
    ).toEqual({ ok: false, error: "quote_expired" });
    expect(
      validateQuoteChoice({
        ...base,
        now: base.expiresAtMs - 1,
        tier: "QUEUE",
        amountCents: 1100,
      }).ok,
    ).toBe(true);
  });
});
