import "server-only";

/**
 * Request orchestration (BRIEF B4.2 "Transições", B4.3, B4.4, B4.5).
 *
 * The pure state machine (lib/domain/machine) DESCRIBES what must
 * happen; this module makes it happen, atomically:
 *
 *   withTransaction:
 *     SELECT … FOR UPDATE  → machine.transition() → persist status +
 *     timestamps → request_event + audit_log → execute money effects
 *     (lib/payments/service + lib/ledger) → collect realtime publishes
 *   AFTER COMMIT:
 *     flush broadcasts (lib/realtime/publish) + post-commit tasks
 *     (invoice issue), so a broadcast never announces a rolled-back
 *     state and a crashed invoice never blocks money movements.
 *
 * Slot reservation (B4.3): `SELECT id FROM sessions … FOR UPDATE` is the
 * serialization point for request creation; the partial unique index
 * `requests_one_active_next_idx` is the backstop (23505 → tier_unavailable).
 *
 * `now` (epoch ms) is ALWAYS injected — never Date.now() in here.
 */

import type { PoolClient } from "pg";
import { getPool, withTransaction } from "@/lib/db";
import {
  promiseDeadlineAtMs,
  transition,
  type Effect,
  type RequestEvent,
} from "./machine";
import {
  quotedPricesFromTiers,
  validateQuoteForPayment,
  type QuoteValidationError,
  type ValidatedQuote,
} from "./quotes";
import { parseSessionConfig } from "./config";
import {
  toGuestRequestPayload,
  toPublicNowDto,
  toStaffRequestDto,
  type PaymentRow,
  type RequestRow,
} from "./dto";
import {
  isHigherTier,
  type CloseReason,
  type PaymentMethod,
  type PaymentStatus,
  type RealtimeEvent,
  type RejectReason,
  type RequestStatus,
  type SessionConfig,
  type Tier,
} from "./types";
import {
  capturePayment,
  ensureRefund,
  parsePaymentPurpose,
  voidAuthorization,
  type MoneyMeta,
} from "@/lib/payments/service";
import { getPaymentProvider } from "@/lib/payments";
import type { PaymentIntentResult, WebhookEvent } from "@/lib/payments/types";
import { postLedgerGroup } from "@/lib/ledger/post";
import { payoutGroup, recognitionGroup } from "@/lib/ledger/groups";
import { computeSplit } from "@/lib/ledger/split";
import { sessionStatement, type LedgerEntryRow } from "@/lib/ledger/balances";
import { getInvoicingProvider } from "@/lib/invoicing";
import { guestChannel, publicChannel, staffChannel } from "@/lib/realtime/events";
import { publishBroadcasts, type OutgoingBroadcast } from "@/lib/realtime/publish";
import { encrypt, hashPhone } from "@/lib/security/crypto";

/* ------------------------------------------------------------------ */
/* Shared result types                                                 */
/* ------------------------------------------------------------------ */

/** Deadline work the caller hands to the worker (pg-boss). */
export interface DeadlineJob {
  kind: "payment_timeout" | "decision_timeout" | "promise_deadline" | "track_finished";
  requestId: string;
  runAtMs: number;
}

export interface TransitionApplied {
  ok: true;
  requestId: string;
  status: RequestStatus;
  closeReason: CloseReason | null;
  jobs: DeadlineJob[];
}

export interface TransitionRejected {
  ok: false;
  error: string;
}

export type TransitionOutcome = TransitionApplied | TransitionRejected;

/** What a transition leaves to run after COMMIT. */
export interface TransitionTxResult {
  outcome: TransitionOutcome;
  publishes: OutgoingBroadcast[];
  afterCommit: Array<() => Promise<void>>;
}

const ACTIVE_STATUSES = "('pending_payment', 'paid', 'accepted', 'playing')";

function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: string; constraint?: string };
  if (e.code !== "23505") return false;
  return constraint === undefined || e.constraint === constraint;
}

/* ------------------------------------------------------------------ */
/* Transition core                                                     */
/* ------------------------------------------------------------------ */

interface RequestJoinRow extends RequestRow {
  zone_name: string | null;
}

interface RequestPricingContext {
  config: SessionConfig;
  venueShareBps: number;
  quotedTiers: Array<{ tier: Tier; priceCents: number }>;
}

async function loadPricingContext(
  client: PoolClient,
  row: RequestRow,
): Promise<RequestPricingContext> {
  const res = await client.query<{
    config: unknown;
    venue_share_bps: number;
    tiers: Array<{ tier: Tier; priceCents: number }>;
  }>(
    `select coalesce(ss.config, '{}'::jsonb) as config,
            coalesce(ss.venue_share_bps, 5000) as venue_share_bps,
            q.tiers
       from public.quotes q
       join public.sessions s on s.id = $2
       left join public.session_settings ss on ss.session_id = s.id
      where q.id = $1`,
    [row.quote_id, row.session_id],
  );
  const ctx = res.rows[0];
  if (!ctx) throw new Error(`pricing context missing for request ${row.id}`);
  return {
    config: parseSessionConfig(ctx.config),
    venueShareBps: ctx.venue_share_bps,
    quotedTiers: ctx.tiers,
  };
}

/**
 * The heart of the server: applies one state-machine event to one
 * request INSIDE the caller's transaction. Exported for composition
 * (webhooks run it inside their own transaction); use `applyTransition`
 * everywhere else.
 */
