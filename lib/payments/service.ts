import "server-only";

/**
 * Money movement orchestration (BRIEF B4.3, B4.4).
 *
 * Everything here is EXACTLY-ONCE by construction:
 *  - refunds: one `refunds` row per (request, reason), reserved with
 *    `insert … on conflict do nothing returning` — only the caller that
 *    wins the insert talks to the PSP and posts the ledger group;
 *  - captures / voids: guarded by the payment row's status (a captured
 *    payment ignores repeat confirmations) + provider idempotency keys;
 *  - webhooks: `recordWebhook` combines both guards, so duplicate
 *    deliveries are no-ops (the integration tests prove it).
 *
 * Functions that take a `client` run inside the CALLER's transaction:
 * the refund row, its ledger group and the request transition that
 * caused it commit atomically. Provider calls are awaited in-line; the
 * mock is in-process, and the Phase 8 worker retries `failed` rows with
 * backoff (B4.4), so a PSP hiccup never loses money — it just delays it.
 */

import type { PoolClient } from "pg";
import { withTransaction } from "@/lib/db";
import type { PaymentRow } from "@/lib/domain/dto";
import type { Tier } from "@/lib/domain/types";
import { TIERS } from "@/lib/domain/types";
import { postLedgerGroup } from "@/lib/ledger/post";
import { captureGroup, refundGroup } from "@/lib/ledger/groups";
import { getPaymentProvider } from "@/lib/payments";
import type { PaymentProvider, WebhookEvent } from "@/lib/payments/types";
import { publishBroadcasts } from "@/lib/realtime/publish";

/* ------------------------------------------------------------------ */
/* Shared types                                                        */
/* ------------------------------------------------------------------ */

/** Ledger/audit dimensions for a request's money movements. */
export interface MoneyMeta {
  requestId: string;
  sessionId: string;
  venueId: string;
}

/** Injectable provider for unit tests; defaults to the configured one. */
export interface PaymentServiceDeps {
  provider?: PaymentProvider;
}

async function resolveProvider(deps?: PaymentServiceDeps): Promise<PaymentProvider> {
  return deps?.provider ?? (await getPaymentProvider());
}

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                          */
/* ------------------------------------------------------------------ */

export type PaymentPurpose =
  | { kind: "primary"; requestId: string }
  | { kind: "upgrade"; requestId: string; toTier: Tier }
  | { kind: "unknown" };

/**
 * Payment idempotency keys encode their purpose:
 *   'pay:<requestId>'                   — the request's main payment
 *   'pay:<requestId>:upgrade:<TIER>'    — a tier-upgrade difference
 */
export function parsePaymentPurpose(idempotencyKey: string): PaymentPurpose {
  const upgrade = /^pay:([0-9a-f-]{36}):upgrade:([A-Z]+)$/.exec(idempotencyKey);
  if (upgrade) {
    const tier = upgrade[2] as Tier;
    if ((TIERS as readonly string[]).includes(tier)) {
      return { kind: "upgrade", requestId: upgrade[1] as string, toTier: tier };
    }
    return { kind: "unknown" };
  }
  const primary = /^pay:([0-9a-f-]{36})$/.exec(idempotencyKey);
  if (primary) return { kind: "primary", requestId: primary[1] as string };
  return { kind: "unknown" };
}

export type WebhookAction =
  | "confirm_mbway" // pending MB WAY charge → captured
  | "confirm_authorization" // pending card/wallet → authorized
  | "fail"
  | "expire"
  | "ignore";

/**
 * Status-transition guard (B4.3 "Robustez"): which action a webhook type
 * may apply to a payment in its current status. Anything else — captured
 * payments re-confirmed, failed payments re-failed — is a no-op.
 */
export function webhookActionForPayment(
  payment: Pick<PaymentRow, "status" | "method">,
  type: WebhookEvent["type"],
): WebhookAction {
  switch (type) {
    case "payment.confirmed":
      if (payment.status !== "pending") return "ignore";
      return payment.method === "mbway" ? "confirm_mbway" : "confirm_authorization";
    case "payment.failed":
      return payment.status === "pending" || payment.status === "authorized"
        ? "fail"
        : "ignore";
    case "payment.expired":
      return payment.status === "pending" ? "expire" : "ignore";
    case "refund.succeeded":
    case "refund.failed":
      return "ignore"; // handled by the refunds path, not the payment row
  }
}

/* ------------------------------------------------------------------ */
/* Row access                                                          */
/* ------------------------------------------------------------------ */

