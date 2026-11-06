import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildCapturePayload, captureConfig, sanitizeProperties } from "./capture";
import { EVENTS } from "./events";
import { transitionFunnelEvents, type TransitionFacts } from "./funnel";

const NOW = Date.UTC(2026, 10, 7, 1, 30, 0); // injected, a Saturday night

function facts(partial: Partial<TransitionFacts>): TransitionFacts {
  return {
    event: { type: "dj_accept" },
    from: "paid",
    to: "accepted",
    tier: "SOON",
    amountCents: 2500,
    refundedCents: 0,
    closeReason: null,
    paidAtMs: NOW - 45_000,
    sessionId: "s-1",
    venueId: "v-1",
    now: NOW,
    ...partial,
  };
}

describe("captureConfig", () => {
  it("is off without a key and refuses plain http", () => {
    expect(captureConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(captureConfig({ POSTHOG_KEY: "phc_x", POSTHOG_HOST: "http://x" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
  it("defaults to the EU host and accepts the old variable names", () => {
    expect(captureConfig({ NEXT_PUBLIC_POSTHOG_KEY: "phc_x" } as unknown as NodeJS.ProcessEnv)).toEqual({
      key: "phc_x",
      host: "https://eu.i.posthog.com",
    });
  });
});

describe("sanitizeProperties", () => {
  it("drops personal data and non-primitives", () => {
    expect(
      sanitizeProperties({
        tier: "NEXT",
        amountCents: 4000,
        phone: "+351912345678",
        guestEmail: "a@b.pt",
        handle: "noite",
        message: "toca isto",
        ip: "203.0.113.9",
        long: "x".repeat(65),
        ok: true,
        none: null,
      }),
    ).toEqual({ tier: "NEXT", amountCents: 4000, ok: true, none: null });
  });

  it("builds a payload with no person profile, no IP and the injected time", () => {
    const payload = buildCapturePayload({ key: "k", host: "h" }, EVENTS.djDecision, "guest-1", { phone: "9" }, NOW);
    expect(payload).toEqual({
      api_key: "k",
      event: "dj.decision",
      distinct_id: "guest-1",
      properties: { $lib: "discontrol-server", $process_person_profile: false, $ip: null },
      timestamp: "2026-11-07T01:30:00.000Z",
    });
  });
});

describe("transitionFunnelEvents", () => {
  it("times the DJ decision from payment", () => {
    expect(transitionFunnelEvents(facts({}))).toEqual([
      {
        name: "dj.decision",
        properties: { sessionId: "s-1", venueId: "v-1", tier: "SOON", action: "accept", decisionMs: 45_000 },
      },
    ]);
  });

  it("a rejection reports the reason and the refund", () => {
    const out = transitionFunnelEvents(
      facts({ event: { type: "dj_reject", reason: "off_style" }, to: "refunded", refundedCents: 2500, closeReason: "rejected_by_dj" }),
    );
    expect(out.map((e) => e.name)).toEqual(["dj.decision", "refund.issued"]);
    expect(out[1]!.properties).toMatchObject({ amountCents: 2500, reason: "rejected_by_dj" });
  });

  it("played reports the wait", () => {
    const out = transitionFunnelEvents(
      facts({ event: { type: "track_finished" }, from: "playing", to: "played", paidAtMs: NOW - 600_000 }),
    );
    expect(out).toEqual([
      {
        name: "guest.request_played",
        properties: { sessionId: "s-1", venueId: "v-1", tier: "SOON", amountCents: 2500, waitMs: 600_000 },
      },
    ]);
  });

  it("payment outcomes", () => {
    expect(transitionFunnelEvents(facts({ event: { type: "payment_confirmed" }, from: "pending_payment", to: "paid" }))[0]!.name).toBe(
      "guest.payment_confirmed",
    );
    expect(
      transitionFunnelEvents(facts({ event: { type: "payment_expired" }, from: "pending_payment", to: "expired", paidAtMs: null })),
    ).toEqual([{ name: "payment.failed", properties: { sessionId: "s-1", venueId: "v-1", tier: "SOON", reason: "expired" } }]);
  });

  it("silent transitions emit nothing", () => {
    expect(transitionFunnelEvents(facts({ event: { type: "dj_pin" }, to: "accepted", from: "accepted" }))).toEqual([]);
  });
});
