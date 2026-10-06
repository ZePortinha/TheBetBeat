/**
 * Integration tests for the worker jobs (BRIEF B4.2, B4.4, B4.5, B5.4, B11).
 *
 * They run against the LOCAL Supabase Postgres (supabase start) and are
 * only included when SUPABASE_TEST=1 (see vitest.config.ts):
 *
 *   SUPABASE_TEST=1 pnpm exec vitest run tests/integration/worker-jobs.integration.test.ts
 *
 * Covered on the real schema, driving the worker's scan/job functions
 * directly with an injected `now` (no pg-boss instance needed):
 *  - decision-window timeout → full refund (deadline scan a);
 *  - SOON promise missed → demote to QUEUE + refund the difference (b);
 *  - MB WAY expiry → request expired + payment row closed (c);
 *  - playing → played automatically after the track duration;
 *  - live session auto-closes 30 min after ends_at (d);
 *  - payout execution: pending → paid + ledger payout group + report,
 *    idempotent on a second run;
 *  - refund retry: a failed refund succeeds on retry with its ledger
 *    group; an exhausted refund alerts the admin EXACTLY once;
 *  - genre weekly: 30 low-conversion quotes recommend −0.05 and only
 *    apply when auto_apply is on;
 *  - daily reconciliation: report row written and the money invariants
 *    hold across everything the suite itself did.
 *
 * NOTE: scans are database-wide by design. Run integration suites
 * serially — a concurrent suite's in-flight rows past their deadlines
 * would be (correctly) processed by these scans.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));

/* ------------------------------------------------------------------ */
/* Environment (before any lib import — lib/security/env validates)    */
/* ------------------------------------------------------------------ */

function loadDotEnvLocal(): void {
  try {
    const raw = readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match && process.env[match[1] as string] === undefined) {
        process.env[match[1] as string] = match[2];
      }
    }
  } catch {
    // No .env.local — fall back to the local-CLI defaults below.
  }
}
loadDotEnvLocal();
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "local-anon-key-placeholder";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "local-service-key-placeholder";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.QR_TOKEN_SECRET ??= "integration-test-qr-secret-0123456789abcdef";
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ??= "test-site-key";
process.env.TURNSTILE_SECRET_KEY ??= "test-secret-key";
process.env.PAYMENT_WEBHOOK_SECRET ??= "integration-webhook-secret";

/* Modules under test (imported AFTER the env is in place). */
const db = await import("@/lib/db");
const quotesService = await import("@/lib/domain/quotes");
const domainService = await import("@/lib/domain/service");
const paymentsService = await import("@/lib/payments/service");
const { getPaymentProvider } = await import("@/lib/payments");
const { scanDeadlines } = await import("@/worker/jobs/deadlines");
const { processRefundRetry } = await import("@/worker/jobs/refund-retry");
const { runDailyReconciliation } = await import("@/worker/jobs/reconciliation");
const { runGenreWeekly } = await import("@/worker/jobs/genre-weekly");
const { executePayoutJob } = await import("@/worker/jobs/payouts");
import type { MockPaymentProvider } from "@/lib/payments/mock";
import type { Tier } from "@/lib/domain/types";

/* ------------------------------------------------------------------ */
/* Fixtures (supabase/seed.sql)                                        */
/* ------------------------------------------------------------------ */

const SESSION_ID = "dddddddd-0000-4000-8000-000000000001";
const VENUE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const ZONE_ID = "bbbbbbbb-0000-4000-8000-000000000001";

const RUN = randomUUID().slice(0, 8);
const SCAN_CONFIG = { batch: 100, sessionGraceMin: 30 };

let trackIds: string[] = [];
let nextTrack = 0;
let phoneCounter = 20_000_000;

function takeTrack(): string {
  const id = trackIds[nextTrack];
  nextTrack += 1;
  if (!id) throw new Error("test fixture ran out of library tracks");
  return id;
}

function takePhone(): string {
  phoneCounter += 1;
  return `+3519${String(phoneCounter).padStart(8, "0")}`;
}