export async function applyTransitionInTx(
  client: PoolClient,
  requestId: string,
  event: RequestEvent,
  actor: string,
  now: number,
): Promise<TransitionTxResult> {
  const rowRes = await client.query<RequestJoinRow>(
    `select r.*, z.name as zone_name
       from public.requests r
       left join public.zones z on z.id = r.zone_id
      where r.id = $1
      for update of r`,
    [requestId],
  );
  const row = rowRes.rows[0];
  if (!row) return rejected("request_not_found");

  const pricing = await loadPricingContext(client, row);
  const result = transition(row.status, event, {
    now,
    tier: row.tier,
    amountCents: row.amount_cents,
    quotedPrices: quotedPricesFromTiers(pricing.quotedTiers),
    config: pricing.config,
    paidAtMs: row.paid_at ? row.paid_at.getTime() : null,
  });
  if (!result.ok) return rejected(result.error);

  const meta: MoneyMeta = {
    requestId: row.id,
    sessionId: row.session_id,
    venueId: row.venue_id,
  };
  const jobs: DeadlineJob[] = [];
  const publishEvents: RealtimeEvent[] = [];
  const afterCommit: Array<() => Promise<void>> = [];

  // Start from the current row and patch it as effects execute; the
  // final object both feeds the UPDATE and builds realtime payloads.
  const updated: RequestJoinRow = { ...row };
  updated.status = result.next;
  if (result.closeReason) updated.close_reason = result.closeReason;

  // Event-specific column changes.
  switch (event.type) {
    case "payment_confirmed":
      updated.paid_at = new Date(now);
      break;
    case "dj_accept":
      updated.accepted_at = new Date(now);
      break;
    case "dj_reject":
      updated.reject_reason = event.reason;
      break;
    case "dj_pin":
      updated.pinned_next = true;
      break;
    case "dj_unpin":
      updated.pinned_next = false;
      break;
    case "dj_mark_playing":
      updated.playing_at = new Date(now);
      break;
    case "track_finished":
      updated.played_at = new Date(now);
      break;
    case "upgrade_tier":
      updated.original_tier = row.original_tier ?? row.tier;
      updated.tier = event.toTier;
      // Free extra value is kept: never lower the held amount (B4.1).
      updated.amount_cents = Math.max(row.amount_cents, event.newAmountCents);
      break;
    default:
      break;
  }
  if (result.next === "expired" || result.next === "refunded") {
    updated.closed_at = new Date(now);
  }

  // Execute effects (order matters: demote before refund_difference).
  for (const effect of result.effects) {
    await executeEffect(client, effect, { row, updated, meta, pricing, now, jobs, publishEvents, afterCommit });
  }

  // Played: recognize revenue (B4.5) and schedule nothing further.
  if (result.next === "played" && row.status !== "played") {
    const amount = updated.amount_cents;
    if (amount > 0) {
      await postLedgerGroup(
        client,
        recognitionGroup(
          computeSplit(amount, pricing.config.betbeatFeeBps, pricing.venueShareBps),
          { venueId: meta.venueId, sessionId: meta.sessionId, requestId: meta.requestId, memo: "recognition:played" },
        ),
      );
    }
  }

  // Playing: snapshot into session_tracks (no-repeat window + set
  // context, B4.6) and schedule the automatic `played` (B4.2).
  if (result.next === "playing" && row.status !== "playing") {
    await client.query(
      `insert into public.session_tracks
         (session_id, request_id, title, artist, genre, bpm, camelot_key, duration_sec, source, started_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'request', to_timestamp($9 / 1000.0))`,
      [
        row.session_id,
        row.id,
        row.track_title,
        row.track_artist,
        row.track_genre,
        row.track_bpm,
        row.track_key,
        row.track_duration_sec,
        now,
      ],
    );
    if (row.track_duration_sec !== null && row.track_duration_sec > 0) {
      jobs.push({
        kind: "track_finished",
        requestId: row.id,
        runAtMs: now + row.track_duration_sec * 1000,
      });
    }
  }

  // Persist the patched row.
  await client.query(
    `update public.requests
        set status = $2, close_reason = $3, reject_reason = $4, tier = $5,
            amount_cents = $6, refunded_cents = $7, original_tier = $8,
            sla_missed = $9, pinned_next = $10,
            paid_at = $11, accepted_at = $12, playing_at = $13, played_at = $14,
            closed_at = $15, deadline_at = $16, decision_deadline_at = $17
      where id = $1`,
    [
      row.id,
      updated.status,
      updated.close_reason,
      updated.reject_reason,
      updated.tier,
      updated.amount_cents,
      updated.refunded_cents,
      updated.original_tier,
      updated.sla_missed,
      updated.pinned_next,
      updated.paid_at,
      updated.accepted_at,
      updated.playing_at,
      updated.played_at,
      updated.closed_at,
      updated.deadline_at,
      updated.decision_deadline_at,
    ],
  );

  // Every transition writes a request_event + an audit record (B4.2).
  await client.query(
    `insert into public.request_events (request_id, from_status, to_status, reason, actor, payload)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      row.id,
      row.status,
      updated.status,
      result.closeReason ?? event.type,
      actor,
      JSON.stringify({ event: event.type, effects: result.effects.map((e) => e.type) }),
    ],
  );
  await client.query(
    `insert into public.audit_log (actor, action, entity, entity_id, venue_id, payload)
     values ($1, $2, 'request', $3, $4, $5)`,
    [
      actor,
      `request.${event.type}`,
      row.id,
      row.venue_id,
      JSON.stringify({
        from: row.status,
        to: updated.status,
        closeReason: result.closeReason ?? null,
        tier: updated.tier,
        amountCents: updated.amount_cents,
      }),
    ],
  );

  // Build realtime payloads from the FINAL row state.
  const publishes = await buildPublishes(client, updated, publishEvents, pricing, now);

  return {
    outcome: {
      ok: true,
      requestId: row.id,
      status: updated.status,
      closeReason: updated.close_reason,
      jobs,
    },
    publishes,
    afterCommit,
  };
}

function rejected(error: string): TransitionTxResult {
  return { outcome: { ok: false, error }, publishes: [], afterCommit: [] };
}

interface EffectContext {
  row: RequestJoinRow;
  updated: RequestJoinRow;
  meta: MoneyMeta;
  pricing: RequestPricingContext;
  now: number;
  jobs: DeadlineJob[];
  publishEvents: RealtimeEvent[];
  afterCommit: Array<() => Promise<void>>;
}

async function executeEffect(
  client: PoolClient,
  effect: Effect,
  ctx: EffectContext,
): Promise<void> {
  const { updated, meta, now } = ctx;
  switch (effect.type) {
    case "refund_full": {
      const amount = updated.amount_cents;
      const reason = updated.close_reason ?? "refund";
      // Captured money is refunded; a bare authorization is voided — the
      // guest never pays for a track that did not play (B4.3/B4.4).
      const refund = await ensureRefund(client, meta, amount, reason, now);
      if (refund.status === "nothing_captured") {
        await voidAuthorization(client, meta);
      }
      updated.refunded_cents = ctx.row.refunded_cents + amount;
      break;
    }
    case "refund_difference": {
      // SLA demotion (B4.1): MB WAY money comes straight back; for
      // card/wallet nothing was captured yet, so shrinking
      // `amount_cents` shrinks the eventual capture instead.
      const refund = await ensureRefund(client, meta, effect.amountCents, "sla_missed", now);
      if (refund.status === "nothing_captured") {
        // Authorization-only: the smaller capture happens at playing.
      }
      updated.amount_cents = Math.max(0, updated.amount_cents - effect.amountCents);
      updated.refunded_cents = updated.refunded_cents + effect.amountCents;
      break;
    }
    case "capture": {
      await capturePayment(client, meta, updated.amount_cents, now);
      break;
    }
    case "void_authorization": {
      await voidAuthorization(client, meta);
      break;
    }
    case "demote_to_queue": {
      updated.original_tier = updated.original_tier ?? updated.tier;
      updated.tier = "QUEUE";
      updated.sla_missed = true;
      updated.deadline_at = null; // QUEUE's promise is the end of the set
      break;
    }
    case "schedule_deadline": {
      if (effect.kind === "decision") {
        updated.decision_deadline_at = new Date(effect.atMs);
        ctx.jobs.push({ kind: "decision_timeout", requestId: meta.requestId, runAtMs: effect.atMs });
      } else {
        updated.deadline_at = new Date(effect.atMs);
        ctx.jobs.push({ kind: "promise_deadline", requestId: meta.requestId, runAtMs: effect.atMs });
      }
      break;
    }
    case "publish": {
      ctx.publishEvents.push(effect.event);
      break;
    }
    case "issue_invoice": {
      const { requestId } = meta;
      const guestId = updated.guest_id;
      const amountCents = updated.amount_cents;
      const description = `${updated.track_title} — ${updated.track_artist}`;
      ctx.afterCommit.push(async () => {
        const invoicing = await getInvoicingProvider();
        const invoice = await invoicing.issueReceipt({
          requestId,
          guestId,
          amountCents,
          vatRate: 23,
          description,
        });
        await getPool().query(
          `insert into public.invoices
             (request_id, guest_id, amount_cents, provider, provider_ref, pdf_url, status)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [requestId, guestId, amountCents, "mock", invoice.providerRef, invoice.pdfUrl, invoice.status],
        );
      });
      break;
    }
    case "generate_share_card": {
      // Rendered on demand by the guest surface ("A minha música tocou",
      // B6) — nothing to precompute server-side.
      break;
    }
    case "charge_difference": {
      // The upgrade flow charges BEFORE applying the event (see
      // `upgradeTier`); the effect is audit data only.
      break;
    }
  }
}

