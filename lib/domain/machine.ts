/**
 * Request lifecycle state machine (BRIEF B4.1, B4.2, B4.4, B7).
 *
 * PURE: no I/O and no Date.now() — time always arrives as `ctx.now`
 * (epoch ms). Invalid transitions return `{ ok: false }`; the machine
 * never throws. It only DESCRIBES what must happen: money movements,
 * deadline scheduling and realtime publishes come out as `Effect` data
 * that the server executes — inside one transaction, writing the
 * matching `request_event` and audit record (B4.2 "Transições").
 *
 * States:  pending_payment → paid → accepted → playing → played,
 * plus the terminal `expired` and `refunded`. Terminal states absorb:
 * every event on them is rejected, which is what guarantees a request
 * is never refunded twice at the domain level (B4.4 "exactly once" is
 * additionally enforced by idempotency keys in the payments layer).
 */
import {
  TIER_RANK,
  type CloseReason,
  type RealtimeEvent,
  type RejectReason,
  type RequestStatus,
  type SessionConfig,
  type Tier,
} from "./types";

const MIN_MS = 60_000;

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

/** Everything that can happen to a request, as a discriminated union. */
export type RequestEvent =
  | { type: "payment_confirmed" }
  | { type: "payment_failed" }
  | { type: "payment_expired" }
  | { type: "dj_accept" }
  | { type: "dj_reject"; reason: RejectReason }
  | { type: "dj_cancel" }
  | { type: "dj_pin" }
  | { type: "dj_unpin" }
  | { type: "dj_mark_playing" }
  | { type: "track_finished" }
  | { type: "decision_timeout" }
  | { type: "sla_missed" }
  | { type: "session_ended" }
  | {
      type: "upgrade_tier";
      toTier: Tier;
      /**
       * The target tier's CURRENT total price in cents, from a fresh
       * quote (B4.1: the guest pays only the difference to the CURRENT
       * price of the new tier — never against the original quote).
       */
      newAmountCents: number;
      /** New promise deadline, epoch ms — restarts from the upgrade. */
      newDeadlineAtMs: number;
    };

export type RequestEventType = RequestEvent["type"];

export const REQUEST_EVENT_TYPES = [
  "payment_confirmed",
  "payment_failed",
  "payment_expired",
  "dj_accept",
  "dj_reject",
  "dj_cancel",
  "dj_pin",
  "dj_unpin",
  "dj_mark_playing",
  "track_finished",
  "decision_timeout",
  "sla_missed",
  "session_ended",
  "upgrade_tier",
] as const satisfies readonly RequestEventType[];

/* ------------------------------------------------------------------ */
/* Effects (DATA — executed elsewhere, never inside the machine)       */
/* ------------------------------------------------------------------ */

export type DeadlineKind = "decision" | "promise";

/**
 * Side effects the server must execute after persisting the transition.
 *
 * Money semantics (method-agnostic — the executor knows the payment):
 * - `refund_full`: give ALL money still held for this request back.
 *   MB WAY (charged): PSP refund of the remaining amount. Card/wallet
 *   (authorized, not captured): executed as `void_authorization`.
 * - `refund_difference`: give part of the held money back (SLA
 *   demotion). MB WAY: partial refund. Card/wallet: the capture target
 *   shrinks by the same amount — only the QUEUE value is ever captured
 *   (B4.3), so no cash moves until the track plays.
 * - `capture`: settle the held money now (track is playing). No-op for
 *   MB WAY, which was charged upfront.
 * - `charge_difference`: collect NEW money for a tier upgrade (B4.1:
 *   "pays only the difference"). In practice the server charges first
 *   and only then applies `upgrade_tier`; the effect carries the exact
 *   amount so the flow is auditable and testable.
 */
export type Effect =
  | { type: "refund_full" }
  | { type: "refund_difference"; amountCents: number }
  | { type: "capture"; amountCents: number }
  | { type: "void_authorization" }
  | { type: "demote_to_queue" }
  | { type: "schedule_deadline"; atMs: number; kind: DeadlineKind }
  | { type: "publish"; event: RealtimeEvent }
  | { type: "issue_invoice" }
  | { type: "generate_share_card" }
  | { type: "charge_difference"; amountCents: number };

/* ------------------------------------------------------------------ */
/* Context & result                                                    */
/* ------------------------------------------------------------------ */

/** Tier prices (cents) from the ORIGINAL quote the guest paid against. */
export interface QuotedTierPrices {
  queueCents: number;
  soonCents: number;
  nextCents: number;
}

export interface TransitionContext {
  /** Current time, epoch ms. ALWAYS injected — never Date.now() here. */
  now: number;
  /** The request's current tier (may already be a demoted QUEUE). */
  tier: Tier;
  /** Total currently held for this request, integer cents. */
  amountCents: number;
  /**
   * Tier prices from the original quote. `sla_missed` refunds exactly
   * `amountCents − quotedPrices.queueCents` (floored at 0) — B4.1.
   */
  quotedPrices: QuotedTierPrices;
  config: SessionConfig;
  /** When the request was paid, epoch ms; null before payment. */
  paidAtMs: number | null;
}

