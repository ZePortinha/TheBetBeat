/**
 * Second-precision deadline enforcement (BRIEF B4.1, B4.2, B11).
 *
 * pg-boss cron is minute-level, but tier promises ("toca até 20 min"),
 * DJ decision windows and MB WAY expiries are second-precision, so the
 * worker runs a fast setInterval loop (default every 1 s, for the slot
 * auctions' server-clock closes — lib/auction) PLUS a pg-boss
 * singleton cron job as a watchdog: if the loop ever dies, deadlines are
 * still enforced at minute precision until the process restarts.
 *
 * Each scan claims candidate ids with a `FOR UPDATE SKIP LOCKED` select,
 * so concurrent workers never fight over rows a sibling is already
 * transitioning (the services hold FOR UPDATE on the request row for the
 * whole transition). The lock from the claim select itself is released at
 * statement end — correctness never depends on it: every mutation goes
 * through lib/domain/service, whose state machine re-checks the request
 * under its own lock and turns a lost race into a rejected transition.
 *
 * `now` (epoch ms) is captured ONCE per scan at the worker boundary and
 * injected into every service call — never Date.now() inside the logic.
 */

import { query } from "@/lib/db";
import {
  applyDecisionTimeout,
  applySlaMissed,
  endSession,
  expireUnpaidRequest,
  markTrackFinished,
} from "@/lib/domain/service";
import { parsePaymentPurpose } from "@/lib/payments/service";
import { tickAuctions } from "@/lib/auction/service";

export const DEADLINE_WATCHDOG_QUEUE = "deadline-watchdog";

export interface DeadlineScanConfig {
  /** Max rows claimed per individual scan query. */
  batch: number;
  /** Auto-close grace after sessions.ends_at, minutes (B4.2 — 30). */
  sessionGraceMin: number;
}

export interface DeadlineScanResult {
  decisionTimeouts: number;
  slaMissed: number;
  paymentsExpired: number;
  tracksFinished: number;
  sessionsClosed: number;
  /** Slot auctions opened, closed, refunded or played this pass. */
  auctionMoves: number;
  /** Unexpected throws (logged); lost races are NOT errors. */
  errors: number;
}

function emptyResult(): DeadlineScanResult {
  return {
    decisionTimeouts: 0,
    slaMissed: 0,
    paymentsExpired: 0,
    tracksFinished: 0,
    sessionsClosed: 0,
    auctionMoves: 0,
    errors: 0,
  };
}

/** True when at least one counter moved (keeps the 5 s loop log quiet). */
export function scanDidWork(result: DeadlineScanResult): boolean {
  return (
    result.decisionTimeouts +
      result.slaMissed +
      result.paymentsExpired +
      result.tracksFinished +
      result.sessionsClosed +
      result.auctionMoves +
      result.errors >
    0
  );
}

function logScanError(scan: string, id: string, error: unknown): void {
  console.error(
    `[worker:deadlines] ${scan} failed for ${id}: ${
      error instanceof Error ? error.message : "unknown error"
    }`,
  );
}

/* ------------------------------------------------------------------ */
/* Individual scans                                                    */
/* ------------------------------------------------------------------ */

/** (a) DJ decision window elapsed on a paid request → full refund (B4.1). */
async function scanDecisionTimeouts(
  now: number,
  config: DeadlineScanConfig,
  result: DeadlineScanResult,
): Promise<void> {
  const res = await query<{ id: string }>(
    `select id from public.requests
      where status = 'paid'
        and decision_deadline_at is not null
        and decision_deadline_at <= to_timestamp($1 / 1000.0)
      order by decision_deadline_at
      limit $2
      for update skip locked`,
    [now, config.batch],
  );
  for (const { id } of res.rows) {
    try {
      const outcome = await applyDecisionTimeout(id, now);
      if (outcome.ok) result.decisionTimeouts += 1;
    } catch (error) {
      result.errors += 1;
      logScanError("decision_timeout", id, error);
    }
  }
}

/** (b) SOON/NEXT promise missed → demote to QUEUE + refund diff (B4.2). */
async function scanSlaMissed(
  now: number,
  config: DeadlineScanConfig,
  result: DeadlineScanResult,
): Promise<void> {
  // status in (paid, accepted) already excludes playing/played.
  const res = await query<{ id: string }>(
    `select id from public.requests
      where tier in ('SOON', 'NEXT')
        and status in ('paid', 'accepted')
        and deadline_at is not null
        and deadline_at <= to_timestamp($1 / 1000.0)
      order by deadline_at
      limit $2
      for update skip locked`,
    [now, config.batch],
  );
  for (const { id } of res.rows) {
    try {
      const outcome = await applySlaMissed(id, now);
      if (outcome.ok) result.slaMissed += 1;
    } catch (error) {
      result.errors += 1;
      logScanError("sla_missed", id, error);
    }
  }
}

