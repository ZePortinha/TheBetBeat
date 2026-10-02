/**
 * ETA per tier (BRIEF B5.5). Pure functions — `now` (epoch ms) is injected.
 *
 *  - i = 60/R minutes between accepted requests.
 *  - NEXT  = remaining minutes of the current track (or i/2 when unknown).
 *  - SOON  = (nNext + positionInSoon) · i
 *  - QUEUE = (nNext + nSoon + positionInQueue) · i
 *    where position = count of active requests in that tier + 1 (the new
 *    request appends at the end of its tier).
 */
import type { Tier } from "@/lib/domain/types";
import type { PricingQueueInput } from "./types";

/** Minutes between accepted requests: i = 60/R. */
export function requestIntervalMin(acceptanceRatePerHour: number): number {
  return 60 / acceptanceRatePerHour;
}

export function countActiveByTier(
  active: PricingQueueInput["active"],
): Record<Tier, number> {
  const counts: Record<Tier, number> = { QUEUE: 0, SOON: 0, NEXT: 0 };
  for (const request of active) counts[request.tier] += 1;
  return counts;
}

/** Raw ETA in (fractional) minutes for a NEW request in each tier. */
export function computeTierEtasMin(
  queue: PricingQueueInput,
  acceptanceRatePerHour: number,
): Record<Tier, number> {
  const interval = requestIntervalMin(acceptanceRatePerHour);
  const counts = countActiveByTier(queue.active);
  const nextEta =
    queue.currentTrackRemainingSec !== null
      ? Math.max(0, queue.currentTrackRemainingSec) / 60
      : interval / 2;
  const soonPosition = counts.SOON + 1;
  const queuePosition = counts.QUEUE + 1;
  return {
    NEXT: nextEta,
    SOON: (counts.NEXT + soonPosition) * interval,
    QUEUE: (counts.NEXT + counts.SOON + queuePosition) * interval,
  };
}

/**
 * Minutes until the first SOON slot frees (its promise deadline), estimated
 * from the earliest active SOON request: paidAtMs + soonDeadlineMin.
 * Null when no SOON request is active.
 */
export function soonLiberationEtaMin(
  queue: PricingQueueInput,
  soonDeadlineMin: number,
  now: number,
): number | null {
  let earliestPaidAtMs = Infinity;
  for (const request of queue.active) {
    if (request.tier === "SOON" && request.paidAtMs < earliestPaidAtMs) {
      earliestPaidAtMs = request.paidAtMs;
    }
  }
  if (!Number.isFinite(earliestPaidAtMs)) return null;
  const freesAtMs = earliestPaidAtMs + soonDeadlineMin * 60_000;
  return Math.max(0, (freesAtMs - now) / 60_000);
}

/**
 * Display rounding (B5.5): to the minute up to 10 min, to multiples of 5
 * above. Never below 1 ("~0 min" is meaningless to a guest).
 */
export function etaDisplayMin(etaMin: number): number {
  if (!Number.isFinite(etaMin) || etaMin <= 0) return 1;
  if (etaMin <= 10) return Math.max(1, Math.round(etaMin));
  return Math.max(10, Math.round(etaMin / 5) * 5);
}
