/**
 * Exhaustive tests for the request lifecycle state machine (B4.1, B4.2,
 * B4.4, B7): every legal transition with its exact effects, every
 * illegal combination rejected, and fast-check properties proving the
 * machine can never lose money or refund twice.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  REQUEST_EVENT_TYPES,
  TERMINAL_REQUEST_STATUSES,
  decisionDeadlineAtMs,
  decisionWindowMinutes,
  isTerminalStatus,
  promiseDeadlineAtMs,
  transition,
  type Effect,
  type RequestEvent,
  type RequestEventType,
  type TransitionContext,
} from "./machine";
import {
  DEFAULT_SESSION_CONFIG,
  REQUEST_STATUSES,
  TIERS,
  type RejectReason,
  type RequestStatus,
  type SessionConfig,
  type Tier,
} from "./types";

const MIN_MS = 60_000;
const NOW = Date.UTC(2026, 9, 2, 23, 0, 0); // a fixed Friday night, injected

const QUOTED = { queueCents: 1100, soonCents: 2500, nextCents: 4000 };

function ctxFor(partial: Partial<TransitionContext> = {}): TransitionContext {
  return {
    now: NOW,
    tier: "SOON",
    amountCents: QUOTED.soonCents,
    quotedPrices: QUOTED,
    config: DEFAULT_SESSION_CONFIG,
    paidAtMs: NOW - 2 * MIN_MS,
    ...partial,
  };
}

/** One representative event per type (payload-carrying ones get sane payloads). */
function eventOf(type: RequestEventType): RequestEvent {
  switch (type) {
    case "dj_reject":
      return { type, reason: "off_style" };
    case "upgrade_tier":
      return {
        type,
        toTier: "NEXT",
        newAmountCents: 4200,
        newDeadlineAtMs: NOW + 10 * MIN_MS,
      };
    default:
      return { type } as RequestEvent;
  }
}

function effectTypes(effects: Effect[]): string[] {
  return effects.map((e) => e.type);
}

/* ------------------------------------------------------------------ */
/* The full legality grid: 7 statuses × 14 events                      */
/* ------------------------------------------------------------------ */

// With ctx = SOON tier and an upgrade targeting NEXT, these are ALL the
// legal (status, event) pairs. Everything else must return ok: false.
const LEGAL: Record<RequestStatus, readonly RequestEventType[]> = {
  pending_payment: ["payment_confirmed", "payment_failed", "payment_expired", "session_ended"],
  paid: ["dj_accept", "dj_reject", "decision_timeout", "sla_missed", "session_ended", "upgrade_tier"],
  accepted: [
    "dj_pin",
    "dj_unpin",
    "dj_cancel",
    "dj_mark_playing",
    "sla_missed",
    "session_ended",
    "upgrade_tier",
  ],
  playing: ["track_finished", "session_ended"],
  played: [],
  expired: [],
  refunded: [],
};