export interface TransitionOk {
  ok: true;
  next: RequestStatus;
  closeReason?: CloseReason;
  effects: Effect[];
}

export interface TransitionError {
  ok: false;
  error: string;
}

export type TransitionResult = TransitionOk | TransitionError;

/* ------------------------------------------------------------------ */
/* Deadline helpers (exported for the worker and the quote service)    */
/* ------------------------------------------------------------------ */

export const TERMINAL_REQUEST_STATUSES = [
  "played",
  "expired",
  "refunded",
] as const satisfies readonly RequestStatus[];

export function isTerminalStatus(status: RequestStatus): boolean {
  return (TERMINAL_REQUEST_STATUSES as readonly RequestStatus[]).includes(status);
}

/** DJ decision window in minutes by tier (B4.1 — configurable). */
export function decisionWindowMinutes(tier: Tier, config: SessionConfig): number {
  switch (tier) {
    case "NEXT":
      return config.decisionWindowNextMin;
    case "SOON":
      return config.decisionWindowSoonMin;
    case "QUEUE":
      return config.decisionWindowQueueMin;
  }
}

/** When the DJ decision window closes, counted from `paidAtMs`. */
export function decisionDeadlineAtMs(
  tier: Tier,
  config: SessionConfig,
  paidAtMs: number,
): number {
  return paidAtMs + decisionWindowMinutes(tier, config) * MIN_MS;
}

/**
 * When the tier's time promise expires, counted from `paidAtMs`.
 * QUEUE promises "during the set", so it has no fixed deadline (null);
 * `session_ended` settles it.
 */
