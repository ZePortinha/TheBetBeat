/**
 * Refund retry with exponential backoff + admin alert (BRIEF B4.4).
 *
 * `ensureRefund` (lib/payments/service) owns the EXACTLY-ONCE guarantee:
 * it reserves the (request, reason) refund row and, on a PSP failure,
 * leaves it `failed` (attempts = 1) without blocking the request
 * transition. This module finishes the story:
 *
 *  - a minute sweep ('refund-retry-scan', pg-boss singleton cron) finds
 *    refunds that are `failed` with retry budget left, or stuck in
 *    `processing`/`pending` for > WORKER_REFUND_STUCK_SEC (a worker died
 *    mid-retry), and enqueues one 'refund-retry' job per refund
 *    (singletonKey = refund id, so a refund is never queued twice);
 *  - the 'refund-retry' handler re-calls the PSP with the refund's
 *    ORIGINAL idempotency key — a refund that actually went through on a
 *    previous crashed attempt is returned as-is by the provider, never
 *    executed twice;
 *  - a provider failure throws, so pg-boss retries with exponential
 *    backoff (retryDelay × 2^n + jitter — see backoffScheduleSeconds);
 *  - once total attempts reach WORKER_REFUND_MAX_ATTEMPTS (default 5) the
 *    refund is marked failed for good and ONE `refund.failed.alert`
 *    audit_log row is written for the admin (B4.4 "alerta ao admin").
 *
 * The ledger refund group is posted in the same transaction that flips
 * the row `processing → succeeded`, so money movements and their ledger
 * trail stay atomic and are never double-posted.
 */

import type PgBoss from "pg-boss";
import type { PoolClient } from "pg";
import { query, withTransaction } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payments";
import { refundGroup } from "@/lib/ledger/groups";
import { postLedgerGroup } from "@/lib/ledger/post";

export const REFUND_RETRY_QUEUE = "refund-retry";
export const REFUND_SCAN_QUEUE = "refund-retry-scan";

export interface RefundRetryJobData {
  refundId: string;
}

export interface RefundRetryConfig {
  /** Total provider attempts (including ensureRefund's first) — B4.4. */
  maxAttempts: number;
  /** Base pg-boss retry delay, seconds (doubles per retry). */
  retryDelaySec: number;
  /** processing/pending rows older than this count as stuck. */
  stuckSec: number;
  /** Max refunds enqueued per sweep. */
  batch: number;
}

/* ------------------------------------------------------------------ */
/* Sweep                                                               */
/* ------------------------------------------------------------------ */

/**
 * Finds retryable refunds and enqueues a retry job for each. Duplicate
 * sends are dropped by pg-boss via singletonKey while a job for the same
 * refund is still queued, retrying or active.
 */
export async function enqueueStuckRefunds(
  boss: PgBoss,
  now: number,
  config: RefundRetryConfig,
): Promise<number> {
  // Epoch arithmetic stays in JS: a bare `$1 - $3 * 1000` would make
  // Postgres infer int4 for the epoch-ms param and overflow.
  const stuckBeforeMs = now - config.stuckSec * 1000;
  const res = await query<{ id: string }>(
    `select id from public.refunds
      where (status = 'failed' and attempts < $2)
         or (status in ('processing', 'pending')
             and updated_at <= to_timestamp($1 / 1000.0))
      order by updated_at
      limit $3
      for update skip locked`,
    [stuckBeforeMs, config.maxAttempts, config.batch],
  );
  let enqueued = 0;
  for (const { id } of res.rows) {
    const jobId = await boss.send(
      REFUND_RETRY_QUEUE,
      { refundId: id } satisfies RefundRetryJobData,
      {
        singletonKey: id,
        retryLimit: config.maxAttempts,
        retryDelay: config.retryDelaySec,
        retryBackoff: true,
      },
    );
    if (jobId !== null) enqueued += 1;
  }
  if (enqueued > 0) {
    console.log(`[worker:refunds] enqueued ${enqueued} refund retr${enqueued === 1 ? "y" : "ies"}`);
  }
  return enqueued;
}

/* ------------------------------------------------------------------ */
/* Retry handler                                                       */
/* ------------------------------------------------------------------ */

interface RefundJoinRow {
  id: string;
  payment_id: string;
  request_id: string;
  amount_cents: number;
  reason: string;
  status: string;
  idempotency_key: string;
  attempts: number;
  payment_provider_ref: string | null;
  session_id: string;
  venue_id: string;
}

export type RefundRetryStatus = "succeeded" | "exhausted" | "skipped";

export interface RefundRetryOutcome {
  refundId: string;
  status: RefundRetryStatus;
}

/**
 * One `refund.failed.alert` audit row per refund, guarded by NOT EXISTS
 * so retries and sweep races never spam the admin (B4.4).
 */
async function insertAdminAlert(
  client: PoolClient,
  row: RefundJoinRow,
  attempts: number,
  lastError: string,
): Promise<void> {
  await client.query(
    `insert into public.audit_log (actor, action, entity, entity_id, venue_id, payload)
     select 'system:worker', 'refund.failed.alert', 'refund', $1, $2, $3
      where not exists (
        select 1 from public.audit_log
         where action = 'refund.failed.alert' and entity = 'refund' and entity_id = $1
      )`,
    [
      row.id,
      row.venue_id,
      JSON.stringify({
        requestId: row.request_id,
        paymentId: row.payment_id,
        amountCents: row.amount_cents,
        reason: row.reason,
        attempts,
        lastError: lastError.slice(0, 500),
      }),
    ],
  );
}