describe("transition legality grid", () => {
  for (const status of REQUEST_STATUSES) {
    for (const type of REQUEST_EVENT_TYPES) {
      const legal = LEGAL[status].includes(type);
      it(`${status} + ${type} → ${legal ? "ok" : "rejected"}`, () => {
        const res = transition(status, eventOf(type), ctxFor());
        expect(res.ok).toBe(legal);
        if (!res.ok) {
          expect(res.error).toBeTypeOf("string");
          expect(res.error.length).toBeGreaterThan(0);
        }
      });
    }
  }

  it("terminal states absorb every event (never refund twice)", () => {
    for (const status of TERMINAL_REQUEST_STATUSES) {
      expect(isTerminalStatus(status)).toBe(true);
      for (const type of REQUEST_EVENT_TYPES) {
        expect(transition(status, eventOf(type), ctxFor()).ok).toBe(false);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* payment_confirmed — decision windows per tier (B4.1)                */
/* ------------------------------------------------------------------ */

describe("payment_confirmed", () => {
  const windows: Record<Tier, number> = { NEXT: 3, SOON: 5, QUEUE: 10 };
  const promises: Record<Tier, number | null> = { NEXT: 10, SOON: 20, QUEUE: null };

  for (const tier of TIERS) {
    it(`${tier}: schedules a ${windows[tier]} min decision window from paidAt`, () => {
      const res = transition("pending_payment", eventOf("payment_confirmed"), ctxFor({ tier, paidAtMs: null }));
      if (!res.ok) throw new Error(res.error);
      expect(res.next).toBe("paid");
      expect(res.closeReason).toBeUndefined();

      const expected: Effect[] = [
        { type: "schedule_deadline", atMs: NOW + windows[tier] * MIN_MS, kind: "decision" },
      ];
      const promiseMin = promises[tier];
      if (promiseMin !== null) {
        expected.push({ type: "schedule_deadline", atMs: NOW + promiseMin * MIN_MS, kind: "promise" });
      }
      expected.push({ type: "publish", event: "request.paid" });
      expect(res.effects).toEqual(expected);
    });
  }

  it("windows are configurable per session", () => {
    const config: SessionConfig = {
      ...DEFAULT_SESSION_CONFIG,
      decisionWindowNextMin: 2,
      decisionWindowSoonMin: 7,
      decisionWindowQueueMin: 15,
      nextDeadlineMin: 6,
      soonDeadlineMin: 30,
    };
    const res = transition("pending_payment", eventOf("payment_confirmed"), ctxFor({ tier: "NEXT", config }));
    if (!res.ok) throw new Error(res.error);
    expect(res.effects).toContainEqual({ type: "schedule_deadline", atMs: NOW + 2 * MIN_MS, kind: "decision" });
    expect(res.effects).toContainEqual({ type: "schedule_deadline", atMs: NOW + 6 * MIN_MS, kind: "promise" });

    expect(decisionWindowMinutes("SOON", config)).toBe(7);
    expect(decisionDeadlineAtMs("QUEUE", config, NOW)).toBe(NOW + 15 * MIN_MS);
    expect(promiseDeadlineAtMs("SOON", config, NOW)).toBe(NOW + 30 * MIN_MS);
    expect(promiseDeadlineAtMs("QUEUE", config, NOW)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Payment failures and expiries                                       */
/* ------------------------------------------------------------------ */

describe("payment failure / expiry", () => {
  for (const type of ["payment_failed", "payment_expired"] as const) {
    it(`${type}: pending_payment → expired/payment_timeout, no money effects`, () => {
      const res = transition("pending_payment", eventOf(type), ctxFor({ paidAtMs: null }));
      if (!res.ok) throw new Error(res.error);
      expect(res.next).toBe("expired");
      expect(res.closeReason).toBe("payment_timeout");
      expect(res.effects).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------------ */
/* DJ decisions (B7)                                                   */
/* ------------------------------------------------------------------ */

describe("DJ decisions", () => {
  it("dj_accept: paid → accepted, publishes request.accepted, no money moves", () => {
    const res = transition("paid", eventOf("dj_accept"), ctxFor());
    if (!res.ok) throw new Error(res.error);
    expect(res.next).toBe("accepted");
    expect(res.closeReason).toBeUndefined();
    expect(res.effects).toEqual([{ type: "publish", event: "request.accepted" }]);
  });

  it("dj_reject: paid → refunded/rejected_by_dj with a full refund", () => {
    const res = transition("paid", { type: "dj_reject", reason: "missing_track" }, ctxFor());
    if (!res.ok) throw new Error(res.error);
    expect(res.next).toBe("refunded");
    expect(res.closeReason).toBe("rejected_by_dj");
    expect(res.effects).toEqual([
      { type: "refund_full" },
      { type: "publish", event: "request.rejected" },
    ]);
  });

  it("decision_timeout: paid → refunded/dj_timeout with a full refund", () => {
    const res = transition("paid", eventOf("decision_timeout"), ctxFor());
    if (!res.ok) throw new Error(res.error);
    expect(res.next).toBe("refunded");
    expect(res.closeReason).toBe("dj_timeout");
    expect(effectTypes(res.effects)).toEqual(["refund_full", "publish"]);
  });

  it("decision_timeout after a decision is a stale job → rejected", () => {
    expect(transition("accepted", eventOf("decision_timeout"), ctxFor()).ok).toBe(false);
    expect(transition("playing", eventOf("decision_timeout"), ctxFor()).ok).toBe(false);
  });

  it("dj_cancel: accepted → refunded/cancelled_by_dj with a full refund", () => {
    const res = transition("accepted", eventOf("dj_cancel"), ctxFor());
    if (!res.ok) throw new Error(res.error);
    expect(res.next).toBe("refunded");
    expect(res.closeReason).toBe("cancelled_by_dj");
    expect(res.effects).toEqual([
      { type: "refund_full" },
      { type: "publish", event: "request.refunded" },
    ]);
  });

  it("dj_pin / dj_unpin keep the request accepted and only publish", () => {
    const pin = transition("accepted", eventOf("dj_pin"), ctxFor());
    if (!pin.ok) throw new Error(pin.error);
    expect(pin.next).toBe("accepted");
    expect(pin.effects).toEqual([{ type: "publish", event: "request.pinned" }]);

    const unpin = transition("accepted", eventOf("dj_unpin"), ctxFor());
    if (!unpin.ok) throw new Error(unpin.error);
    expect(unpin.next).toBe("accepted");
    expect(unpin.effects).toEqual([{ type: "publish", event: "queue.changed" }]);
  });

  it("dj_mark_playing: accepted → playing, captures the CURRENT amount", () => {
    const res = transition("accepted", eventOf("dj_mark_playing"), ctxFor({ amountCents: 3100 }));
    if (!res.ok) throw new Error(res.error);
    expect(res.next).toBe("playing");
    expect(res.effects).toEqual([
      { type: "capture", amountCents: 3100 },
      { type: "publish", event: "request.playing" },
    ]);
  });

  it("dj_mark_playing straight from paid is rejected (accept first)", () => {
    expect(transition("paid", eventOf("dj_mark_playing"), ctxFor()).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* track_finished                                                      */
/* ------------------------------------------------------------------ */

describe("track_finished", () => {
  it("playing → played, with invoice + share card effects", () => {
    const res = transition("playing", eventOf("track_finished"), ctxFor());
    if (!res.ok) throw new Error(res.error);
    expect(res.next).toBe("played");
    expect(res.closeReason).toBeUndefined();
    expect(res.effects).toEqual([
      { type: "publish", event: "request.played" },
      { type: "issue_invoice" },
      { type: "generate_share_card" },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* sla_missed — demotion refunds exactly quoted amount − queue price   */
/* ------------------------------------------------------------------ */

describe("sla_missed", () => {
  for (const status of ["paid", "accepted"] as const) {
    for (const tier of ["SOON", "NEXT"] as const) {
      it(`${status}/${tier}: stays ${status}, demotes and refunds the exact difference`, () => {
        const amount = tier === "SOON" ? QUOTED.soonCents : QUOTED.nextCents;
        const res = transition(status, eventOf("sla_missed"), ctxFor({ tier, amountCents: amount }));
        if (!res.ok) throw new Error(res.error);
        expect(res.next).toBe(status); // SAME status — the request stays in the queue
        expect(res.closeReason).toBeUndefined();
        expect(res.effects).toEqual([
          { type: "demote_to_queue" },
          { type: "refund_difference", amountCents: amount - QUOTED.queueCents },
          { type: "publish", event: "request.sla_missed" },
        ]);
      });
    }
  }

  it("refunds against the ORIGINAL quote's queue price, including free extra amounts", () => {
    // Guest paid 50 € on a SOON quoted at 25 € (free extra value).
    const res = transition("accepted", eventOf("sla_missed"), ctxFor({ tier: "SOON", amountCents: 5000 }));
    if (!res.ok) throw new Error(res.error);
    expect(res.effects).toContainEqual({
      type: "refund_difference",
      amountCents: 5000 - QUOTED.queueCents,
    });
  });

  it("floors the difference at 0 — demotes without a refund effect", () => {
    // Pathological: amount below the quoted QUEUE price. Never pay out.
    const res = transition("paid", eventOf("sla_missed"), ctxFor({ tier: "SOON", amountCents: 900 }));
    if (!res.ok) throw new Error(res.error);
    expect(effectTypes(res.effects)).toEqual(["demote_to_queue", "publish"]);
  });

  it("is rejected for QUEUE requests (no fixed promise) and after demotion", () => {
    expect(transition("paid", eventOf("sla_missed"), ctxFor({ tier: "QUEUE" })).ok).toBe(false);
    expect(transition("accepted", eventOf("sla_missed"), ctxFor({ tier: "QUEUE" })).ok).toBe(false);
  });

  it("is rejected once the track is playing or played (B4.2)", () => {
    expect(transition("playing", eventOf("sla_missed"), ctxFor()).ok).toBe(false);
    expect(transition("played", eventOf("sla_missed"), ctxFor()).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* session_ended                                                       */
/* ------------------------------------------------------------------ */

describe("session_ended", () => {
  it("pending_payment → expired/payment_timeout without money effects", () => {
    const res = transition("pending_payment", eventOf("session_ended"), ctxFor({ paidAtMs: null }));
    if (!res.ok) throw new Error(res.error);
    expect(res.next).toBe("expired");
    expect(res.closeReason).toBe("payment_timeout");
    expect(res.effects).toEqual([]);
  });

  for (const status of ["paid", "accepted", "playing"] as const) {
    it(`${status} → refunded/session_ended with a full refund`, () => {
      const res = transition(status, eventOf("session_ended"), ctxFor());
      if (!res.ok) throw new Error(res.error);
      expect(res.next).toBe("refunded");
      expect(res.closeReason).toBe("session_ended");
      expect(res.effects).toEqual([
        { type: "refund_full" },
        { type: "publish", event: "request.refunded" },
      ]);
    });
  }

  it("already-closed requests are untouched", () => {
    for (const status of TERMINAL_REQUEST_STATUSES) {
      expect(transition(status, eventOf("session_ended"), ctxFor()).ok).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */
/* upgrade_tier — difference against CURRENT prices (B4.1)             */
/* ------------------------------------------------------------------ */

describe("upgrade_tier", () => {
  const upgrade = (
    toTier: Tier,
    newAmountCents: number,
    newDeadlineAtMs = NOW + 10 * MIN_MS,
  ): RequestEvent => ({ type: "upgrade_tier", toTier, newAmountCents, newDeadlineAtMs });

  it("charges exactly the difference against the CURRENT price passed in", () => {
    // Original quote said NEXT = 4000, but the CURRENT price is 4600:
    // the difference must be computed against 4600, not the old quote.
    const res = transition("paid", upgrade("NEXT", 4600), ctxFor({ tier: "SOON", amountCents: 2500 }));
    if (!res.ok) throw new Error(res.error);
    expect(res.next).toBe("paid");
    expect(res.effects).toContainEqual({ type: "charge_difference", amountCents: 2100 });
  });

  it("restarts the promise deadline from now and publishes queue.changed", () => {
    const deadline = NOW + 10 * MIN_MS;
    const res = transition("accepted", upgrade("NEXT", 4600, deadline), ctxFor({ tier: "SOON", amountCents: 2500 }));
    if (!res.ok) throw new Error(res.error);
    expect(res.next).toBe("accepted");
    expect(res.effects).toEqual([
      { type: "charge_difference", amountCents: 2100 },
      { type: "schedule_deadline", atMs: deadline, kind: "promise" },
      { type: "publish", event: "queue.changed" },
    ]);
  });

  it("while undecided (paid), also restarts the decision window on the new tier", () => {
    const res = transition("paid", upgrade("NEXT", 4600), ctxFor({ tier: "QUEUE", amountCents: 1100 }));
    if (!res.ok) throw new Error(res.error);
    expect(res.effects).toContainEqual({
      type: "schedule_deadline",
      atMs: NOW + DEFAULT_SESSION_CONFIG.decisionWindowNextMin * MIN_MS,
      kind: "decision",
    });
  });

  it("is free (no charge effect) when the guest already paid more than the new price", () => {
    const res = transition("paid", upgrade("NEXT", 4600), ctxFor({ tier: "SOON", amountCents: 5000 }));
    if (!res.ok) throw new Error(res.error);
    expect(effectTypes(res.effects)).toEqual(["schedule_deadline", "schedule_deadline", "publish"]);
  });

  it("QUEUE → SOON and QUEUE → NEXT are allowed; downgrades and same-tier are not", () => {
    expect(transition("paid", upgrade("SOON", 2600), ctxFor({ tier: "QUEUE", amountCents: 1100 })).ok).toBe(true);
    expect(transition("paid", upgrade("NEXT", 4600), ctxFor({ tier: "QUEUE", amountCents: 1100 })).ok).toBe(true);
    expect(transition("paid", upgrade("SOON", 2600), ctxFor({ tier: "SOON" })).ok).toBe(false);
    expect(transition("paid", upgrade("QUEUE", 1100), ctxFor({ tier: "NEXT" })).ok).toBe(false);
    expect(transition("paid", upgrade("SOON", 2600), ctxFor({ tier: "NEXT" })).ok).toBe(false);
  });

  it("rejects malformed payloads instead of throwing", () => {
    const base = ctxFor({ tier: "QUEUE", amountCents: 1100 });
    expect(transition("paid", upgrade("SOON", 0), base).ok).toBe(false);
    expect(transition("paid", upgrade("SOON", -500), base).ok).toBe(false);
    expect(transition("paid", upgrade("SOON", 25.5), base).ok).toBe(false);
    expect(transition("paid", upgrade("SOON", 2600, NOW), base).ok).toBe(false); // deadline not after now
    expect(transition("paid", upgrade("SOON", 2600, Number.NaN), base).ok).toBe(false);
  });

  it("is only available before the track plays", () => {
    const ev = upgrade("NEXT", 4600);
    expect(transition("playing", ev, ctxFor({ tier: "SOON" })).ok).toBe(false);
    expect(transition("played", ev, ctxFor({ tier: "SOON" })).ok).toBe(false);
    expect(transition("pending_payment", ev, ctxFor({ tier: "SOON" })).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* fast-check properties                                               */
/* ------------------------------------------------------------------ */

/**
 * Event SPECS get materialized against the live model so payloads stay
 * coherent (deadlines after now, etc.). `stepMs` advances the clock.
 */
interface EventSpec {
  stepMs: number;
  type: RequestEventType;
  toTier: Tier;
  extraCents: number;
  deadlineOffsetMs: number;
}

const eventSpecArb: fc.Arbitrary<EventSpec> = fc.record({
  stepMs: fc.integer({ min: 0, max: 30 * MIN_MS }),
  type: fc.constantFrom(...REQUEST_EVENT_TYPES),
  toTier: fc.constantFrom(...TIERS),
  extraCents: fc.integer({ min: 0, max: 5000 }),
  deadlineOffsetMs: fc.integer({ min: 1, max: 60 * MIN_MS }),
});

const quotedArb = fc
  .record({
    queueCents: fc.integer({ min: 500, max: 6000 }),
    soonStep: fc.integer({ min: 500, max: 6000 }),
    nextStep: fc.integer({ min: 500, max: 8000 }),
  })
  .map(({ queueCents, soonStep, nextStep }) => ({
    queueCents,
    soonCents: queueCents + soonStep,
    nextCents: queueCents + soonStep + nextStep,
  }));

interface Model {
  status: RequestStatus;
  tier: Tier;
  amountCents: number; // money currently held for the request
  paidAtMs: number | null;
  now: number;
  paidTotal: number;
  refundTotal: number;
  capturedTotal: number;
  refundFullCount: number;
}

function runModel(
  startTier: Tier,
  quoted: { queueCents: number; soonCents: number; nextCents: number },
  extraCents: number,
  specs: EventSpec[],
): Model {
  const tierPrice =
    startTier === "QUEUE" ? quoted.queueCents : startTier === "SOON" ? quoted.soonCents : quoted.nextCents;
  const model: Model = {
    status: "pending_payment",
    tier: startTier,
    amountCents: tierPrice + extraCents,
    paidAtMs: null,
    now: NOW,
    paidTotal: 0,
    refundTotal: 0,
    capturedTotal: 0,
    refundFullCount: 0,
  };

  for (const spec of specs) {
    model.now += spec.stepMs;
    const event: RequestEvent =
      spec.type === "upgrade_tier"
        ? {
            type: "upgrade_tier",
            toTier: spec.toTier,
            newAmountCents: Math.max(1, model.amountCents + spec.extraCents),
            newDeadlineAtMs: model.now + spec.deadlineOffsetMs,
          }
        : spec.type === "dj_reject"
          ? { type: "dj_reject", reason: "other" }
          : ({ type: spec.type } as RequestEvent);

    const ctx: TransitionContext = {
      now: model.now,
      tier: model.tier,
      amountCents: model.amountCents,
      quotedPrices: quoted,
      config: DEFAULT_SESSION_CONFIG,
      paidAtMs: model.paidAtMs,
    };

    const wasTerminal = isTerminalStatus(model.status);
    const res = transition(model.status, event, ctx);

    // Terminal states absorb: nothing is ever ok after closing.
    if (wasTerminal) expect(res.ok).toBe(false);
    if (!res.ok) continue;

    expect(REQUEST_STATUSES).toContain(res.next);

    if (event.type === "payment_confirmed") {
      model.paidTotal += model.amountCents;
      model.paidAtMs = model.now;
    }
    if (event.type === "upgrade_tier") {
      model.tier = event.toTier;
    }
    for (const effect of res.effects) {
      switch (effect.type) {
        case "refund_full":
          model.refundFullCount += 1;
          model.refundTotal += model.amountCents;
          model.amountCents = 0;
          break;
        case "refund_difference":
          expect(effect.amountCents).toBeGreaterThan(0);
          expect(effect.amountCents).toBeLessThanOrEqual(model.amountCents);
          model.refundTotal += effect.amountCents;
          model.amountCents -= effect.amountCents;
          break;
        case "charge_difference":
          expect(effect.amountCents).toBeGreaterThan(0);
          model.paidTotal += effect.amountCents;
          model.amountCents += effect.amountCents;
          break;
        case "capture":
          // Captures settle exactly what is held — never more.
          expect(effect.amountCents).toBe(model.amountCents);
          model.capturedTotal += effect.amountCents;
          break;
        case "demote_to_queue":
          model.tier = "QUEUE";
          break;
        default:
          break;
      }
    }
    model.status = res.next;

    // Step invariants. (Captured money may legitimately be refunded
    // later — session_ended while playing — so the only money law is:
    // never give back more than was taken.)
    expect(model.amountCents).toBeGreaterThanOrEqual(0);
    expect(model.refundTotal).toBeLessThanOrEqual(model.paidTotal);
    expect(model.refundFullCount).toBeLessThanOrEqual(1);
  }
  return model;
}

describe("fast-check properties", () => {
  it("any event sequence: valid states only, refunds never exceed what was paid, never refunds twice", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TIERS),
        quotedArb,
        fc.integer({ min: 0, max: 10_000 }),
        fc.array(eventSpecArb, { maxLength: 40 }),
        (startTier, quoted, extraCents, specs) => {
          const model = runModel(startTier, quoted, extraCents, specs);
          expect(REQUEST_STATUSES).toContain(model.status);
          expect(model.refundTotal).toBeLessThanOrEqual(model.paidTotal);
          expect(model.refundFullCount).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("transition never throws, for ANY status/event/ctx combination", () => {
    const anyCtxArb: fc.Arbitrary<TransitionContext> = fc.record({
      now: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
      tier: fc.constantFrom(...TIERS),
      amountCents: fc.integer({ min: -1000, max: 1_000_000 }),
      quotedPrices: fc.record({
        queueCents: fc.integer({ min: -1000, max: 100_000 }),
        soonCents: fc.integer({ min: -1000, max: 100_000 }),
        nextCents: fc.integer({ min: -1000, max: 100_000 }),
      }),
      config: fc.constant(DEFAULT_SESSION_CONFIG),
      paidAtMs: fc.option(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), { nil: null }),
    });
    const anyEventArb: fc.Arbitrary<RequestEvent> = fc.oneof(
      fc.constantFrom(...REQUEST_EVENT_TYPES.filter((t) => t !== "upgrade_tier" && t !== "dj_reject")).map(
        (type) => ({ type }) as RequestEvent,
      ),
      fc
        .constantFrom<RejectReason>("off_style", "missing_track", "already_played", "other")
        .map((reason): RequestEvent => ({ type: "dj_reject", reason })),
      fc.record({
        type: fc.constant("upgrade_tier" as const),
        toTier: fc.constantFrom(...TIERS),
        newAmountCents: fc.oneof(
          fc.integer({ min: -10_000, max: 1_000_000 }),
          fc.constant(Number.NaN),
          fc.double(),
        ),
        newDeadlineAtMs: fc.oneof(
          fc.integer({ min: -10, max: Number.MAX_SAFE_INTEGER }),
          fc.constant(Number.NaN),
        ),
      }) as fc.Arbitrary<RequestEvent>,
    );

    fc.assert(
      fc.property(
        fc.constantFrom(...REQUEST_STATUSES),
        anyEventArb,
        anyCtxArb,
        (status, event, ctx) => {
          const res = transition(status, event, ctx);
          expect(typeof res.ok).toBe("boolean");
        },
      ),
      { numRuns: 500 },
    );
  });

  it("a full happy path with an SLA miss balances to the cent", () => {
    // SOON at 2500 (queue quoted 1100) → paid → accepted → SLA missed
    // (refund 1400, now a QUEUE holding 1100) → playing captures 1100.
    const quoted = { queueCents: 1100, soonCents: 2500, nextCents: 4000 };
    const specs: EventSpec[] = [
      { stepMs: 0, type: "payment_confirmed", toTier: "SOON", extraCents: 0, deadlineOffsetMs: 1 },
      { stepMs: MIN_MS, type: "dj_accept", toTier: "SOON", extraCents: 0, deadlineOffsetMs: 1 },
      { stepMs: 20 * MIN_MS, type: "sla_missed", toTier: "SOON", extraCents: 0, deadlineOffsetMs: 1 },
      { stepMs: 5 * MIN_MS, type: "dj_mark_playing", toTier: "SOON", extraCents: 0, deadlineOffsetMs: 1 },
      { stepMs: 3 * MIN_MS, type: "track_finished", toTier: "SOON", extraCents: 0, deadlineOffsetMs: 1 },
    ];
    const model = runModel("SOON", quoted, 0, specs);
    expect(model.status).toBe("played");
    expect(model.tier).toBe("QUEUE");
    expect(model.paidTotal).toBe(2500);
    expect(model.refundTotal).toBe(1400);
    expect(model.capturedTotal).toBe(1100);
    expect(model.refundTotal + model.capturedTotal).toBe(model.paidTotal);
  });
});
