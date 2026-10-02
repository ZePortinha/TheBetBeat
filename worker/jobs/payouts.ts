/**
 * Payout execution (BRIEF B4.5 "Payouts … após o fecho da sessão").
 *
 * `endSession` (lib/domain/service) creates PENDING payout rows from the
 * session's ledger statement. This module executes them:
 *
 *  - a sweep ('payout-scan', pg-boss singleton cron) finds pending payouts
 *    of ENDED sessions — plus `processing` rows stuck after a crash — and
 *    enqueues one 'payout-execute' job per payout (singletonKey = payout
 *    id, retries with backoff on transient failures);
 *  - the handler claims the row (FOR UPDATE SKIP LOCKED), marks it
 *    `processing`, performs the PSP SEPA transfer (MOCK until Phase 8:
 *    always succeeds, deterministic reference) and then, in ONE
 *    transaction, posts the ledger payout group and flips the row to
 *    `paid` with the provider reference and the session statement in the
 *    `report` jsonb (B4.5 "com relatório").
 *
 * The `status = 'processing'` guard inside the settle transaction makes
 * the ledger group exactly-once: a crash before commit leaves the row
 * `processing`, the sweep re-enqueues it, and the mock (later: idempotent
 * PSP call) plus the guard replay the settle without double-posting.
 */

import type PgBoss from "pg-boss";
import { query, withTransaction } from "@/lib/db";
import { payoutGroup, type PayoutRecipient } from "@/lib/ledger/groups";
import { postLedgerGroup } from "@/lib/ledger/post";
import { sessionStatement, type LedgerEntryRow } from "@/lib/ledger/balances";
import { mockSepaReference } from "../lib";

export const PAYOUT_EXECUTE_QUEUE = "payout-execute";
export const PAYOUT_SCAN_QUEUE = "payout-scan";

/** How long a `processing` payout may sit before the sweep reclaims it. */
const STUCK_PROCESSING_MS = 2 * 60_000;

export interface PayoutJobData {
  payoutId: string;
}

/* ------------------------------------------------------------------ */
/* Sweep                                                               */
/* ------------------------------------------------------------------ */

export async function enqueuePendingPayouts(
  boss: PgBoss,
  now: number,
  config: { batch: number },
): Promise<number> {
  // Epoch arithmetic stays in JS (int4 inference would overflow in SQL).
  const stuckBeforeMs = now - STUCK_PROCESSING_MS;
  const res = await query<{ id: string }>(
    `select p.id from public.payouts p
       join public.sessions s on s.id = p.session_id
      where s.status = 'ended'
        and (p.status = 'pending'
             or (p.status = 'processing'
                 and p.updated_at <= to_timestamp($1 / 1000.0)))
      order by p.created_at
      limit $2
      for update of p skip locked`,
    [stuckBeforeMs, config.batch],
  );
  let enqueued = 0;
  for (const { id } of res.rows) {
    const jobId = await boss.send(
      PAYOUT_EXECUTE_QUEUE,
      { payoutId: id } satisfies PayoutJobData,
      { singletonKey: id, retryLimit: 3, retryDelay: 30, retryBackoff: true },
    );
    if (jobId !== null) enqueued += 1;
  }
  if (enqueued > 0) {
    console.log(`[worker:payouts] enqueued ${enqueued} payout(s)`);
  }
  return enqueued;
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

interface PayoutRow {
  id: string;
  session_id: string;
  venue_id: string;
  recipient_type: PayoutRecipient;
  amount_cents: string | number; // bigint column
  status: string;
  session_status: string;
}

export type PayoutExecuteStatus = "paid" | "skipped";

/** Executes one payout end to end. Idempotent and crash-safe (see header). */
export async function executePayoutJob(
  data: PayoutJobData,
  now: number,
): Promise<PayoutExecuteStatus> {
  // Phase 1 — claim: pending/processing → processing, under the row lock.
  const claimed = await withTransaction<PayoutRow | null>(async (client) => {
    const res = await client.query<PayoutRow>(
      `select p.id, p.session_id, p.venue_id, p.recipient_type, p.amount_cents,
              p.status, s.status as session_status
         from public.payouts p
         join public.sessions s on s.id = p.session_id
        where p.id = $1 and p.status in ('pending', 'processing')
        for update of p skip locked`,
      [data.payoutId],
    );
    const row = res.rows[0];
    if (!row) return null; // paid already, or a sibling worker owns it
    if (row.session_status !== "ended") return null; // only after close (B4.5)
    await client.query(`update public.payouts set status = 'processing' where id = $1`, [
      row.id,
    ]);
    return row;
  });
  if (!claimed) return "skipped";

  const amount = Number(claimed.amount_cents);

  // Phase 2 — PSP SEPA transfer. MOCK until Phase 8: always succeeds with
  // a deterministic reference. The real adapter slots in here behind the
  // same idempotency contract (reference derived from the payout id).
  const providerRef = mockSepaReference(claimed.id, now);

  // Phase 3 — settle atomically: ledger payout group + paid + report.
  const settled = await withTransaction(async (client) => {
    const check = await client.query<{ status: string }>(
      `select status from public.payouts where id = $1 for update`,
      [claimed.id],
    );
    if (check.rows[0]?.status !== "processing") return false; // someone settled it

    const entriesRes = await client.query<LedgerEntryRow>(
      `select account, amount_cents from public.ledger_entries where session_id = $1`,
      [claimed.session_id],
    );
    const statement = sessionStatement(entriesRes.rows);

    if (amount > 0) {
      await postLedgerGroup(
        client,
        payoutGroup(claimed.recipient_type, amount, {
          venueId: claimed.venue_id,
          sessionId: claimed.session_id,
          memo: `payout:${claimed.recipient_type}`,
        }),
      );
    }

    await client.query(
      `update public.payouts
          set status = 'paid', provider_ref = $2,
              report = coalesce(report, '{}'::jsonb) || $3::jsonb
        where id = $1`,
      [
        claimed.id,
        providerRef,
        JSON.stringify({
          statement,
          providerRef,
          amountCents: amount,
          executedAt: new Date(now).toISOString(),
          provider: "mock-sepa",
        }),
      ],
    );
    await client.query(
      `insert into public.audit_log (actor, action, entity, entity_id, venue_id, payload)
       values ('system:worker', 'payout.paid', 'payout', $1, $2, $3)`,
      [
        claimed.id,
        claimed.venue_id,
        JSON.stringify({
          sessionId: claimed.session_id,
          recipient: claimed.recipient_type,
          amountCents: amount,
          providerRef,
        }),
      ],
    );
    return true;
  });

  if (settled) {
    console.log(
      `[worker:payouts] payout ${claimed.id} paid — ${claimed.recipient_type} ` +
        `${amount}c (${providerRef})`,
    );
    return "paid";
  }
  return "skipped";
}