/**
 * Executes one retry. Throws ONLY when the attempt failed and retry
 * budget remains — that throw is what drives pg-boss's backoff. Every
 * terminal path (succeeded / exhausted / skipped) returns normally so the
 * job completes.
 */
export async function processRefundRetry(
  data: RefundRetryJobData,
  now: number,
  config: Pick<RefundRetryConfig, "maxAttempts">,
): Promise<RefundRetryOutcome> {
  const { refundId } = data;

  // Phase 1 — claim: flip to processing and burn one attempt. SKIP LOCKED
  // makes concurrent workers leave each other's refunds alone.
  type Claim =
    | { kind: "skipped" }
    | { kind: "exhausted" }
    | { kind: "claimed"; row: RefundJoinRow; attempts: number };
  const claim = await withTransaction<Claim>(async (client) => {
    const res = await client.query<RefundJoinRow>(
      `select r.id, r.payment_id, r.request_id, r.amount_cents, r.reason, r.status,
              r.idempotency_key, r.attempts,
              p.provider_ref as payment_provider_ref,
              req.session_id, req.venue_id
         from public.refunds r
         join public.payments p on p.id = r.payment_id
         join public.requests req on req.id = r.request_id
        where r.id = $1
        for update of r skip locked`,
      [refundId],
    );
    const row = res.rows[0];
    if (!row || row.status === "succeeded") return { kind: "skipped" };
    if (row.attempts >= config.maxAttempts) {
      // Sweep raced an exhausted refund in: make sure the alert exists.
      await insertAdminAlert(client, row, row.attempts, "retry budget exhausted");
      return { kind: "exhausted" };
    }
    if (row.payment_provider_ref === null) {
      // No PSP reference → a retry can never succeed. Burn the budget and
      // alert at once instead of failing 5 times for nothing.
      await client.query(
        `update public.refunds
            set status = 'failed', attempts = $2, last_error = $3
          where id = $1`,
        [row.id, config.maxAttempts, "payment has no provider_ref"],
      );
      await insertAdminAlert(client, row, config.maxAttempts, "payment has no provider_ref");
      return { kind: "exhausted" };
    }
    await client.query(
      `update public.refunds set status = 'processing', attempts = attempts + 1
        where id = $1`,
      [row.id],
    );
    return { kind: "claimed", row, attempts: row.attempts + 1 };
  });

  if (claim.kind !== "claimed") {
    if (claim.kind === "exhausted") {
      console.error(`[worker:refunds] refund ${refundId} exhausted its retry budget — admin alerted`);
    }
    return { refundId, status: claim.kind === "exhausted" ? "exhausted" : "skipped" };
  }

  const { row, attempts } = claim;
  const provider = await getPaymentProvider();

  // Phase 2 — PSP call with the refund's ORIGINAL idempotency key: a
  // previously-completed refund is returned, not repeated.
  try {
    const result = await provider.refund(
      row.payment_provider_ref as string,
      row.amount_cents,
      row.idempotency_key,
    );

    // Phase 3 — settle: ledger group + status flip, atomically. The
    // `status = 'processing'` guard means the group posts exactly once.
    await withTransaction(async (client) => {
      const updated = await client.query<{ id: string }>(
        `update public.refunds
            set status = 'succeeded', provider_ref = $2, last_error = null
          where id = $1 and status = 'processing'
          returning id`,
        [row.id, result.providerRef],
      );
      if ((updated.rowCount ?? 0) === 0) return;
      await postLedgerGroup(
        client,
        refundGroup(row.amount_cents, {
          venueId: row.venue_id,
          sessionId: row.session_id,
          requestId: row.request_id,
          memo: `refund:${row.reason}`,
        }),
      );
      await client.query(
        `insert into public.audit_log (actor, action, entity, entity_id, venue_id, payload)
         values ('system:worker', 'refund.retried', 'refund', $1, $2, $3)`,
        [
          row.id,
          row.venue_id,
          JSON.stringify({
            requestId: row.request_id,
            amountCents: row.amount_cents,
            attempts,
            providerRef: result.providerRef,
          }),
        ],
      );
    });
    console.log(`[worker:refunds] refund ${row.id} succeeded on attempt ${attempts}`);
    return { refundId, status: "succeeded" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown provider error";
    await query(
      `update public.refunds set status = 'failed', last_error = $2
        where id = $1 and status = 'processing'`,
      [row.id, message.slice(0, 500)],
    );
    if (attempts >= config.maxAttempts) {
      await withTransaction((client) => insertAdminAlert(client, row, attempts, message));
      console.error(
        `[worker:refunds] refund ${row.id} FAILED after ${attempts} attempts — admin alerted: ${message}`,
      );
      return { refundId, status: "exhausted" };
    }
    // Budget left: rethrow so pg-boss schedules the next attempt with
    // exponential backoff (retryDelay × 2^n + jitter).
    throw error;
  }
}