async function createGuest(): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, email_change, email_change_token_new, recovery_token
     ) values (
       '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
       $2, '', now(), '{"provider":"anonymous","providers":["anonymous"]}', '{}',
       now(), now(), '', '', '', ''
     )`,
    [id, `wit-${RUN}-${id.slice(0, 8)}@betbeat.test`],
  );
  await db.query(`insert into public.guests (id, locale) values ($1, 'pt-PT')`, [id]);
  return id;
}

interface QuoteHandle {
  quoteId: string;
  prices: Record<Tier, number>;
  available: Record<Tier, boolean>;
}

async function makeQuote(guestId: string, trackId: string, now: number): Promise<QuoteHandle> {
  const quote = await quotesService.getQuote(
    SESSION_ID,
    ZONE_ID,
    guestId,
    { source: "library", trackId },
    now,
  );
  if (!quote.ok) throw new Error(`getQuote failed: ${quote.error}`);
  const prices = { QUEUE: 0, SOON: 0, NEXT: 0 } as Record<Tier, number>;
  const available = { QUEUE: false, SOON: false, NEXT: false } as Record<Tier, boolean>;
  for (const t of quote.result.tiers) {
    prices[t.tier] = t.priceCents;
    available[t.tier] = t.available;
  }
  return { quoteId: quote.quoteId, prices, available };
}

/** Creates an MB WAY request; optionally confirms it via the webhook path. */
async function createRequest(
  guestId: string,
  tier: Tier,
  now: number,
  confirm: boolean,
): Promise<{ requestId: string; amountCents: number; providerRef: string; prices: Record<Tier, number> }> {
  const quote = await makeQuote(guestId, takeTrack(), now);
  if (!quote.available[tier]) {
    throw new Error(`tier ${tier} unavailable — reset the db (pnpm db:reset) and rerun`);
  }
  const amountCents = quote.prices[tier];
  const created = await domainService.createRequestAndStartPayment(
    { quoteId: quote.quoteId, guestId, tier, amountCents, method: "mbway", phone: takePhone() },
    now,
  );
  if (!created.ok) throw new Error(`createRequest failed: ${created.error}`);
  const providerRef = created.payment.providerRef;
  if (!providerRef) throw new Error("mbway payment has no providerRef");

  if (confirm) {
    const provider = (await getPaymentProvider()) as MockPaymentProvider;
    const event = provider.simulateMbwayConfirmation(providerRef);
    const recorded = await paymentsService.recordWebhook(event, now + 1000);
    if (!recorded.handled || recorded.duplicate) {
      throw new Error(`webhook not applied: ${recorded.action}`);
    }
  }
  return { requestId: created.requestId, amountCents, providerRef, prices: quote.prices };
}

async function requestRowOf(requestId: string) {
  const res = await db.query<{
    status: string;
    tier: Tier;
    amount_cents: number;
    refunded_cents: number;
    sla_missed: boolean;
    close_reason: string | null;
    track_duration_sec: number | null;
  }>(`select * from public.requests where id = $1`, [requestId]);
  const row = res.rows[0];
  if (!row) throw new Error(`request ${requestId} not found`);
  return row;
}

beforeAll(async () => {
  // Only tracks that are requestable RIGHT NOW. The duplicate guard (B4.6
  // "Já pedida") matches on lower(title, artist) — and the seed library
  // repeats the same title+artist across genres — so dedupe by title and
  // exclude any title with an active request from a previous run, plus
  // titles played in the last 60 min (no-repeat window).
  const res = await db.query<{ id: string }>(
    `select t.id from (
        select distinct on (lower(lt.title), lower(lt.artist)) lt.id, lt.title, lt.artist
          from public.library_tracks lt
         where lt.venue_id = $1 and not lt.blocked
         order by lower(lt.title), lower(lt.artist), lt.id
      ) t
      where not exists (
          select 1 from public.requests r
           where r.status in ('pending_payment', 'paid', 'accepted', 'playing')
             and lower(r.track_title) = lower(t.title)
             and lower(r.track_artist) = lower(t.artist))
        and not exists (
          select 1 from public.session_tracks st
           where st.session_id = $2
             and st.started_at > now() - interval '60 minutes'
             and lower(st.title) = lower(t.title)
             and lower(st.artist) = lower(t.artist))
      order by t.title
      limit 60`,
    [VENUE_ID, SESSION_ID],
  );
  trackIds = res.rows.map((r) => r.id);
  if (trackIds.length < 8) throw new Error("not enough free library tracks — run pnpm db:reset");
});

/* ------------------------------------------------------------------ */
/* Deadline scans                                                      */
/* ------------------------------------------------------------------ */

describe("deadline scans", () => {
  it("refunds a paid request whose DJ decision window elapsed (B4.1)", async () => {
    const now = Date.now();
    const guest = await createGuest();
    const { requestId, amountCents } = await createRequest(guest, "QUEUE", now, true);

    await db.query(
      `update public.requests set decision_deadline_at = to_timestamp($2 / 1000.0)
        where id = $1`,
      [requestId, now - 1000],
    );
    const result = await scanDeadlines(Date.now(), SCAN_CONFIG);
    expect(result.decisionTimeouts).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(0);

    const row = await requestRowOf(requestId);
    expect(row.status).toBe("refunded");
    expect(row.close_reason).toBe("dj_timeout");
    expect(row.refunded_cents).toBe(amountCents);

    const refund = await db.query<{ status: string; amount_cents: number }>(
      `select status, amount_cents from public.refunds where request_id = $1`,
      [requestId],
    );
    expect(refund.rows[0]?.status).toBe("succeeded");
    expect(refund.rows[0]?.amount_cents).toBe(amountCents);
  });

  it("demotes a SOON request past its promise and refunds the difference (B4.2)", async () => {
    const now = Date.now();
    const guest = await createGuest();
    const { requestId, amountCents, prices } = await createRequest(guest, "SOON", now, true);

    await db.query(
      `update public.requests set deadline_at = to_timestamp($2 / 1000.0)
        where id = $1`,
      [requestId, now - 1000],
    );
    const result = await scanDeadlines(Date.now(), SCAN_CONFIG);
    expect(result.slaMissed).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(0);

    const row = await requestRowOf(requestId);
    expect(row.status).toBe("paid"); // stays in the queue (B4.2)
    expect(row.tier).toBe("QUEUE");
    expect(row.sla_missed).toBe(true);
    expect(row.refunded_cents).toBe(amountCents - prices.QUEUE);
    expect(row.amount_cents).toBe(prices.QUEUE);
  });

  it("expires an unpaid MB WAY request when the push window closes (B4.2)", async () => {
    const now = Date.now();
    const guest = await createGuest();
    const { requestId } = await createRequest(guest, "QUEUE", now, false);

    await db.query(
      `update public.payments set expires_at = to_timestamp($2 / 1000.0)
        where request_id = $1`,
      [requestId, now - 1000],
    );
    const result = await scanDeadlines(Date.now(), SCAN_CONFIG);
    expect(result.paymentsExpired).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(0);

    const row = await requestRowOf(requestId);
    expect(row.status).toBe("expired");
    expect(row.close_reason).toBe("payment_timeout");

    const payment = await db.query<{ status: string }>(
      `select status from public.payments where request_id = $1`,
      [requestId],
    );
    expect(payment.rows[0]?.status).toBe("expired");
  });

  it("marks a playing request played after the track duration (B4.2)", async () => {
    const now = Date.now();
    const guest = await createGuest();
    const { requestId } = await createRequest(guest, "QUEUE", now, true);

    const accepted = await domainService.djAccept(requestId, `staff:wit-${RUN}`, now + 2000);
    expect(accepted.ok).toBe(true);
    const playing = await domainService.djMarkPlaying(requestId, `staff:wit-${RUN}`, now + 3000);
    expect(playing.ok).toBe(true);

    const row = await requestRowOf(requestId);
    const durationSec = row.track_duration_sec ?? 300;
    await db.query(
      `update public.requests set playing_at = to_timestamp($2 / 1000.0)
        where id = $1`,
      [requestId, now - (durationSec + 2) * 1000],
    );
    const result = await scanDeadlines(Date.now(), SCAN_CONFIG);
    expect(result.tracksFinished).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(0);
    expect((await requestRowOf(requestId)).status).toBe("played");
  });

  it("auto-closes a live session 30 min after ends_at (B4.2)", async () => {
    const now = Date.now();
    const sessionId = randomUUID();
    await db.query(
      `insert into public.sessions (id, venue_id, name, status, starts_at, ends_at)
       values ($1, $2, $3, 'live', to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0))`,
      [sessionId, VENUE_ID, `Worker IT ${RUN}`, now - 3 * 3600 * 1000, now - 31 * 60 * 1000],
    );
    const result = await scanDeadlines(Date.now(), SCAN_CONFIG);
    expect(result.sessionsClosed).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(0);

    const session = await db.query<{ status: string; ended_at: Date | null }>(
      `select status, ended_at from public.sessions where id = $1`,
      [sessionId],
    );
    expect(session.rows[0]?.status).toBe("ended");
    expect(session.rows[0]?.ended_at).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Payout execution                                                    */
/* ------------------------------------------------------------------ */

describe("payout execution", () => {
  it("pays a pending payout with ledger group + report, exactly once (B4.5)", async () => {
    const now = Date.now();
    // Dedicated ENDED session so the ledger statement is isolated.
    const sessionId = randomUUID();
    await db.query(
      `insert into public.sessions (id, venue_id, name, status, ended_at, starts_at, ends_at)
       values ($1, $2, $3, 'ended', to_timestamp($4 / 1000.0),
               to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0))`,
      [
        sessionId,
        VENUE_ID,
        `Worker IT payouts ${RUN}`,
        now,
        now - 5 * 3600 * 1000,
        now - 3600 * 1000,
      ],
    );
    const inserted = await db.query<{ id: string }>(
      `insert into public.payouts (session_id, venue_id, recipient_type, amount_cents, status)
       values ($1, $2, 'venue', 5000, 'pending') returning id`,
      [sessionId, VENUE_ID],
    );
    const payoutId = inserted.rows[0]?.id;
    if (!payoutId) throw new Error("payout insert returned no row");

    const first = await executePayoutJob({ payoutId }, now);
    expect(first).toBe("paid");

    const payout = await db.query<{
      status: string;
      provider_ref: string | null;
      report: { statement?: unknown; providerRef?: string };
    }>(`select status, provider_ref, report from public.payouts where id = $1`, [payoutId]);
    const row = payout.rows[0];
    expect(row?.status).toBe("paid");
    expect(row?.provider_ref).toMatch(/^sepa_mock_/);
    expect(row?.report.statement).toBeDefined();
    expect(row?.report.providerRef).toBe(row?.provider_ref);

    const ledger = await db.query<{ account: string; amount_cents: string }>(
      `select account, amount_cents from public.ledger_entries
        where session_id = $1 and memo = 'payout:venue' order by account`,
      [sessionId],
    );
    expect(ledger.rows.map((l) => [l.account, Number(l.amount_cents)])).toEqual([
      ["psp_clearing", -5000],
      ["venue_payable", 5000],
    ]);

    // Idempotent: a second execution (duplicate job) is a no-op.
    expect(await executePayoutJob({ payoutId }, now + 1000)).toBe("skipped");
    const ledgerAgain = await db.query(
      `select 1 from public.ledger_entries where session_id = $1 and memo = 'payout:venue'`,
      [sessionId],
    );
    expect(ledgerAgain.rowCount).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Refund retry                                                        */
/* ------------------------------------------------------------------ */

describe("refund retry", () => {
  async function capturedPayment(): Promise<{
    requestId: string;
    paymentId: string;
    venueId: string;
  }> {
    const now = Date.now();
    const guest = await createGuest();
    const { requestId } = await createRequest(guest, "QUEUE", now, true);
    const res = await db.query<{ id: string }>(
      `select id from public.payments where request_id = $1 and status = 'captured'`,
      [requestId],
    );
    const paymentId = res.rows[0]?.id;
    if (!paymentId) throw new Error("captured payment missing");
    return { requestId, paymentId, venueId: VENUE_ID };
  }

  it("retries a failed refund to success and posts its ledger group (B4.4)", async () => {
    const { requestId, paymentId } = await capturedPayment();
    const reason = `worker_it_${RUN}`;
    const inserted = await db.query<{ id: string }>(
      `insert into public.refunds
         (payment_id, request_id, amount_cents, reason, status, idempotency_key, attempts, last_error)
       values ($1, $2, 100, $3, 'failed', $4, 1, 'simulated psp outage')
       returning id`,
      [paymentId, requestId, reason, `refund:${requestId}:${reason}`],
    );
    const refundId = inserted.rows[0]?.id;
    if (!refundId) throw new Error("refund insert returned no row");

    const outcome = await processRefundRetry({ refundId }, Date.now(), { maxAttempts: 5 });
    expect(outcome.status).toBe("succeeded");

    const refund = await db.query<{ status: string; provider_ref: string | null; attempts: number }>(
      `select status, provider_ref, attempts from public.refunds where id = $1`,
      [refundId],
    );
    expect(refund.rows[0]?.status).toBe("succeeded");
    expect(refund.rows[0]?.provider_ref).not.toBeNull();
    expect(refund.rows[0]?.attempts).toBe(2);

    const ledger = await db.query<{ account: string; amount_cents: string }>(
      `select account, amount_cents from public.ledger_entries
        where request_id = $1 and memo = $2 order by account`,
      [requestId, `refund:${reason}`],
    );
    expect(ledger.rows.map((l) => [l.account, Number(l.amount_cents)])).toEqual([
      ["guest_escrow", 100],
      ["psp_clearing", -100],
    ]);
  });

  it("alerts the admin exactly once when the retry budget is exhausted (B4.4)", async () => {
    const { requestId, paymentId } = await capturedPayment();
    const reason = `worker_it_dead_${RUN}`;
    const inserted = await db.query<{ id: string }>(
      `insert into public.refunds
         (payment_id, request_id, amount_cents, reason, status, idempotency_key, attempts, last_error)
       values ($1, $2, 100, $3, 'failed', $4, 5, 'simulated psp outage')
       returning id`,
      [paymentId, requestId, reason, `refund:${requestId}:${reason}`],
    );
    const refundId = inserted.rows[0]?.id;
    if (!refundId) throw new Error("refund insert returned no row");

    const first = await processRefundRetry({ refundId }, Date.now(), { maxAttempts: 5 });
    expect(first.status).toBe("exhausted");
    const second = await processRefundRetry({ refundId }, Date.now(), { maxAttempts: 5 });
    expect(second.status).toBe("exhausted");

    const alerts = await db.query(
      `select 1 from public.audit_log
        where action = 'refund.failed.alert' and entity = 'refund' and entity_id = $1`,
      [refundId],
    );
    expect(alerts.rowCount).toBe(1);

    // No money moved: the refund stays failed, no ledger group was posted.
    const refund = await db.query<{ status: string }>(
      `select status from public.refunds where id = $1`,
      [refundId],
    );
    expect(refund.rows[0]?.status).toBe("failed");
    const ledger = await db.query(
      `select 1 from public.ledger_entries where request_id = $1 and memo = $2`,
      [requestId, `refund:${reason}`],
    );
    expect(ledger.rowCount).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Genre weekly                                                        */
/* ------------------------------------------------------------------ */

describe("genre weekly", () => {
  it("recommends −0.05 on low conversion and applies only on auto_apply (B5.4)", async () => {
    const now = Date.now();
    const venueId = randomUUID();
    const sessionId = randomUUID();
    const genre = `worker-it-genre-${RUN}`;
    await db.query(
      `insert into public.venues (id, name, slug) values ($1, $2, $3)`,
      [venueId, `Worker IT Venue ${RUN}`, `worker-it-${RUN}`],
    );
    await db.query(
      `insert into public.sessions (id, venue_id, name, status, starts_at, ends_at)
       values ($1, $2, 'Worker IT genre night', 'ended',
               to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0))`,
      [
        sessionId,
        venueId,
        now - 7 * 86400 * 1000,
        now - 7 * 86400 * 1000 + 4 * 3600 * 1000,
      ],
    );
    const guest = await createGuest();
    // 30 quotes shown, zero paid → conversion 0 < 15% → recommend −0.05.
    await db.query(
      `insert into public.quotes
         (session_id, guest_id, library_track_id, track_title, track_artist, track_genre,
          fit_score, fit_label, demand_rho, tiers, breakdown, expires_at, converted)
       select $1, $2, $3, 'Worker IT Track ' || g, 'Worker IT Artist', $4,
              0.8, 'fits', 0.3, '[]'::jsonb, '{}'::jsonb,
              to_timestamp($5 / 1000.0), false
         from generate_series(1, 30) g`,
      [sessionId, guest, takeTrack(), genre, now - 86400 * 1000],
    );

    // The quotes were inserted with created_at = now() (DB clock), which is
    // AFTER the captured `now` — run the job with a window end past them.
    const jobNow = now + 60_000;
    const first = await runGenreWeekly(jobNow, { minQuotes: 30, windowDays: 30 });
    expect(first.venues).toBeGreaterThanOrEqual(1);
    expect(first.recommendationsWritten).toBeGreaterThanOrEqual(1);

    const row1 = await db.query<{
      multiplier: string;
      recommended: string | null;
      auto_apply: boolean;
      metrics: { reason?: string; conversion?: number; total?: number };
    }>(
      `select multiplier, recommended, auto_apply, metrics
         from public.genre_multipliers where venue_id = $1 and genre = $2`,
      [venueId, genre],
    );
    const written = row1.rows[0];
    expect(written).toBeDefined();
    expect(Number(written?.multiplier)).toBe(1); // not applied: auto_apply off
    expect(Number(written?.recommended)).toBe(0.95);
    expect(written?.metrics.reason).toBe("low_conversion");
    expect(written?.metrics.conversion).toBe(0);
    expect(written?.metrics.total).toBe(30);

    // Venue turns auto-apply on → next run moves the live multiplier.
    await db.query(
      `update public.genre_multipliers set auto_apply = true where venue_id = $1 and genre = $2`,
      [venueId, genre],
    );
    const second = await runGenreWeekly(jobNow + 1000, { minQuotes: 30, windowDays: 30 });
    expect(second.autoApplied).toBeGreaterThanOrEqual(1);

    const row2 = await db.query<{ multiplier: string; recommended: string | null }>(
      `select multiplier, recommended from public.genre_multipliers
        where venue_id = $1 and genre = $2`,
      [venueId, genre],
    );
    expect(Number(row2.rows[0]?.multiplier)).toBe(0.95);

    const audit = await db.query(
      `select 1 from public.audit_log
        where action = 'pricing.genre_weekly' and entity = 'venue' and entity_id = $1`,
      [venueId],
    );
    expect(audit.rowCount).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/* Reconciliation                                                      */
/* ------------------------------------------------------------------ */

describe("daily reconciliation", () => {
  it("writes the report row and the money invariants hold (B4.3)", async () => {
    const report = await runDailyReconciliation(Date.now());

    expect(report.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Everything this suite did went through the services, so the three
    // table↔ledger pairs must match exactly.
    expect(report.mismatches, JSON.stringify(report.mismatches)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.totals.paymentsCapturedCents).toBe(report.totals.ledgerCapturedCents);

    const audit = await db.query<{ payload: { ok: boolean } }>(
      `select payload from public.audit_log
        where action = 'reconciliation.daily' and entity = 'reconciliation' and entity_id = $1
        order by created_at desc limit 1`,
      [report.day],
    );
    expect(audit.rows[0]?.payload.ok).toBe(true);
  });
});
