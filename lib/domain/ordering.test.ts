/**
 * Tests for queue ordering (BRIEF B5.5): urgency bucket, waiting-boost
 * score, NEXT → SOON → QUEUE grouping, purity and determinism.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEADLINE_URGENCY_WINDOW_MS,
  groupByTier,
  isDeadlineUrgent,
  orderQueue,
  orderWithinTier,
  requestScore,
  type OrderableRequest,
} from "./ordering";
import { TIERS, type Tier } from "./types";

const MIN_MS = 60_000;
const NOW = Date.UTC(2026, 9, 2, 23, 30, 0);

const iso = (ms: number) => new Date(ms).toISOString();

let seq = 0;
function req(partial: Partial<OrderableRequest> & { tier?: Tier } = {}): OrderableRequest {
  seq += 1;
  return {
    id: partial.id ?? `r${seq}`,
    tier: partial.tier ?? "QUEUE",
    amountCents: partial.amountCents ?? 1500,
    paidAt: partial.paidAt ?? iso(NOW - 10 * MIN_MS),
    deadlineAt: partial.deadlineAt === undefined ? null : partial.deadlineAt,
  };
}

describe("requestScore", () => {
  it("boosts +1% per minute waiting", () => {
    expect(requestScore(1000, NOW, NOW)).toBe(1000);
    expect(requestScore(1000, NOW - 60 * MIN_MS, NOW)).toBeCloseTo(1600);
    expect(requestScore(2000, NOW - 30 * MIN_MS, NOW)).toBeCloseTo(2600);
  });

  it("never goes below the amount (future/invalid paidAt clamps at 0 minutes)", () => {
    expect(requestScore(1000, NOW + 5 * MIN_MS, NOW)).toBe(1000);
    expect(requestScore(1000, Number.NaN, NOW)).toBe(1000);
  });
});

describe("isDeadlineUrgent", () => {
  it("is urgent strictly under 5 minutes, including overdue", () => {
    expect(isDeadlineUrgent(NOW + 4 * MIN_MS, NOW)).toBe(true);
    expect(isDeadlineUrgent(NOW - MIN_MS, NOW)).toBe(true); // overdue
    expect(isDeadlineUrgent(NOW + DEADLINE_URGENCY_WINDOW_MS, NOW)).toBe(false);
    expect(isDeadlineUrgent(NOW + 6 * MIN_MS, NOW)).toBe(false);
    expect(isDeadlineUrgent(null, NOW)).toBe(false); // QUEUE never urgent
  });
});

describe("orderWithinTier", () => {
  it("puts requests <5 min from their deadline first, ascending deadline", () => {
    const relaxed = req({ id: "relaxed", tier: "SOON", amountCents: 9000, deadlineAt: iso(NOW + 15 * MIN_MS) });
    const urgent3 = req({ id: "urgent3", tier: "SOON", amountCents: 1500, deadlineAt: iso(NOW + 3 * MIN_MS) });
    const urgent1 = req({ id: "urgent1", tier: "SOON", amountCents: 1500, deadlineAt: iso(NOW + 1 * MIN_MS) });

    const ordered = orderWithinTier([relaxed, urgent3, urgent1], NOW);
    expect(ordered.map((r) => r.id)).toEqual(["urgent1", "urgent3", "relaxed"]);
  });

  it("orders the non-urgent rest by amount × (1 + 0.01·minutesWaiting) descending", () => {
    // 1000 waiting 60 min → 1600 beats 1500 waiting 0 min → 1500.
    const oldSmall = req({ id: "old", amountCents: 1000, paidAt: iso(NOW - 60 * MIN_MS) });
    const freshBig = req({ id: "fresh", amountCents: 1500, paidAt: iso(NOW) });
    expect(orderWithinTier([freshBig, oldSmall], NOW).map((r) => r.id)).toEqual(["old", "fresh"]);

    // But a clearly bigger amount still wins.
    const whale = req({ id: "whale", amountCents: 5000, paidAt: iso(NOW) });
    expect(orderWithinTier([oldSmall, whale], NOW)[0]?.id).toBe("whale");
  });

  it("breaks exact score ties by older payment first", () => {
    const a = req({ id: "a", amountCents: 1000, paidAt: iso(NOW - 5 * MIN_MS) });
    const b = req({ id: "b", amountCents: 1000, paidAt: iso(NOW - 5 * MIN_MS) });
    const c = req({ id: "c", amountCents: 1000, paidAt: iso(NOW - 8 * MIN_MS) });
    // c has a higher score (longer wait); a and b tie and keep input order.
    expect(orderWithinTier([a, b, c], NOW).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});

describe("orderQueue", () => {
  it("groups NEXT → SOON → QUEUE across tiers", () => {
    const q = req({ id: "q", tier: "QUEUE", amountCents: 99_000 });
    const s = req({ id: "s", tier: "SOON", amountCents: 100, deadlineAt: iso(NOW + 18 * MIN_MS) });
    const n = req({ id: "n", tier: "NEXT", amountCents: 50, deadlineAt: iso(NOW + 9 * MIN_MS) });

    // A huge QUEUE amount never jumps a tier (B4.1: paying more never
    // overtakes another tier's promise).
    expect(orderQueue([q, s, n], NOW).map((r) => r.id)).toEqual(["n", "s", "q"]);
  });

  it("applies B5.5 inside each tier group", () => {
    const soonUrgent = req({ id: "soonUrgent", tier: "SOON", amountCents: 100, deadlineAt: iso(NOW + 2 * MIN_MS) });
    const soonRich = req({ id: "soonRich", tier: "SOON", amountCents: 9000, deadlineAt: iso(NOW + 15 * MIN_MS) });
    const queueOld = req({ id: "queueOld", tier: "QUEUE", amountCents: 1000, paidAt: iso(NOW - 90 * MIN_MS) });
    const queueFresh = req({ id: "queueFresh", tier: "QUEUE", amountCents: 1200, paidAt: iso(NOW - MIN_MS) });

    const ordered = orderQueue([queueFresh, soonRich, queueOld, soonUrgent], NOW);
    expect(ordered.map((r) => r.id)).toEqual(["soonUrgent", "soonRich", "queueOld", "queueFresh"]);
  });

  it("does not mutate its input", () => {
    const input = [req({ tier: "QUEUE" }), req({ tier: "NEXT", deadlineAt: iso(NOW + MIN_MS) })];
    const snapshot = [...input];
    orderQueue(input, NOW);
    expect(input).toEqual(snapshot);
  });

  it("groupByTier returns the same order, bucketed", () => {
    const n = req({ id: "n", tier: "NEXT", deadlineAt: iso(NOW + 9 * MIN_MS) });
    const s1 = req({ id: "s1", tier: "SOON", amountCents: 3000, deadlineAt: iso(NOW + 15 * MIN_MS) });
    const s2 = req({ id: "s2", tier: "SOON", amountCents: 1000, deadlineAt: iso(NOW + 15 * MIN_MS) });
    const groups = groupByTier([s2, n, s1], NOW);
    expect(groups.NEXT.map((r) => r.id)).toEqual(["n"]);
    expect(groups.SOON.map((r) => r.id)).toEqual(["s1", "s2"]);
    expect(groups.QUEUE).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Properties                                                          */
