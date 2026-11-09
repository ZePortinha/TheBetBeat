import type { RequestEvent } from "@/lib/domain/machine";
import type { RequestStatus, Tier } from "@/lib/domain/types";
import { EVENTS, type EventName, type EventProperties } from "./events";

/**
 * Pure mapping from one applied request transition to the funnel events it
 * means (B14). Kept out of the service so the taxonomy is unit-tested and
 * the service only schedules the capture after commit.
 */
export interface TransitionFacts {
  event: RequestEvent;
  from: RequestStatus;
  to: RequestStatus;
  tier: Tier;
  amountCents: number;
  /** Money refunded by this transition (0 when none). */
  refundedCents: number;
  closeReason: string | null;
  paidAtMs: number | null;
  sessionId: string;
  venueId: string;
  now: number;
}

export interface FunnelEvent {
  name: EventName;
  properties: EventProperties;
}

export function transitionFunnelEvents(f: TransitionFacts): FunnelEvent[] {
  const base: EventProperties = { sessionId: f.sessionId, venueId: f.venueId, tier: f.tier };
  const sincePaid = f.paidAtMs === null ? null : Math.max(0, f.now - f.paidAtMs);
  const out: FunnelEvent[] = [];
  switch (f.event.type) {
    case "payment_confirmed":
      out.push({ name: EVENTS.guestPaymentConfirmed, properties: { ...base, amountCents: f.amountCents } });
      break;
    case "payment_failed":
    case "payment_expired":
      out.push({
        name: EVENTS.paymentFailed,
        properties: { ...base, reason: f.event.type === "payment_failed" ? "failed" : "expired" },
      });
      break;
    case "dj_accept":
      out.push({ name: EVENTS.djDecision, properties: { ...base, action: "accept", decisionMs: sincePaid } });
      break;
    case "dj_reject":
      out.push({
        name: EVENTS.djDecision,
        properties: { ...base, action: "reject", reason: f.event.reason, decisionMs: sincePaid },
      });
      break;
    case "dj_cancel":
      out.push({ name: EVENTS.djDecision, properties: { ...base, action: "cancel", decisionMs: sincePaid } });
      break;
    case "decision_timeout":
      out.push({ name: EVENTS.djDecision, properties: { ...base, action: "timeout", decisionMs: sincePaid } });
      break;
    case "sla_missed":
      out.push({ name: EVENTS.djSlaMissed, properties: base });
      break;
    default:
      break;
  }
  if (f.to === "played" && f.from !== "played") {
    out.push({
      name: EVENTS.guestRequestPlayed,
      properties: { ...base, amountCents: f.amountCents, waitMs: sincePaid },
    });
  }
  if (f.refundedCents > 0) {
    out.push({
      name: EVENTS.refundIssued,
      properties: { ...base, amountCents: f.refundedCents, reason: f.closeReason ?? f.event.type },
    });
  }
  return out;
}