async function buildPublishes(
  client: PoolClient,
  row: RequestJoinRow,
  events: RealtimeEvent[],
  pricing: RequestPricingContext,
  now: number,
): Promise<OutgoingBroadcast[]> {
  if (events.length === 0) return [];
  const publishes: OutgoingBroadcast[] = [];

  const staffPayload = toStaffRequestDto(row, {
    betbeatFeeBps: pricing.config.betbeatFeeBps,
    venueShareBps: pricing.venueShareBps,
    zoneName: row.zone_name,
  });
  const guestPayload = toGuestRequestPayload(row);

  for (const event of events) {
    if (event === "queue.changed" || event === "price.changed") {
      publishes.push({
        topic: staffChannel(row.session_id),
        event,
        payload: { sessionId: row.session_id },
        private: true,
      });
      continue;
    }
    publishes.push({
      topic: staffChannel(row.session_id),
      event,
      payload: staffPayload,
      private: true,
    });
    publishes.push({
      topic: guestChannel(row.guest_id),
      event,
      payload: guestPayload,
      private: true,
    });
    if (event === "request.playing") {
      // Public payload is anonymous unless the guest opted in (B8).
      const guestRes = await client.query<{ handle: string | null; ranking_optin: boolean }>(
        `select handle, ranking_optin from public.guests where id = $1`,
        [row.guest_id],
      );
      const guest = guestRes.rows[0];
      publishes.push({
        topic: publicChannel(row.session_id),
        event,
        payload: toPublicNowDto(row, {
          handle: guest && guest.ranking_optin ? guest.handle : null,
          startedAtMs: now,
        }),
        private: false,
      });
    }
  }
  return publishes;
}