/* ------------------------------------------------------------------ */

const requestArb: fc.Arbitrary<OrderableRequest> = fc.record({
  id: fc.uuid(),
  tier: fc.constantFrom(...TIERS),
  amountCents: fc.integer({ min: 100, max: 50_000 }),
  paidAt: fc.integer({ min: NOW - 120 * MIN_MS, max: NOW }).map(iso),
  deadlineAt: fc.option(fc.integer({ min: NOW - 10 * MIN_MS, max: NOW + 30 * MIN_MS }).map(iso), {
    nil: null,
  }),
});

describe("ordering properties", () => {
  it("output is always a permutation of the input", () => {
    fc.assert(
      fc.property(fc.array(requestArb, { maxLength: 50 }), (requests) => {
        const ordered = orderQueue(requests, NOW);
        expect(ordered).toHaveLength(requests.length);
        expect(new Set(ordered.map((r) => r.id))).toEqual(new Set(requests.map((r) => r.id)));
      }),
    );
  });

  it("tiers never interleave and urgent requests always precede relaxed ones in-tier", () => {
    fc.assert(
      fc.property(fc.array(requestArb, { maxLength: 50 }), (requests) => {
        const ordered = orderQueue(requests, NOW);
        const rank = { NEXT: 0, SOON: 1, QUEUE: 2 } as const;
        for (let i = 1; i < ordered.length; i++) {
          const prev = ordered[i - 1]!;
          const curr = ordered[i]!;
          expect(rank[prev.tier]).toBeLessThanOrEqual(rank[curr.tier]);
          if (prev.tier === curr.tier) {
            const prevUrgent = isDeadlineUrgent(prev.deadlineAt ? Date.parse(prev.deadlineAt) : null, NOW);
            const currUrgent = isDeadlineUrgent(curr.deadlineAt ? Date.parse(curr.deadlineAt) : null, NOW);
            // Never a relaxed request above an urgent one.
            expect(!prevUrgent && currUrgent).toBe(false);
          }
        }
      }),
    );
  });

  it("is deterministic regardless of input order", () => {
    fc.assert(
      fc.property(
        fc.array(requestArb, { maxLength: 30 }),
        fc.integer({ min: 0, max: 1000 }),
        (requests, seed) => {
          // Cheap deterministic shuffle.
          const shuffled = [...requests].sort(
            (a, b) => ((a.id.charCodeAt(0) + seed) % 7) - ((b.id.charCodeAt(0) + seed) % 7),
          );
          expect(orderQueue(shuffled, NOW).map((r) => r.id)).toEqual(
            orderQueue(requests, NOW).map((r) => r.id),
          );
        },
      ),
    );
  });
});