export function promiseDeadlineAtMs(
  tier: Tier,
  config: SessionConfig,
  paidAtMs: number,
): number | null {
  switch (tier) {
    case "NEXT":
      return paidAtMs + config.nextDeadlineMin * MIN_MS;
    case "SOON":
      return paidAtMs + config.soonDeadlineMin * MIN_MS;
    case "QUEUE":
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* The machine                                                         */
/* ------------------------------------------------------------------ */

function ok(
  next: RequestStatus,
  effects: Effect[],
  closeReason?: CloseReason,
): TransitionOk {
  return closeReason === undefined
    ? { ok: true, next, effects }
    : { ok: true, next, closeReason, effects };
}

function invalid(current: RequestStatus, event: RequestEvent): TransitionError {
  return {
    ok: false,
    error: `invalid transition: event "${event.type}" in status "${current}"`,
  };
}

function publish(event: RealtimeEvent): Effect {
  return { type: "publish", event };
}

/**
 * Apply `event` to a request currently in `current`.
 * Returns the next status, an optional close reason and the effects the
 * server must execute. Never throws; unknown or illegal combinations
 * return `{ ok: false }` so racing workers can treat them as no-ops.
 */
export function transition(
  current: RequestStatus,
  event: RequestEvent,
  ctx: TransitionContext,
): TransitionResult {
  // Terminal states absorb everything (a request never refunds twice).
  if (isTerminalStatus(current)) return invalid(current, event);

  switch (event.type) {
    case "payment_confirmed": {
      if (current !== "pending_payment") return invalid(current, event);
      // Payment confirmed AT ctx.now: both clocks start here (B4.1).
      const effects: Effect[] = [
        {
          type: "schedule_deadline",
          atMs: decisionDeadlineAtMs(ctx.tier, ctx.config, ctx.now),
          kind: "decision",
        },
      ];
      const promiseAt = promiseDeadlineAtMs(ctx.tier, ctx.config, ctx.now);
      if (promiseAt !== null) {
        effects.push({ type: "schedule_deadline", atMs: promiseAt, kind: "promise" });
      }
      effects.push(publish("request.paid"));
      return ok("paid", effects);
    }

    case "payment_failed":
    case "payment_expired": {
      if (current !== "pending_payment") return invalid(current, event);
      // No money was taken, so nothing to refund. The brief defines a
      // single close reason for unpaid requests (B4.2: payment_timeout
      // → expired); the payments module records the precise PSP outcome
      // on the payment row itself.
      return ok("expired", [], "payment_timeout");
    }

    case "dj_accept": {
      if (current !== "paid") return invalid(current, event);
      // The promise deadline keeps running from paidAt — accepting is
      // not playing (B4.1).
      return ok("accepted", [publish("request.accepted")]);
    }

    case "dj_reject": {
      if (current !== "paid") return invalid(current, event);
      return ok(
        "refunded",
        [{ type: "refund_full" }, publish("request.rejected")],
        "rejected_by_dj",
      );
    }

    case "decision_timeout": {
      if (current !== "paid") return invalid(current, event);
      // No decision inside the window: full automatic refund (B4.1).
      return ok(
        "refunded",
        [{ type: "refund_full" }, publish("request.refunded")],
        "dj_timeout",
      );
    }

    case "dj_cancel": {
      // Cancelling is an "Alinhados" action — only accepted requests
      // (B7). Undecided requests are rejected instead.
      if (current !== "accepted") return invalid(current, event);
      return ok(
        "refunded",
        [{ type: "refund_full" }, publish("request.refunded")],
        "cancelled_by_dj",
      );
    }

    case "dj_pin": {
      if (current !== "accepted") return invalid(current, event);
      return ok("accepted", [publish("request.pinned")]);
    }

    case "dj_unpin": {
      if (current !== "accepted") return invalid(current, event);
      // No dedicated realtime event for unpin — the queue order changed.
      return ok("accepted", [publish("queue.changed")]);
    }

    case "dj_mark_playing": {
      if (current !== "accepted") return invalid(current, event);
      // The track plays: settle the money now (B4.3 — card/wallet
      // captures the current amount; MB WAY was already charged).
      return ok("playing", [
        { type: "capture", amountCents: ctx.amountCents },
        publish("request.playing"),
      ]);
    }

    case "track_finished": {
      if (current !== "playing") return invalid(current, event);
      // Played: fatura-recibo (B4.5) + "A minha música tocou" card (B6).
      return ok("played", [
        publish("request.played"),
        { type: "issue_invoice" },
        { type: "generate_share_card" },
      ]);
    }

    case "sla_missed": {
      // Only a paid/accepted SOON or NEXT can miss its promise (B4.2:
      // the worker checks "not playing nor played"; QUEUE has no fixed
      // deadline). Everything else is a stale job → no-op for callers.
      if (current !== "paid" && current !== "accepted") return invalid(current, event);
      if (ctx.tier !== "SOON" && ctx.tier !== "NEXT") return invalid(current, event);
      // Demote to QUEUE and immediately return the difference to the
      // QUEUE price of the ORIGINAL quote (B4.1), floored at 0. For
      // card flows the executor shrinks the capture target by the same
      // amount — only the QUEUE value is ever captured (B4.3). The
      // request stays in the SAME status and stays in the queue.
      const diff = Math.max(0, ctx.amountCents - ctx.quotedPrices.queueCents);
      const effects: Effect[] = [{ type: "demote_to_queue" }];
      if (diff > 0) effects.push({ type: "refund_difference", amountCents: diff });
      effects.push(publish("request.sla_missed"));
      return ok(current, effects);
    }

    case "session_ended": {
      if (current === "pending_payment") {
        // Never paid: the request simply expires with the session.
        return ok("expired", [], "payment_timeout");
      }
      // Any non-terminal paid state (paid, accepted, playing): the set
      // ended without the track being played out — full refund (B4.1
      // "se não tocar até ao fim do set" + B4.2 auto-close).
      return ok(
        "refunded",
        [{ type: "refund_full" }, publish("request.refunded")],
        "session_ended",
      );
    }

    case "upgrade_tier": {
      if (current !== "paid" && current !== "accepted") return invalid(current, event);
      if (TIER_RANK[event.toTier] <= TIER_RANK[ctx.tier]) {
        return {
          ok: false,
          error: `invalid upgrade: "${ctx.tier}" → "${event.toTier}" is not a higher tier`,
        };
      }
      if (!Number.isInteger(event.newAmountCents) || event.newAmountCents <= 0) {
        return { ok: false, error: "invalid upgrade: newAmountCents must be a positive integer" };
      }
      if (!Number.isFinite(event.newDeadlineAtMs) || event.newDeadlineAtMs <= ctx.now) {
        return { ok: false, error: "invalid upgrade: newDeadlineAtMs must be after now" };
      }
      // Pays only the difference to the CURRENT price of the new tier
      // (passed in via the event — never the original quote). If the
      // guest already paid more (free extra amount), the upgrade costs
      // nothing and they keep their higher amount.
      const diff = Math.max(0, event.newAmountCents - ctx.amountCents);
      const effects: Effect[] = [];
      if (diff > 0) effects.push({ type: "charge_difference", amountCents: diff });
      // The promise deadline restarts from the upgrade (B4.1).
      effects.push({ type: "schedule_deadline", atMs: event.newDeadlineAtMs, kind: "promise" });
      if (current === "paid") {
        // Still undecided: the decision window restarts on the new
        // tier's (shorter) window, so the DJ sees the urgency.
        effects.push({
          type: "schedule_deadline",
          atMs: decisionDeadlineAtMs(event.toTier, ctx.config, ctx.now),
          kind: "decision",
        });
      }
      effects.push(publish("queue.changed"));
      return ok(current, effects);
    }
  }
}
