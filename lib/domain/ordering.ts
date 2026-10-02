/**
 * Queue ordering (BRIEF B5.5) — PURE, `now` injected (epoch ms).
 *
 * Within each tier:
 *   1. requests less than 5 minutes from missing their promise deadline
 *      come first, by ascending deadline (most urgent on top);
 *   2. the rest by score `amountCents × (1 + 0.01 · minutesWaiting)`
 *      descending, so an old request is never forgotten.
 * Across tiers the cockpit groups NEXT → SOON → QUEUE.
 */
import { TIER_RANK, type Tier } from "./types";

/** "Less than 5 min from missing the deadline" window (B5.5). */
export const DEADLINE_URGENCY_WINDOW_MS = 5 * 60_000;

/** Cockpit group order: strongest promise first (B7 "Alinhados"). */
export const TIER_PLAY_ORDER = ["NEXT", "SOON", "QUEUE"] as const satisfies readonly Tier[];

/**
 * Minimal shape the ordering needs. `ActiveRequestInfo` from
 * `lib/domain/types` satisfies it structurally.
 */
export interface OrderableRequest {
  id: string;
  tier: Tier;
  amountCents: number;
  /** When the request was paid — ISO UTC string. */
  paidAt: string;
  /** Promise deadline, ISO UTC — null for QUEUE (promise = end of set). */
  deadlineAt: string | null;
}

/** B5.5 score: value with a +1%/minute waiting boost. */
export function requestScore(amountCents: number, paidAtMs: number, now: number): number {
  const minutesWaiting = Number.isFinite(paidAtMs)
    ? Math.max(0, (now - paidAtMs) / 60_000)
    : 0;
  return amountCents * (1 + 0.01 * minutesWaiting);
}

/** True when the deadline is less than 5 minutes away (or already past). */
export function isDeadlineUrgent(deadlineAtMs: number | null, now: number): boolean {
  return (
    deadlineAtMs !== null &&
    Number.isFinite(deadlineAtMs) &&
    deadlineAtMs - now < DEADLINE_URGENCY_WINDOW_MS
  );
}

interface Decorated<T> {
  request: T;
  index: number; // original position — final determinism tie-break
  deadlineMs: number | null;
  urgent: boolean;
  score: number;
  paidAtMs: number;
}

function decorate<T extends OrderableRequest>(request: T, index: number, now: number): Decorated<T> {
  const paidAtMs = Date.parse(request.paidAt);
  const deadlineMs = request.deadlineAt === null ? null : Date.parse(request.deadlineAt);
  const safeDeadline = deadlineMs !== null && Number.isFinite(deadlineMs) ? deadlineMs : null;
  return {
    request,
    index,
    deadlineMs: safeDeadline,
    urgent: isDeadlineUrgent(safeDeadline, now),
    score: requestScore(request.amountCents, paidAtMs, now),
    paidAtMs: Number.isFinite(paidAtMs) ? paidAtMs : Number.MAX_SAFE_INTEGER,
  };
}

function compareWithinTier<T extends OrderableRequest>(
  a: Decorated<T>,
  b: Decorated<T>,
): number {
  // 1. Urgent bucket first, ascending deadline.
  if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
  if (a.urgent && b.urgent && a.deadlineMs !== b.deadlineMs) {
    return (a.deadlineMs ?? 0) - (b.deadlineMs ?? 0);
  }
  // 2. Score descending.
  if (a.score !== b.score) return b.score - a.score;
  // Deterministic tie-breaks: older payment first, then id, so the
  // result never depends on input order (stable across refetches).
  if (a.paidAtMs !== b.paidAtMs) return a.paidAtMs - b.paidAtMs;
  if (a.request.id !== b.request.id) return a.request.id < b.request.id ? -1 : 1;
  return a.index - b.index;
}

/** Order the requests of ONE tier per B5.5. Input is not mutated. */
export function orderWithinTier<T extends OrderableRequest>(
  requests: readonly T[],
  now: number,
): T[] {
  return requests
    .map((request, index) => decorate(request, index, now))
    .sort(compareWithinTier)
    .map((d) => d.request);
}

/**
 * Full cockpit/queue order: NEXT → SOON → QUEUE, each tier ordered per
 * B5.5. Pure — returns a new array, never mutates the input.
 */
export function orderQueue<T extends OrderableRequest>(
  requests: readonly T[],
  now: number,
): T[] {
  return requests
    .map((request, index) => decorate(request, index, now))
    .sort((a, b) => {
      const tierDelta = TIER_RANK[b.request.tier] - TIER_RANK[a.request.tier];
      if (tierDelta !== 0) return tierDelta;
      return compareWithinTier(a, b);
    })
    .map((d) => d.request);
}

/** Group a queue by tier in play order (convenience for the cockpit). */
export function groupByTier<T extends OrderableRequest>(
  requests: readonly T[],
  now: number,
): Record<Tier, T[]> {
  const groups: Record<Tier, T[]> = { NEXT: [], SOON: [], QUEUE: [] };
  for (const request of orderQueue(requests, now)) {
    groups[request.tier].push(request);
  }
  return groups;
}