async function paymentsForRequest(
  client: PoolClient,
  requestId: string,
): Promise<PaymentRow[]> {
  const res = await client.query<PaymentRow>(
    `select * from public.payments where request_id = $1 order by created_at asc`,
    [requestId],
  );
  return res.rows;
}

/** Cents already committed to refunds (pending/processing/succeeded). */
async function refundedCentsByPayment(
  client: PoolClient,
  requestId: string,
): Promise<Map<string, number>> {
  const res = await client.query<{ payment_id: string; total: string }>(
    `select payment_id, coalesce(sum(amount_cents), 0)::bigint as total
       from public.refunds
      where request_id = $1 and status in ('pending', 'processing', 'succeeded')
      group by payment_id`,
    [requestId],
  );
  return new Map(res.rows.map((r) => [r.payment_id, Number(r.total)]));
}

/* ------------------------------------------------------------------ */
/* ensureRefund                                                        */
/* ------------------------------------------------------------------ */

export interface RefundOutcome {
  /** False when the (request, reason) refund already existed. */
  executed: boolean;
  /** 'succeeded' | 'failed' | 'duplicate' | 'nothing_captured'. */
  status: "succeeded" | "failed" | "duplicate" | "nothing_captured";
  refundedCents: number;
}

/**
 * Refunds `amountCents` of captured money back to the guest, EXACTLY
 * once per (request, reason): `refunds.idempotency_key =
 * 'refund:<requestId>:<reason>'`. The insert is the lock — on conflict
 * the whole refund is someone else's and this call is a no-op.
 *
 * A provider failure marks the row `failed` (attempts = 1) WITHOUT
 * throwing: the enclosing request transition still commits, and the
 * worker retries with backoff + admin alert (B4.4).
 *
 * The amount is allocated across the request's captured payments
 * (upgrades create a second payment). The first allocation carries the
 * canonical key; extra allocations suffix `:p2`, `:p3`, …
 */
export async function ensureRefund(
  client: PoolClient,
  meta: MoneyMeta,
  amountCents: number,
  reason: string,
  now: number,
  deps?: PaymentServiceDeps,
): Promise<RefundOutcome> {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { executed: false, status: "nothing_captured", refundedCents: 0 };
  }

  // Fast duplicate check on the canonical key: a repeat call after the
  // first refund consumed the refundable balance must still read as a
  // duplicate, not as "nothing captured". The insert-on-conflict below
  // remains the authoritative race guard.
  const existing = await client.query(
    `select 1 from public.refunds where idempotency_key = $1`,
    [`refund:${meta.requestId}:${reason}`],
  );
  if ((existing.rowCount ?? 0) > 0) {
    return { executed: false, status: "duplicate", refundedCents: 0 };
  }

  const payments = await paymentsForRequest(client, meta.requestId);
  const alreadyRefunded = await refundedCentsByPayment(client, meta.requestId);

  // Allocate the refund over captured payments (oldest first).
  const allocations: Array<{ payment: PaymentRow; cents: number }> = [];
  let remaining = amountCents;
  for (const payment of payments) {
    if (remaining <= 0) break;
    if (payment.captured_cents <= 0 || payment.provider_ref === null) continue;
    const refundable = payment.captured_cents - (alreadyRefunded.get(payment.id) ?? 0);
    if (refundable <= 0) continue;
    const take = Math.min(remaining, refundable);
    allocations.push({ payment, cents: take });
    remaining -= take;
  }
  if (allocations.length === 0) {
    return { executed: false, status: "nothing_captured", refundedCents: 0 };
  }

  const provider = await resolveProvider(deps);
  let refundedCents = 0;
  let anyFailed = false;

  for (const [index, alloc] of allocations.entries()) {
    const key =
      index === 0
        ? `refund:${meta.requestId}:${reason}`
        : `refund:${meta.requestId}:${reason}:p${index + 1}`;

    const inserted = await client.query<{ id: string }>(
      `insert into public.refunds
         (payment_id, request_id, amount_cents, reason, status, idempotency_key)
       values ($1, $2, $3, $4, 'pending', $5)
       on conflict (idempotency_key) do nothing
       returning id`,
      [alloc.payment.id, meta.requestId, alloc.cents, reason, key],
    );
    const refundId = inserted.rows[0]?.id;
    if (!refundId) {
      // The canonical key lost the race/was already processed: the whole
      // (request, reason) refund belongs to the earlier caller.
      if (index === 0) return { executed: false, status: "duplicate", refundedCents: 0 };
      continue;
    }

    await client.query(`update public.refunds set status = 'processing' where id = $1`, [
      refundId,
    ]);
    try {
      const result = await provider.refund(
        alloc.payment.provider_ref as string,
        alloc.cents,
        key,
      );
      await client.query(
        `update public.refunds
            set status = 'succeeded', provider_ref = $2, attempts = attempts + 1
          where id = $1`,
        [refundId, result.providerRef],
      );
      await postLedgerGroup(
        client,
        refundGroup(alloc.cents, {
          venueId: meta.venueId,
          sessionId: meta.sessionId,
          requestId: meta.requestId,
          memo: `refund:${reason}`,
        }),
      );
      refundedCents += alloc.cents;
    } catch (error) {
      anyFailed = true;
      await client.query(
        `update public.refunds
            set status = 'failed', attempts = attempts + 1, last_error = $2
          where id = $1`,
        [refundId, error instanceof Error ? error.message.slice(0, 500) : "unknown"],
      );
    }
  }

  void now; // reserved for retry/backoff bookkeeping (worker)
  return {
    executed: true,
    status: anyFailed ? "failed" : "succeeded",
    refundedCents,
  };
}