/** Flushes a transition's post-commit work (broadcasts + tasks). */
async function finishTransition(tx: TransitionTxResult, now: number): Promise<TransitionOutcome> {
  await publishBroadcasts(tx.publishes, now);
  for (const task of tx.afterCommit) {
    try {
      await task();
    } catch (error) {
      console.error(
        `[domain] post-commit task failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
  return tx.outcome;
}

/**
 * Applies one event to one request in its own transaction, then flushes
 * realtime publishes and post-commit tasks. The single entry point for
 * routes and the worker.
 */
export async function applyTransition(
  requestId: string,
  event: RequestEvent,
  actor: string,
  now: number,
): Promise<TransitionOutcome> {
  try {
    const tx = await withTransaction((client) =>
      applyTransitionInTx(client, requestId, event, actor, now),
    );
    return await finishTransition(tx, now);
  } catch (error) {
    if (isUniqueViolation(error, "requests_one_active_next_idx")) {
      return { ok: false, error: "tier_unavailable" };
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Payment outcomes (called by lib/payments/service.recordWebhook)     */
/* ------------------------------------------------------------------ */

/**
 * Translates a payment-level outcome into the request transition it
 * implies, inside the webhook's transaction. Upgrade payments apply
 * `upgrade_tier` on confirmation; primary payments map 1:1 to the
 * machine's payment events.
 */
export async function applyPaymentOutcomeInTx(
  client: PoolClient,
  payment: PaymentRow,
  kind: "confirmed" | "failed" | "expired",
  now: number,
): Promise<TransitionTxResult> {
  const purpose = parsePaymentPurpose(payment.idempotency_key);
  if (purpose.kind === "unknown") return rejected("unknown_payment_purpose");

  if (purpose.kind === "primary") {
    const event: RequestEvent =
      kind === "confirmed"
        ? { type: "payment_confirmed" }
        : kind === "failed"
          ? { type: "payment_failed" }
          : { type: "payment_expired" };
    return applyTransitionInTx(client, purpose.requestId, event, "system:psp", now);
  }

  // Upgrade payment.
  if (kind !== "confirmed") {
    // The upgrade simply does not happen; the original request stands.
    return rejected("upgrade_payment_not_confirmed");
  }
  const reqRes = await client.query<{ amount_cents: number; session_id: string; tier: Tier }>(
    `select amount_cents, session_id, tier from public.requests where id = $1`,
    [purpose.requestId],
  );
  const req = reqRes.rows[0];
  if (!req) return rejected("request_not_found");

  const configRes = await client.query<{ config: unknown }>(
    `select coalesce(ss.config, '{}'::jsonb) as config
       from public.sessions s
       left join public.session_settings ss on ss.session_id = s.id
      where s.id = $1`,
    [req.session_id],
  );
  const config = parseSessionConfig(configRes.rows[0]?.config);

  if (purpose.toTier === "NEXT") {
    // Re-check NEXT exclusivity under the session lock before flipping
    // the tier (the unique index would abort the whole webhook tx).
    await client.query(`select id from public.sessions where id = $1 for update`, [
      req.session_id,
    ]);
    const nextRes = await client.query<{ n: string }>(
      `select count(*)::bigint as n from public.requests
        where session_id = $1 and tier = 'NEXT' and status in ${ACTIVE_STATUSES} and id <> $2`,
      [req.session_id, purpose.requestId],
    );
    if (Number(nextRes.rows[0]?.n ?? 0) > 0) {
      // Slot vanished while the guest confirmed: give the money back.
      const metaRes = await client.query<{ venue_id: string }>(
        `select venue_id from public.requests where id = $1`,
        [purpose.requestId],
      );
      await ensureRefund(
        client,
        {
          requestId: purpose.requestId,
          sessionId: req.session_id,
          venueId: metaRes.rows[0]?.venue_id ?? "",
        },
        payment.amount_cents,
        "upgrade_unavailable",
        now,
      );
      return rejected("tier_unavailable");
    }
  }

  const deadline = promiseDeadlineAtMs(purpose.toTier, config, now);
  const event: RequestEvent = {
    type: "upgrade_tier",
    toTier: purpose.toTier,
    newAmountCents: req.amount_cents + payment.amount_cents,
    newDeadlineAtMs: deadline ?? now + config.soonDeadlineMin * 60_000,
  };
  return applyTransitionInTx(client, purpose.requestId, event, "system:psp", now);
}

/* ------------------------------------------------------------------ */
/* createRequestAndStartPayment                                        */
/* ------------------------------------------------------------------ */

export type CreateRequestError =
  | QuoteValidationError
  | "guest_limit"
  | "spend_limit"
  | "already_requested"
  | "recently_played"
  | "invalid_message"
  | "phone_required";

export interface CreateRequestParams {
  quoteId: string;
  guestId: string;
  tier: Tier;
  /** What the guest pays — ≥ the quoted tier price (free extra value). */
  amountCents: number;
  method: PaymentMethod;
  /** E.164, required for MB WAY. */
  phone?: string;
  email?: string;
  /** Optional message to the DJ (B4.7) — only if the session allows it. */
  message?: string;
}

export interface CreateRequestSuccess {
  ok: true;
  requestId: string;
  status: RequestStatus;
  payment: {
    paymentId: string;
    providerRef: string | null;
    status: PaymentStatus;
    /** MB WAY push expiry, ISO UTC. */
    expiresAt: string | null;
  };
  jobs: DeadlineJob[];
}

export type CreateRequestOutcome =
  | CreateRequestSuccess
  | { ok: false; error: CreateRequestError };

interface ReservationResult {
  row: RequestRow;
  validated: ValidatedQuote;
}

/**
 * B4.3 "Validação da cotação": re-validates the quote, enforces guest
 * limits and capacity, RESERVES the slot and inserts the request —
 * all inside ONE transaction serialized on the session row — then
 * starts the payment with the configured provider (idempotency key
 * `pay:<requestId>`). Returns the deadline job for the payment timeout.
 */
export async function createRequestAndStartPayment(
  params: CreateRequestParams,
  now: number,
): Promise<CreateRequestOutcome> {
  if (params.method === "mbway" && !params.phone) {
    return { ok: false, error: "phone_required" };
  }

  let reservation: ReservationResult;
  try {
    const result = await withTransaction<ReservationResult | { error: CreateRequestError }>(
      async (client) => {
        const validated = await validateQuoteForPayment(
          params.quoteId,
          params.tier,
          params.amountCents,
          params.guestId,
          now,
          client,
        );
        if (!validated.ok) return { error: validated.error };
        const { config } = validated;

        // THE serialization point (B4.3): all reservations for a session
        // queue behind this lock, so a slot is never sold twice.
        await client.query(`select id from public.sessions where id = $1 for update`, [
          validated.sessionId,
        ]);

        // Guest limits (B4.7).
        const countsRes = await client.query<{
          guest_active: string;
          next_active: string;
          soon_active: string;
        }>(
          `select count(*) filter (where guest_id = $2) as guest_active,
                  count(*) filter (where tier = 'NEXT') as next_active,
                  count(*) filter (where tier = 'SOON') as soon_active
             from public.requests
            where session_id = $1 and status in ${ACTIVE_STATUSES}`,
          [validated.sessionId, params.guestId],
        );
        const counts = countsRes.rows[0];
        if (!counts) throw new Error("count query returned no row");
        if (Number(counts.guest_active) >= config.maxActiveRequestsPerGuest) {
          return { error: "guest_limit" as const };
        }

        // Night spend limit, shared across guests with the same salted
        // phone hash (B4.7, B12.5).
        const spendRes = await client.query<{ spent: string }>(
          `select coalesce(sum(r.amount_cents - r.refunded_cents), 0)::bigint as spent
             from public.requests r
             join public.guests g on g.id = r.guest_id
            where r.session_id = $1
              and r.status in ('pending_payment', 'paid', 'accepted', 'playing', 'played')
              and (r.guest_id = $2
                   or (g.phone_hash is not null
                       and g.phone_hash = (select phone_hash from public.guests where id = $2)))`,
          [validated.sessionId, params.guestId],
        );
        const spent = Number(spendRes.rows[0]?.spent ?? 0);
        if (spent + params.amountCents > config.nightSpendLimitCents) {
          return { error: "spend_limit" as const };
        }

        // One active request per track (B4.6 "Já pedida").
        const dupRes = await client.query(
          `select 1 from public.requests
            where session_id = $1 and status in ${ACTIVE_STATUSES}
              and ((library_track_id is not null and library_track_id = $2)
                or (track_id is not null and track_id = $3)
                or (lower(track_title) = lower($4) and lower(track_artist) = lower($5)))
            limit 1`,
          [
            validated.sessionId,
            validated.libraryTrackId,
            validated.trackId,
            validated.trackTitle,
            validated.trackArtist,
          ],
        );
        if ((dupRes.rowCount ?? 0) > 0) return { error: "already_requested" as const };

        // No-repeat window (B4.6): played < noRepeatWindowMin ago.
        const repeatRes = await client.query(
          `select 1 from public.session_tracks
            where session_id = $1 and started_at > to_timestamp($2 / 1000.0)
              and lower(title) = lower($3) and lower(artist) = lower($4)
            limit 1`,
          [
            validated.sessionId,
            now - config.noRepeatWindowMin * 60_000,
            validated.trackTitle,
            validated.trackArtist,
          ],
        );
        if ((repeatRes.rowCount ?? 0) > 0) return { error: "recently_played" as const };

        // Capacity re-check under the lock (B4.3/B5.2); the partial
        // unique index requests_one_active_next_idx is the backstop.
        if (params.tier === "NEXT" && Number(counts.next_active) > 0) {
          return { error: "tier_unavailable" as const };
        }
        if (params.tier === "SOON") {
          const soonCapacity = Math.max(
            1,
            Math.floor((config.acceptanceRatePerHour * config.soonDeadlineMin) / 60),
          );
          if (Number(counts.soon_active) >= soonCapacity) {
            return { error: "tier_unavailable" as const };
          }
        }

        // Guest message (B4.7): off by default, 60 chars max.
        const message = params.message?.trim() || null;
        if (message !== null && (!config.guestMessagesEnabled || message.length > 60)) {
          return { error: "invalid_message" as const };
        }

        // Track snapshot for the request row (stable if catalogs change).
        const snapshot = await loadTrackSnapshot(client, validated);

        const insertRes = await client.query<RequestRow>(
          `insert into public.requests
             (venue_id, session_id, zone_id, guest_id, quote_id,
              library_track_id, track_id, track_title, track_artist, track_genre,
              track_bpm, track_key, track_duration_sec, cover_url, in_library,
              fit_score, fit_label, tier, amount_cents, status, message)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   $11, $12, $13, $14, $15, $16, $17, $18, $19, 'pending_payment', $20)
           returning *`,
          [
            validated.venueId,
            validated.sessionId,
            validated.zoneId,
            params.guestId,
            validated.quoteId,
            validated.libraryTrackId,
            validated.trackId,
            validated.trackTitle,
            validated.trackArtist,
            validated.trackGenre,
            snapshot.bpm,
            snapshot.camelotKey,
            snapshot.durationSec,
            snapshot.coverUrl,
            validated.libraryTrackId !== null,
            validated.fitScore,
            validated.fitLabel,
            params.tier,
            params.amountCents,
            message,
          ],
        );
        const row = insertRes.rows[0];
        if (!row) throw new Error("request insert returned no row");

        await client.query(`update public.quotes set converted = true where id = $1`, [
          validated.quoteId,
        ]);
        await client.query(
          `insert into public.request_events (request_id, from_status, to_status, reason, actor, payload)
           values ($1, null, 'pending_payment', 'created', $2, $3)`,
          [
            row.id,
            `guest:${params.guestId}`,
            JSON.stringify({ quoteId: validated.quoteId, tier: params.tier, amountCents: params.amountCents }),
          ],
        );
        await client.query(
          `insert into public.audit_log (actor, action, entity, entity_id, venue_id, payload)
           values ($1, 'request.created', 'request', $2, $3, $4)`,
          [
            `guest:${params.guestId}`,
            row.id,
            validated.venueId,
            JSON.stringify({ tier: params.tier, amountCents: params.amountCents, method: params.method }),
          ],
        );
        return { row, validated };
      },
    );
    if ("error" in result) return { ok: false, error: result.error };
    reservation = result;
  } catch (error) {
    if (isUniqueViolation(error, "requests_one_active_next_idx")) {
      return { ok: false, error: "tier_unavailable" };
    }
    throw error;
  }

  const { row, validated } = reservation;

  // Store the salted phone hash for cross-device night limits (B4.7,
  // B12.5) — never the number in clear.
  if (params.phone) {
    await getPool().query(
      `update public.guests
          set phone_encrypted = $2, phone_hash = $3
        where id = $1 and phone_hash is distinct from $3`,
      [params.guestId, encrypt(params.phone), hashPhone(params.phone)],
    );
  }

  // Start the payment OUTSIDE the reservation transaction: the slot is
  // reserved either way, and the payment-timeout job releases it if the
  // guest never pays (B4.2 payment_timeout).
  const provider = await getPaymentProvider();
  const idempotencyKey = `pay:${row.id}`;
  let intent: PaymentIntentResult | null = null;
  try {
    const input = {
      idempotencyKey,
      requestId: row.id,
      method: params.method,
      amountCents: params.amountCents,
      currency: "EUR" as const,
      ...(params.phone !== undefined ? { phone: params.phone } : {}),
      ...(params.email !== undefined ? { email: params.email } : {}),
    };
    intent = params.method === "mbway" ? await provider.charge(input) : await provider.authorize(input);
  } catch (error) {
    console.error(
      `[domain] payment start failed for ${row.id}: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  const paymentStatus: PaymentStatus = intent?.status ?? "pending";
  const paymentRes = await getPool().query<PaymentRow>(
    `insert into public.payments
       (request_id, guest_id, provider, method, status, amount_cents, provider_ref, idempotency_key, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (idempotency_key) do update set updated_at = now()
     returning *`,
    [
      row.id,
      params.guestId,
      provider.name,
      params.method,
      paymentStatus,
      params.amountCents,
      intent?.providerRef ?? null,
      idempotencyKey,
      intent?.expiresAt ?? null,
    ],
  );
  const payment = paymentRes.rows[0];
  if (!payment) throw new Error("payment insert returned no row");

  const jobs: DeadlineJob[] = [];
  let status: RequestStatus = row.status;

  if (intent?.status === "authorized") {
    // Card/wallet: the hold succeeded — the request is paid NOW and the
    // money is captured only when the track plays (B4.3).
    const confirmed = await applyTransition(
      row.id,
      { type: "payment_confirmed" },
      "system:psp",
      now,
    );
    if (confirmed.ok) {
      status = confirmed.status;
      jobs.push(...confirmed.jobs);
    }
  } else if (intent?.status === "failed") {
    const failed = await applyTransition(row.id, { type: "payment_failed" }, "system:psp", now);
    if (failed.ok) status = failed.status;
  } else {
    // MB WAY push pending (or provider hiccup): the worker expires the
    // reservation when the window closes.
    const timeoutAtMs = intent?.expiresAt
      ? Date.parse(intent.expiresAt)
      : now + validated.config.mbwayTimeoutMin * 60_000;
    jobs.push({ kind: "payment_timeout", requestId: row.id, runAtMs: timeoutAtMs });
  }

  return {
    ok: true,
    requestId: row.id,
    status,
    payment: {
      paymentId: payment.id,
      providerRef: payment.provider_ref,
      status: payment.status,
      expiresAt: payment.expires_at ? payment.expires_at.toISOString() : null,
    },
    jobs,
  };
}

interface TrackSnapshot {
  bpm: number | null;
  camelotKey: string | null;
  durationSec: number | null;
  coverUrl: string | null;
}

async function loadTrackSnapshot(
  client: PoolClient,
  validated: ValidatedQuote,
): Promise<TrackSnapshot> {
  if (validated.libraryTrackId !== null) {
    const res = await client.query<{
      bpm: string | null;
      camelot_key: string | null;
      duration_sec: number | null;
    }>(
      `select bpm, camelot_key, duration_sec from public.library_tracks where id = $1`,
      [validated.libraryTrackId],
    );
    const t = res.rows[0];
    return {
      bpm: t?.bpm !== null && t?.bpm !== undefined ? Number(t.bpm) : null,
      camelotKey: t?.camelot_key ?? null,
      durationSec: t?.duration_sec ?? null,
      coverUrl: null,
    };
  }
  const res = await client.query<{
    bpm: string | null;
    camelot_key: string | null;
    duration_sec: number | null;
    cover_url: string | null;
  }>(
    `select bpm, camelot_key, duration_sec, cover_url from public.tracks where id = $1`,
    [validated.trackId],
  );
  const t = res.rows[0];
  return {
    bpm: t?.bpm !== null && t?.bpm !== undefined ? Number(t.bpm) : null,
    camelotKey: t?.camelot_key ?? null,
    durationSec: t?.duration_sec ?? null,
    coverUrl: t?.cover_url ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Convenience wrappers (routes + worker)                              */
/* ------------------------------------------------------------------ */

/**
 * Manual confirmation path (dev panel): builds a synthetic
 * payment.confirmed webhook for the payment's providerRef and runs it
 * through the exact same `recordWebhook` pipeline.
 */
export async function confirmPayment(providerRef: string, now: number) {
  const { recordWebhook } = await import("@/lib/payments/service");
  const event: WebhookEvent = {
    id: `manual_${providerRef}_payment.confirmed`,
    providerRef,
    type: "payment.confirmed",
    raw: { manual: true },
  };
  return recordWebhook(event, now);
}

export async function djAccept(requestId: string, staffActor: string, now: number) {
  return applyTransition(requestId, { type: "dj_accept" }, staffActor, now);
}

export async function djReject(
  requestId: string,
  reason: RejectReason,
  staffActor: string,
  now: number,
) {
  return applyTransition(requestId, { type: "dj_reject", reason }, staffActor, now);
}

export async function djCancel(requestId: string, staffActor: string, now: number) {
  return applyTransition(requestId, { type: "dj_cancel" }, staffActor, now);
}

export async function djPin(
  requestId: string,
  pinned: boolean,
  staffActor: string,
  now: number,
) {
  return applyTransition(
    requestId,
    { type: pinned ? "dj_pin" : "dj_unpin" },
    staffActor,
    now,
  );
}

export async function djMarkPlaying(requestId: string, staffActor: string, now: number) {
  return applyTransition(requestId, { type: "dj_mark_playing" }, staffActor, now);
}

/** `played` is automatic: track duration elapsed or DJ marked the next. */
export async function markTrackFinished(requestId: string, actor: string, now: number) {
  return applyTransition(requestId, { type: "track_finished" }, actor, now);
}

/** Worker: DJ decision window elapsed without a decision (B4.1). */
export async function applyDecisionTimeout(requestId: string, now: number) {
  return applyTransition(requestId, { type: "decision_timeout" }, "system:worker", now);
}

/** Worker: SOON/NEXT promise missed → demote + refund difference (B4.2). */
export async function applySlaMissed(requestId: string, now: number) {
  return applyTransition(requestId, { type: "sla_missed" }, "system:worker", now);
}

/** Worker: MB WAY payment window elapsed unpaid → expire (B4.2). */
export async function expireUnpaidRequest(requestId: string, now: number) {
  return applyTransition(requestId, { type: "payment_expired" }, "system:worker", now);
}

/* ------------------------------------------------------------------ */
/* upgradeTier                                                         */
/* ------------------------------------------------------------------ */

export type UpgradeError =
  | "request_not_found"
  | "not_request_owner"
  | "not_upgradable"
  | "tier_unavailable"
  | "phone_required"
  | "quote_failed";

export interface UpgradeStarted {
  ok: true;
  requestId: string;
  toTier: Tier;
  /** The difference charged now, cents (0 = instant upgrade). */
  chargedCents: number;
  /** 'applied' (card/free) or 'pending_payment' (MB WAY push out). */
  state: "applied" | "pending_payment";
  payment: { paymentId: string; providerRef: string | null; expiresAt: string | null } | null;
  jobs: DeadlineJob[];
}

export type UpgradeOutcome = UpgradeStarted | { ok: false; error: UpgradeError };

/**
 * Upgrade to a stronger promise (B4.1): the guest pays only the
 * difference to the new tier's CURRENT price, via a fresh quote; the
 * deadline restarts from the upgrade. Card/wallet differences authorize
 * synchronously and apply at once; MB WAY differences apply when the
 * push confirms (webhook → upgrade payment → `upgrade_tier`).
 */
export async function upgradeTier(
  requestId: string,
  toTier: Tier,
  guestId: string,
  now: number,
): Promise<UpgradeOutcome> {
  const reqRes = await getPool().query<RequestRow>(
    `select * from public.requests where id = $1`,
    [requestId],
  );
  const row = reqRes.rows[0];
  if (!row) return { ok: false, error: "request_not_found" };
  if (row.guest_id !== guestId) return { ok: false, error: "not_request_owner" };
  if (
    (row.status !== "paid" && row.status !== "accepted") ||
    !isHigherTier(toTier, row.tier)
  ) {
    return { ok: false, error: "not_upgradable" };
  }

  // Fresh quote for the CURRENT price of the new tier (never the
  // original quote — B4.1 "preço atual do novo nível").
  const { getQuote } = await import("./quotes");
  const trackRef =
    row.library_track_id !== null
      ? ({ source: "library", trackId: row.library_track_id } as const)
      : ({ source: "catalog", trackId: row.track_id ?? "" } as const);
  const quote = await getQuote(row.session_id, row.zone_id, guestId, trackRef, now);
  if (!quote.ok) return { ok: false, error: "quote_failed" };
  const tierQuote = quote.result.tiers.find((t) => t.tier === toTier);
  if (!tierQuote || !tierQuote.available) {
    return { ok: false, error: "tier_unavailable" };
  }

  const diff = Math.max(0, tierQuote.priceCents - row.amount_cents);
  const configRes = await getPool().query<{ config: unknown }>(
    `select coalesce(ss.config, '{}'::jsonb) as config
       from public.sessions s
       left join public.session_settings ss on ss.session_id = s.id
      where s.id = $1`,
    [row.session_id],
  );
  const config = parseSessionConfig(configRes.rows[0]?.config);

  if (diff === 0) {
    // Free extra value already covers the new tier: apply at once.
    const deadline = promiseDeadlineAtMs(toTier, config, now);
    const applied = await applyTransition(
      requestId,
      {
        type: "upgrade_tier",
        toTier,
        newAmountCents: row.amount_cents,
        newDeadlineAtMs: deadline ?? now + config.soonDeadlineMin * 60_000,
      },
      `guest:${guestId}`,
      now,
    );
    if (!applied.ok) {
      return { ok: false, error: applied.error === "tier_unavailable" ? "tier_unavailable" : "not_upgradable" };
    }
    return {
      ok: true,
      requestId,
      toTier,
      chargedCents: 0,
      state: "applied",
      payment: null,
      jobs: applied.jobs,
    };
  }

  // Charge the difference FIRST (B4.1 "paga-se só a diferença"), with
  // the same method as the primary payment.
  const primaryRes = await getPool().query<PaymentRow>(
    `select * from public.payments where idempotency_key = $1`,
    [`pay:${requestId}`],
  );
  const primary = primaryRes.rows[0];
  const method: PaymentMethod = primary?.method ?? "card";

  let phone: string | undefined;
  if (method === "mbway") {
    const guestRes = await getPool().query<{ phone_encrypted: string | null }>(
      `select phone_encrypted from public.guests where id = $1`,
      [guestId],
    );
    const enc = guestRes.rows[0]?.phone_encrypted;
    if (!enc) return { ok: false, error: "phone_required" };
    const { decrypt } = await import("@/lib/security/crypto");
    phone = decrypt(enc);
  }

  const provider = await getPaymentProvider();
  const idempotencyKey = `pay:${requestId}:upgrade:${toTier}`;
  const input = {
    idempotencyKey,
    requestId,
    method,
    amountCents: diff,
    currency: "EUR" as const,
    ...(phone !== undefined ? { phone } : {}),
  };
  const intent = method === "mbway" ? await provider.charge(input) : await provider.authorize(input);

  const paymentRes = await getPool().query<PaymentRow>(
    `insert into public.payments
       (request_id, guest_id, provider, method, status, amount_cents, provider_ref, idempotency_key, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (idempotency_key) do update set updated_at = now()
     returning *`,
    [
      requestId,
      guestId,
      provider.name,
      method,
      intent.status,
      diff,
      intent.providerRef,
      idempotencyKey,
      intent.expiresAt ?? null,
    ],
  );
  const payment = paymentRes.rows[0];
  if (!payment) throw new Error("upgrade payment insert returned no row");

  if (intent.status === "authorized") {
    // Card/wallet: hold succeeded → apply the upgrade now.
    const tx = await withTransaction((client) =>
      applyPaymentOutcomeInTx(client, payment, "confirmed", now),
    );
    const outcome = await finishTransition(tx, now);
    if (!outcome.ok) {
      return { ok: false, error: outcome.error === "tier_unavailable" ? "tier_unavailable" : "not_upgradable" };
    }
    return {
      ok: true,
      requestId,
      toTier,
      chargedCents: diff,
      state: "applied",
      payment: { paymentId: payment.id, providerRef: payment.provider_ref, expiresAt: null },
      jobs: outcome.jobs,
    };
  }

  // MB WAY: upgrade applies when the push confirms (recordWebhook).
  return {
    ok: true,
    requestId,
    toTier,
    chargedCents: diff,
    state: "pending_payment",
    payment: {
      paymentId: payment.id,
      providerRef: payment.provider_ref,
      expiresAt: payment.expires_at ? payment.expires_at.toISOString() : null,
    },
    jobs: [
      {
        kind: "payment_timeout",
        requestId,
        runAtMs: payment.expires_at
          ? payment.expires_at.getTime()
          : now + config.mbwayTimeoutMin * 60_000,
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* endSession                                                          */
/* ------------------------------------------------------------------ */

export interface EndSessionResult {
  ok: true;
  alreadyEnded: boolean;
  closedRequests: number;
  statement: ReturnType<typeof sessionStatement>;
  payoutIds: string[];
}

/**
 * Ends a session (DJ action or the 30-min auto-close worker, B4.2):
 * every active request gets `session_ended` (full refund — B4.1), the
 * session closes, and pending payout rows are created from the ledger's
 * session statement (executed by the worker via SEPA after review).
 */
export async function endSession(
  sessionId: string,
  actor: string,
  now: number,
): Promise<EndSessionResult | { ok: false; error: "session_not_found" }> {
  const header = await withTransaction(async (client) => {
    const res = await client.query<{
      id: string;
      venue_id: string;
      dj_staff_id: string | null;
      status: string;
    }>(
      `select id, venue_id, dj_staff_id, status from public.sessions where id = $1 for update`,
      [sessionId],
    );
    const session = res.rows[0];
    if (!session) return null;
    if (session.status === "ended") {
      return { ...session, alreadyEnded: true };
    }
    await client.query(
      `update public.sessions
          set status = 'ended', ended_at = to_timestamp($2 / 1000.0), requests_open = false
        where id = $1`,
      [sessionId, now],
    );
    await client.query(
      `insert into public.audit_log (actor, action, entity, entity_id, venue_id, payload)
       values ($1, 'session.ended', 'session', $2, $3, '{}'::jsonb)`,
      [actor, sessionId, session.venue_id],
    );
    return { ...session, alreadyEnded: false };
  });
  if (!header) return { ok: false, error: "session_not_found" };

  // Close every active request — one transaction each, so a single bad
  // row never blocks the other refunds.
  let closed = 0;
  if (!header.alreadyEnded) {
    const activeRes = await getPool().query<{ id: string }>(
      `select id from public.requests
        where session_id = $1 and status not in ('played', 'expired', 'refunded')
        order by created_at`,
      [sessionId],
    );
    for (const { id } of activeRes.rows) {
      const outcome = await applyTransition(id, { type: "session_ended" }, actor, now);
      if (outcome.ok) closed += 1;
    }
  }

  // Payouts from the ledger statement (B4.5): rows are created pending
  // here; the worker executes them (SEPA) and posts the payout groups.
  const entriesRes = await getPool().query<LedgerEntryRow>(
    `select account, amount_cents from public.ledger_entries where session_id = $1`,
    [sessionId],
  );
  const statement = sessionStatement(entriesRes.rows);

  const payoutIds: string[] = [];
  const payoutPlan: Array<{ recipient: "venue" | "dj"; amount: number; staffId: string | null }> = [
    { recipient: "venue", amount: statement.venueNet, staffId: null },
    { recipient: "dj", amount: statement.djNet, staffId: header.dj_staff_id },
  ];
  for (const plan of payoutPlan) {
    if (plan.amount <= 0) continue;
    const existing = await getPool().query<{ id: string }>(
      `select id from public.payouts where session_id = $1 and recipient_type = $2`,
      [sessionId, plan.recipient],
    );
    const found = existing.rows[0];
    if (found) {
      payoutIds.push(found.id);
      continue;
    }
    const inserted = await getPool().query<{ id: string }>(
      `insert into public.payouts (session_id, venue_id, recipient_type, staff_id, amount_cents, status, report)
       values ($1, $2, $3, $4, $5, 'pending', $6)
       returning id`,
      [
        sessionId,
        header.venue_id,
        plan.recipient,
        plan.staffId,
        plan.amount,
        JSON.stringify({ statement }),
      ],
    );
    const payoutId = inserted.rows[0]?.id;
    if (payoutId) payoutIds.push(payoutId);
  }

  await publishBroadcasts(
    [
      {
        topic: staffChannel(sessionId),
        event: "session.ended",
        payload: { sessionId },
        private: true,
      },
      {
        topic: publicChannel(sessionId),
        event: "session.ended",
        payload: { sessionId },
        private: false,
      },
    ],
    now,
  );

  return {
    ok: true,
    alreadyEnded: header.alreadyEnded,
    closedRequests: closed,
    statement,
    payoutIds,
  };
}

/* ------------------------------------------------------------------ */
/* Worker payout execution (B4.5 — SEPA via PSP, mocked until Phase 8) */
/* ------------------------------------------------------------------ */

/**
 * Executes a pending payout: posts the ledger payout group and marks the
 * row paid. The PSP transfer itself is Phase 8; until then the group
 * documents the liability settlement.
 */
export async function executePayout(payoutId: string, now: number): Promise<boolean> {
  return withTransaction(async (client) => {
    const res = await client.query<{
      id: string;
      session_id: string;
      venue_id: string;
      recipient_type: "venue" | "dj";
      amount_cents: string | number;
      status: string;
    }>(`select * from public.payouts where id = $1 for update`, [payoutId]);
    const payout = res.rows[0];
    if (!payout || payout.status !== "pending") return false;
    const amount = Number(payout.amount_cents);
    if (amount > 0) {
      await postLedgerGroup(
        client,
        payoutGroup(payout.recipient_type, amount, {
          venueId: payout.venue_id,
          sessionId: payout.session_id,
          memo: `payout:${payout.recipient_type}`,
        }),
      );
    }
    await client.query(
      `update public.payouts set status = 'paid', provider_ref = $2 where id = $1`,
      [payoutId, `mock_po_${payoutId.slice(0, 8)}_${now}`],
    );
    return true;
  });
}