/** (c) MB WAY push expired unpaid → request expired, slot released (B4.2). */
async function scanExpiredPayments(
  now: number,
  config: DeadlineScanConfig,
  result: DeadlineScanResult,
): Promise<void> {
  const res = await query<{
    id: string;
    request_id: string;
    idempotency_key: string;
    request_status: string;
  }>(
    `select p.id, p.request_id, p.idempotency_key, r.status as request_status
       from public.payments p
       join public.requests r on r.id = p.request_id
      where p.method = 'mbway'
        and p.status = 'pending'
        and p.expires_at is not null
        and p.expires_at <= to_timestamp($1 / 1000.0)
      order by p.expires_at
      limit $2
      for update of p skip locked`,
    [now, config.batch],
  );
  for (const payment of res.rows) {
    try {
      const purpose = parsePaymentPurpose(payment.idempotency_key);
      let settle = purpose.kind === "upgrade";
      if (purpose.kind !== "upgrade") {
        // Primary payment: expire the request itself (pending_payment →
        // expired, close_reason payment_timeout). Only then close the
        // payment row, so a failed transition keeps the row visible to
        // the next scan instead of silently orphaning the request.
        const outcome = await expireUnpaidRequest(payment.request_id, now);
        settle = outcome.ok;
        if (!outcome.ok && payment.request_status !== "pending_payment") {
          // The request moved on (e.g. webhook confirmed concurrently) —
          // the guarded update below is then a safe no-op.
          settle = true;
        }
      }
      if (settle) {
        // Guarded: a webhook that captured the payment meanwhile wins.
        const updated = await query(
          `update public.payments set status = 'expired'
            where id = $1 and status = 'pending'`,
          [payment.id],
        );
        if ((updated.rowCount ?? 0) > 0) result.paymentsExpired += 1;
      }
    } catch (error) {
      result.errors += 1;
      logScanError("payment_expired", payment.id, error);
    }
  }
}

/** Track duration elapsed while playing → `played` is automatic (B4.2). */
async function scanTracksFinished(
  now: number,
  config: DeadlineScanConfig,
  result: DeadlineScanResult,
): Promise<void> {
  const res = await query<{ id: string }>(
    `select id from public.requests
      where status = 'playing'
        and playing_at is not null
        and track_duration_sec is not null
        and playing_at + make_interval(secs => track_duration_sec)
              <= to_timestamp($1 / 1000.0)
      order by playing_at
      limit $2
      for update skip locked`,
    [now, config.batch],
  );
  for (const { id } of res.rows) {
    try {
      const outcome = await markTrackFinished(id, "system:worker", now);
      if (outcome.ok) result.tracksFinished += 1;
    } catch (error) {
      result.errors += 1;
      logScanError("track_finished", id, error);
    }
  }
}

/** (d) Session the DJ never ended → auto-close 30 min after ends_at (B4.2). */
async function scanSessionsToClose(
  now: number,
  config: DeadlineScanConfig,
  result: DeadlineScanResult,
): Promise<void> {
  const res = await query<{ id: string }>(
    `select id from public.sessions
      where status = 'live'
        and ends_at + make_interval(mins => $2) <= to_timestamp($1 / 1000.0)
      order by ends_at
      limit $3
      for update skip locked`,
    [now, config.sessionGraceMin, config.batch],
  );
  for (const { id } of res.rows) {
    try {
      const outcome = await endSession(id, "system:worker", now);
      if (outcome.ok && !outcome.alreadyEnded) result.sessionsClosed += 1;
    } catch (error) {
      result.errors += 1;
      logScanError("session_autoclose", id, error);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Full scan + fast loop                                               */
/* ------------------------------------------------------------------ */

/** One full pass over every deadline kind. Safe to run concurrently. */
export async function scanDeadlines(
  now: number,
  config: DeadlineScanConfig,
): Promise<DeadlineScanResult> {
  const result = emptyResult();
  await scanDecisionTimeouts(now, config, result);
  await scanSlaMissed(now, config, result);
  await scanExpiredPayments(now, config, result);
  await scanTracksFinished(now, config, result);
  await scanSessionsToClose(now, config, result);
  try {
    const a = await tickAuctions(now);
    result.auctionMoves = a.opened + a.closed + a.refunded + a.played + a.expiredTopUps;
  } catch (error) {
    result.errors += 1;
    logScanError("auctions", "tick", error);
  }
  return result;
}

export interface DeadlineLoopConfig extends DeadlineScanConfig {
  intervalMs: number;
}

export interface DeadlineLoopHandle {
  stop(): void;
}

/**
 * Starts the fast scheduler loop. Ticks never overlap: a tick that is
 * still running when the next interval fires makes the new one a no-op.
 * The injectable `clock` keeps the loop testable; it is the ONE boundary
 * where wall-clock time enters — everything below receives `now`.
 */
export function startDeadlineLoop(
  config: DeadlineLoopConfig,
  clock: () => number = () => Date.now(),
  onResult?: (result: DeadlineScanResult) => void,
): DeadlineLoopHandle {
  let running = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await scanDeadlines(clock(), config);
      if (scanDidWork(result)) {
        console.log(
          `[worker:deadlines] decision=${result.decisionTimeouts} sla=${result.slaMissed} ` +
            `payments=${result.paymentsExpired} played=${result.tracksFinished} ` +
            `sessions=${result.sessionsClosed} auctions=${result.auctionMoves} errors=${result.errors}`,
        );
        onResult?.(result);
      }
    } catch (error) {
      console.error(
        `[worker:deadlines] scan crashed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, config.intervalMs);
  void tick(); // first pass immediately on boot

  return {
    stop(): void {
      stopped = true;
      clearInterval(timer);
    },
  };
}