/* ------------------------------------------------------------------ */
/* capturePayment / voidAuthorization                                  */
/* ------------------------------------------------------------------ */

export interface CaptureOutcome {
  capturedCents: number;
  /** True when nothing needed doing (MB WAY already captured, etc.). */
  alreadySettled: boolean;
}

/**
 * Settles `amountCents` when the track plays (B4.3): captures the
 * request's authorized card/wallet payments up to the target. MB WAY
 * was charged upfront, so its captured cents count as already settled.
 * Posts one `captureGroup` per PSP capture (money enters clearing when
 * it actually moves). Throws on a transient provider failure so the
 * enclosing transaction rolls back and the DJ/worker can retry.
 */
export async function capturePayment(
  client: PoolClient,
  meta: MoneyMeta,
  amountCents: number,
  now: number,
  deps?: PaymentServiceDeps,
): Promise<CaptureOutcome> {
  const payments = await paymentsForRequest(client, meta.requestId);
  let settled = payments.reduce((sum, p) => sum + p.captured_cents, 0);
  let remaining = Math.max(0, amountCents - settled);
  if (remaining === 0) return { capturedCents: 0, alreadySettled: true };

  const provider = await resolveProvider(deps);
  let captured = 0;

  for (const payment of payments) {
    if (remaining <= 0) break;
    if (payment.status !== "authorized" || payment.provider_ref === null) continue;
    const take = Math.min(remaining, payment.amount_cents);
    if (take <= 0) continue;

    await provider.capture(payment.provider_ref, take, `capture:${payment.id}`);
    await client.query(
      `update public.payments set status = 'captured', captured_cents = $2 where id = $1`,
      [payment.id, take],
    );
    await postLedgerGroup(
      client,
      captureGroup(take, {
        venueId: meta.venueId,
        sessionId: meta.sessionId,
        requestId: meta.requestId,
        memo: "capture:playing",
      }),
    );
    captured += take;
    remaining -= take;
    settled += take;
  }

  void now;
  return { capturedCents: captured, alreadySettled: captured === 0 };
}

/**
 * Releases authorizations that will never be captured (nothing played —
 * B4.3). Guarded by payment status: only `authorized` rows are voided.
 * No ledger entries: no money ever moved.
 */
export async function voidAuthorization(
  client: PoolClient,
  meta: MoneyMeta,
  deps?: PaymentServiceDeps,
): Promise<{ voidedCents: number }> {
  const payments = await paymentsForRequest(client, meta.requestId);
  const provider = await resolveProvider(deps);
  let voided = 0;
  for (const payment of payments) {
    if (payment.status !== "authorized" || payment.provider_ref === null) continue;
    await provider.void(payment.provider_ref, `void:${payment.id}`);
    await client.query(`update public.payments set status = 'voided' where id = $1`, [
      payment.id,
    ]);
    voided += payment.amount_cents;
  }
  return { voidedCents: voided };
}

/* ------------------------------------------------------------------ */
/* recordWebhook                                                       */
/* ------------------------------------------------------------------ */

export interface WebhookRecordResult {
  handled: boolean;
  action: WebhookAction | "unknown_provider_ref" | "refund_status";
  requestId?: string;
  duplicate?: boolean;
}

interface PaymentJoinRow extends PaymentRow {
  session_id: string;
  venue_id: string;
}

/**
 * Applies a VERIFIED PSP webhook (the route verified the signature via
 * `provider.verifyWebhook` before calling this). Duplicate deliveries
 * are no-ops thanks to the payment-status guards; every delivery leaves
 * an audit row keyed by the provider event id.
 */
export async function recordWebhook(
  event: WebhookEvent,
  now: number,
): Promise<WebhookRecordResult> {
  // Refund status updates target the refunds table only.
  if (event.type === "refund.succeeded" || event.type === "refund.failed") {
    await withTransaction(async (client) => {
      await client.query(
        `update public.refunds
            set status = $2, last_error = case when $2 = 'failed' then 'psp webhook' else last_error end
          where provider_ref = $1 and status in ('pending', 'processing')`,
        [event.providerRef, event.type === "refund.succeeded" ? "succeeded" : "failed"],
      );
      await auditWebhook(client, event, null, "refund_status");
    });
    return { handled: true, action: "refund_status" };
  }

  const outcome = await withTransaction(async (client) => {
    const paymentRes = await client.query<PaymentJoinRow>(
      `select p.*, r.session_id, r.venue_id
         from public.payments p
         join public.requests r on r.id = p.request_id
        where p.provider_ref = $1
        for update of p`,
      [event.providerRef],
    );
    const payment = paymentRes.rows[0];
    if (!payment) {
      await auditWebhook(client, event, null, "unknown_provider_ref");
      return {
        result: {
          handled: false,
          action: "unknown_provider_ref",
        } as WebhookRecordResult,
        publishes: [],
        afterCommit: [],
      };
    }

    const action = webhookActionForPayment(payment, event.type);
    const meta: MoneyMeta = {
      requestId: payment.request_id,
      sessionId: payment.session_id,
      venueId: payment.venue_id,
    };

    if (action === "ignore") {
      await auditWebhook(client, event, payment.id, "ignore");
      return {
        result: {
          handled: true,
          action,
          requestId: payment.request_id,
          duplicate: true,
        } as WebhookRecordResult,
        publishes: [],
        afterCommit: [],
      };
    }

    // 1. Payment row + ledger.
    if (action === "confirm_mbway") {
      const amount = event.amountCents ?? payment.amount_cents;
      await client.query(
        `update public.payments set status = 'captured', captured_cents = $2 where id = $1`,
        [payment.id, amount],
      );
      await postLedgerGroup(
        client,
        captureGroup(amount, { ...toLedgerMeta(meta), memo: "capture:mbway" }),
      );
    } else if (action === "confirm_authorization") {
      await client.query(
        `update public.payments set status = 'authorized' where id = $1`,
        [payment.id],
      );
    } else if (action === "fail") {
      await client.query(`update public.payments set status = 'failed' where id = $1`, [
        payment.id,
      ]);
    } else if (action === "expire") {
      await client.query(`update public.payments set status = 'expired' where id = $1`, [
        payment.id,
      ]);
    }

    // 2. Request transition (dynamic import breaks the module cycle:
    //    lib/domain/service statically imports this module).
    const { applyPaymentOutcomeInTx } = await import("@/lib/domain/service");
    const kind =
      action === "fail" ? "failed" : action === "expire" ? "expired" : "confirmed";
    const transition = await applyPaymentOutcomeInTx(client, payment, kind, now);

    await auditWebhook(client, event, payment.id, action);
    return {
      result: {
        handled: true,
        action,
        requestId: payment.request_id,
        duplicate: false,
      } as WebhookRecordResult,
      publishes: transition.publishes,
      afterCommit: transition.afterCommit,
    };
  });

  await publishBroadcasts(outcome.publishes, now);
  for (const task of outcome.afterCommit) {
    try {
      await task();
    } catch (error) {
      console.error(
        `[payments] post-commit task failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
  return outcome.result;
}

function toLedgerMeta(meta: MoneyMeta): {
  venueId: string;
  sessionId: string;
  requestId: string;
} {
  return {
    venueId: meta.venueId,
    sessionId: meta.sessionId,
    requestId: meta.requestId,
  };
}

async function auditWebhook(
  client: PoolClient,
  event: WebhookEvent,
  paymentId: string | null,
  action: string,
): Promise<void> {
  await client.query(
    `insert into public.audit_log (actor, action, entity, entity_id, payload)
     values ('system:psp', $1, 'payment', $2, $3)`,
    [
      `webhook.${event.type}`,
      paymentId ?? event.providerRef,
      JSON.stringify({ eventId: event.id, action }),
    ],
  );
}
