/**
 * Integration tests for the server orchestration layer (BRIEF B4, B12).
 *
 * They run against the LOCAL Supabase Postgres (supabase start) and are
 * only included when SUPABASE_TEST=1 (see vitest.config.ts):
 *
 *   SUPABASE_TEST=1 pnpm exec vitest run tests/integration
 *
 * Covered end to end, on the real schema with the seeded session:
 *  - quote → request → pay (mock webhook) → accept → playing → played,
 *    with the exact double-entry ledger (deriveBalances);
 *  - duplicate webhook deliveries are no-ops (captures exactly once);
 *  - refunds are exactly-once per (request, reason);
 *  - SLA demotion refunds exactly the difference to the quoted QUEUE price;
 *  - two concurrent NEXT requests → exactly one wins (lock + unique index);
 *  - expired quotes and guest limits are rejected;
 *  - endSession refunds what never played and creates pending payouts.
 *
 * NOTE on cleanup: ledger_entries is immutable by trigger and requests
 * reference it, so money rows cannot be deleted. Each run uses unique
 * guests/tracks/phones; `pnpm db:reset` restores a pristine database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
const { deriveBalances, sessionStatement } = await import("@/lib/ledger/balances");
const { computeSplit } = await import("@/lib/ledger/split");
const { ACCOUNTS } = await import("@/lib/ledger/accounts");
import type { MockPaymentProvider } from "@/lib/payments/mock";
import type { LedgerEntryRow } from "@/lib/ledger/balances";
import type { Tier } from "@/lib/domain/types";

/* ------------------------------------------------------------------ */
/* Fixtures (supabase/seed.sql)                                        */
/* ------------------------------------------------------------------ */

const SESSION_ID = "dddddddd-0000-4000-8000-000000000001";
const VENUE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const ZONE_ID = "bbbbbbbb-0000-4000-8000-000000000001";

const RUN = randomUUID().slice(0, 8);
let trackIds: string[] = [];
let nextTrack = 0;
let phoneCounter = 10_000_000;

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
    [id, `it-${RUN}-${id.slice(0, 8)}@betbeat.test`],
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

/** Creates an MB WAY request and confirms it through the webhook path. */
async function createPaidRequest(
  guestId: string,
  tier: Tier,
  now: number,
): Promise<{ requestId: string; amountCents: number; providerRef: string; prices: Record<Tier, number> }> {
  const quote = await makeQuote(guestId, takeTrack(), now);
  const amountCents = quote.prices[tier];
  const created = await domainService.createRequestAndStartPayment(
    {
      quoteId: quote.quoteId,
      guestId,
      tier,
      amountCents,
      method: "mbway",
      phone: takePhone(),
    },
    now,
  );
  if (!created.ok) throw new Error(`createRequest failed: ${created.error}`);
  const providerRef = created.payment.providerRef;
  if (!providerRef) throw new Error("mbway payment has no providerRef");

  const provider = (await getPaymentProvider()) as MockPaymentProvider;
  const event = provider.simulateMbwayConfirmation(providerRef);
  const recorded = await paymentsService.recordWebhook(event, now + 1000);
  if (!recorded.handled || recorded.duplicate) {
    throw new Error(`webhook not applied: ${recorded.action}`);
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
    original_tier: Tier | null;
    close_reason: string | null;
    deadline_at: Date | null;
    decision_deadline_at: Date | null;
  }>(`select * from public.requests where id = $1`, [requestId]);
  const row = res.rows[0];
  if (!row) throw new Error(`request ${requestId} not found`);
  return row;
}

async function ledgerFor(requestId: string): Promise<LedgerEntryRow[]> {
  const res = await db.query<LedgerEntryRow & { memo: string | null }>(
    `select account, amount_cents, memo from public.ledger_entries where request_id = $1`,
    [requestId],
  );
  return res.rows;
}

/* ------------------------------------------------------------------ */
/* Suite                                                               */
/* ------------------------------------------------------------------ */

const T0 = Date.now();

beforeAll(async () => {
  // Make the seeded session usable regardless of what earlier runs did:
  // live, open, ending far in the future, no lingering active requests.
  await db.query(
    `update public.sessions
        set status = 'live', ended_at = null, requests_open = true,
            starts_at = now() - interval '1 hour', ends_at = now() + interval '6 hours'
      where id = $1`,
    [SESSION_ID],
  );
  await db.query(
    `update public.requests
        set status = 'expired', close_reason = 'payment_timeout', closed_at = now()
      where session_id = $1
        and status in ('pending_payment', 'paid', 'accepted', 'playing')`,
    [SESSION_ID],
  );
  // Fresh, uniquely named library tracks so the no-repeat and
  // already-requested checks never collide across runs.
  const inserted = await db.query<{ id: string }>(
    `insert into public.library_tracks (venue_id, title, artist, genre, bpm, camelot_key, duration_sec)
     select $1, 'IT ${RUN} Track ' || n, 'IT ${RUN} Artist', 'house', 122 + (n % 4), '9A', 180
       from generate_series(1, 14) as n
     returning id`,
    [VENUE_ID],
  );
  trackIds = inserted.rows.map((r) => r.id);
}, 60_000);

afterAll(async () => {
  // The test tracks live in the dev club's library: hide them from guests afterwards.
  await db.query(`update public.library_tracks set blocked = true where venue_id = $1 and title like $2`, [VENUE_ID, `IT ${RUN} %`]);
  // Leave the seeded session usable for dev after the run.
  await db.query(
    `update public.sessions
        set status = 'live', ended_at = null, requests_open = true,
            ends_at = now() + interval '5 hours'
      where id = $1`,
    [SESSION_ID],
  );
  await db.closePool();
}, 60_000);

describe("quote → pay → accept → playing → played (full money path)", () => {
  let guestId: string;
  let requestId: string;
  let amountCents: number;
  let providerRef: string;

  it("walks the lifecycle and writes the exact double-entry ledger", async () => {
    const now = T0;
    guestId = await createGuest();
    const paid = await createPaidRequest(guestId, "QUEUE", now);
    requestId = paid.requestId;
    amountCents = paid.amountCents;
    providerRef = paid.providerRef;

    const row = await requestRowOf(requestId);
    expect(row.status).toBe("paid");
    expect(row.decision_deadline_at).not.toBeNull();
    expect(row.deadline_at).toBeNull(); // QUEUE promises the set, not a clock

    const accepted = await domainService.djAccept(requestId, "staff:test-dj", now + 2000);
    expect(accepted.ok).toBe(true);

    const playing = await domainService.djMarkPlaying(requestId, "staff:test-dj", now + 3000);
    expect(playing.ok && playing.status).toBe("playing");
    if (playing.ok) {
      // Automatic `played` after the track duration (180 s fixture).
      expect(playing.jobs.some((j) => j.kind === "track_finished")).toBe(true);
    }
    const st = await db.query(
      `select 1 from public.session_tracks where request_id = $1`,
      [requestId],
    );
    expect(st.rowCount).toBe(1);

    const played = await domainService.markTrackFinished(requestId, "system:worker", now + 4000);
    expect(played.ok && played.status).toBe("played");

    // Ledger: capture (at MB WAY confirmation) + recognition (at played).
    const balances = deriveBalances(await ledgerFor(requestId));
    const split = computeSplit(amountCents, 2000, 5000);
    expect(balances[ACCOUNTS.pspClearing]).toBe(amountCents);
    expect(balances[ACCOUNTS.guestEscrow]).toBe(0);
    expect(balances[ACCOUNTS.betbeatRevenue]).toBe(-split.betbeatFeeCents);
    expect(balances[ACCOUNTS.venuePayable]).toBe(-split.venueCents);
    expect(balances[ACCOUNTS.djPayable]).toBe(-split.djCents);

    // Invoice issued post-commit (B4.5, mock provider).
    const invoices = await db.query<{ amount_cents: number; status: string }>(
      `select amount_cents, status from public.invoices where request_id = $1`,
      [requestId],
    );
    expect(invoices.rows[0]?.amount_cents).toBe(amountCents);

    // Every transition left a request_event (B4.2).
    const events = await db.query<{ to_status: string }>(
      `select to_status from public.request_events where request_id = $1 order by id`,
      [requestId],
    );
    expect(events.rows.map((r) => r.to_status)).toEqual([
      "pending_payment",
      "paid",
      "accepted",
      "playing",
      "played",
    ]);
  }, 60_000);

  it("ignores duplicate payment.confirmed webhooks (captures exactly once)", async () => {
    const provider = (await getPaymentProvider()) as MockPaymentProvider;
    // Same deterministic event id a real PSP retry would carry.
    const duplicate = {
      id: `evt_${providerRef}_payment.confirmed`,
      providerRef,
      type: "payment.confirmed" as const,
      amountCents,
      raw: { mock: true },
    };
    const res1 = await paymentsService.recordWebhook(duplicate, T0 + 5000);
    const res2 = await paymentsService.recordWebhook(duplicate, T0 + 6000);
    expect(res1.duplicate).toBe(true); // already captured in the first test
    expect(res2.duplicate).toBe(true);
    void provider;

    const captures = await db.query<{ n: string }>(
      `select count(*)::bigint as n from public.ledger_entries
        where request_id = $1 and account = $2 and amount_cents > 0`,
      [requestId, ACCOUNTS.pspClearing],
    );
    expect(Number(captures.rows[0]?.n)).toBe(1);

    const payment = await db.query<{ status: string; captured_cents: number }>(
      `select status, captured_cents from public.payments where request_id = $1`,
      [requestId],
    );
    expect(payment.rows[0]).toEqual({ status: "captured", captured_cents: amountCents });

    // The request is terminal: no event sneaked in a second transition.
    const row = await requestRowOf(requestId);
    expect(row.status).toBe("played");
  }, 60_000);
});

describe("refunds are exactly-once (B4.4)", () => {
  it("refunds a rejected request once, and never twice", async () => {
    const now = T0 + 60_000;
    const guestId = await createGuest();
    const { requestId, amountCents } = await createPaidRequest(guestId, "QUEUE", now);

    const rejected = await domainService.djReject(
      requestId,
      "off_style",
      "staff:test-dj",
      now + 2000,
    );
    expect(rejected.ok && rejected.status).toBe("refunded");

    // A second reject on a terminal request is an invalid transition.
    const again = await domainService.djReject(requestId, "off_style", "staff:test-dj", now + 3000);
    expect(again.ok).toBe(false);

    // Direct ensureRefund with the same (request, reason) is a no-op.
    const meta = { requestId, sessionId: SESSION_ID, venueId: VENUE_ID };
    const dup = await db.withTransaction((client) =>
      paymentsService.ensureRefund(client, meta, amountCents, "rejected_by_dj", now + 4000),
    );
    expect(dup.status).toBe("duplicate");

    const refunds = await db.query<{ amount_cents: number; status: string }>(
      `select amount_cents, status from public.refunds where request_id = $1`,
      [requestId],
    );
    expect(refunds.rows).toEqual([{ amount_cents: amountCents, status: "succeeded" }]);

    // Ledger nets to zero for this request: capture + full refund.
    const balances = deriveBalances(await ledgerFor(requestId));
    expect(balances[ACCOUNTS.pspClearing]).toBe(0);
    expect(balances[ACCOUNTS.guestEscrow]).toBe(0);

    const row = await requestRowOf(requestId);
    expect(row.close_reason).toBe("rejected_by_dj");
    expect(row.refunded_cents).toBe(amountCents);
  }, 60_000);

  it("SLA demotion refunds exactly the difference to the quoted QUEUE price", async () => {
    const now = T0 + 120_000;
    const guestId = await createGuest();
    const { requestId, amountCents, prices } = await createPaidRequest(guestId, "SOON", now);
    const diff = amountCents - prices.QUEUE;
    expect(diff).toBeGreaterThan(0); // tier ordering guarantees ≥ 5 €

    const missed = await domainService.applySlaMissed(requestId, now + 2000);
    expect(missed.ok && missed.status).toBe("paid"); // stays in the queue (B4.2)

    const row = await requestRowOf(requestId);
    expect(row.tier).toBe("QUEUE");
    expect(row.sla_missed).toBe(true);
    expect(row.original_tier).toBe("SOON");
    expect(row.amount_cents).toBe(prices.QUEUE);
    expect(row.refunded_cents).toBe(diff);
    expect(row.deadline_at).toBeNull();

    const refunds = await db.query<{ amount_cents: number; reason: string; status: string }>(
      `select amount_cents, reason, status from public.refunds where request_id = $1`,
      [requestId],
    );
    expect(refunds.rows).toEqual([
      { amount_cents: diff, reason: "sla_missed", status: "succeeded" },
    ]);

    // Running the worker job twice must not refund twice.
    const again = await domainService.applySlaMissed(requestId, now + 3000);
    // The machine allows sla_missed only for SOON/NEXT — now it is QUEUE.
    expect(again.ok).toBe(false);
    const refundCount = await db.query<{ n: string }>(
      `select count(*)::bigint as n from public.refunds where request_id = $1`,
      [requestId],
    );
    expect(Number(refundCount.rows[0]?.n)).toBe(1);
  }, 60_000);
});

describe("validation and limits", () => {
  it("rejects an expired quote (120 s TTL)", async () => {
    const now = T0 + 180_000;
    const guestId = await createGuest();
    const quote = await makeQuote(guestId, takeTrack(), now);
    const created = await domainService.createRequestAndStartPayment(
      {
        quoteId: quote.quoteId,
        guestId,
        tier: "QUEUE",
        amountCents: quote.prices.QUEUE,
        method: "mbway",
        phone: takePhone(),
      },
      now + quotesService.QUOTE_TTL_MS + 1000,
    );
    expect(created).toEqual({ ok: false, error: "quote_expired" });
  }, 60_000);

  it("rejects paying below the quoted price", async () => {
    const now = T0 + 185_000;
    const guestId = await createGuest();
    const quote = await makeQuote(guestId, takeTrack(), now);
    const created = await domainService.createRequestAndStartPayment(
      {
        quoteId: quote.quoteId,
        guestId,
        tier: "QUEUE",
        amountCents: quote.prices.QUEUE - 100,
        method: "mbway",
        phone: takePhone(),
      },
      now,
    );
    expect(created).toEqual({ ok: false, error: "amount_below_price" });
  }, 60_000);

  it("enforces the per-guest active request limit (3 by default)", async () => {
    const now = T0 + 190_000;
    const guestId = await createGuest();
    const phone = takePhone();
    for (let i = 0; i < 3; i += 1) {
      const quote = await makeQuote(guestId, takeTrack(), now + i * 1000);
      const created = await domainService.createRequestAndStartPayment(
        {
          quoteId: quote.quoteId,
          guestId,
          tier: "QUEUE",
          amountCents: quote.prices.QUEUE,
          method: "mbway",
          phone,
        },
        now + i * 1000,
      );
      expect(created.ok).toBe(true);
    }
    const quote4 = await makeQuote(guestId, takeTrack(), now + 10_000);
    const fourth = await domainService.createRequestAndStartPayment(
      {
        quoteId: quote4.quoteId,
        guestId,
        tier: "QUEUE",
        amountCents: quote4.prices.QUEUE,
        method: "mbway",
        phone,
      },
      now + 10_000,
    );
    expect(fourth).toEqual({ ok: false, error: "guest_limit" });
  }, 60_000);

  it("blocks a second active request for the same track", async () => {
    const now = T0 + 200_000;
    const guestA = await createGuest();
    const guestB = await createGuest();
    const trackId = takeTrack();

    const quoteA = await makeQuote(guestA, trackId, now);
    const first = await domainService.createRequestAndStartPayment(
      {
        quoteId: quoteA.quoteId,
        guestId: guestA,
        tier: "QUEUE",
        amountCents: quoteA.prices.QUEUE,
        method: "mbway",
        phone: takePhone(),
      },
      now,
    );
    expect(first.ok).toBe(true);

    const quoteB = await makeQuote(guestB, trackId, now + 1000);
    const second = await domainService.createRequestAndStartPayment(
      {
        quoteId: quoteB.quoteId,
        guestId: guestB,
        tier: "QUEUE",
        amountCents: quoteB.prices.QUEUE,
        method: "mbway",
        phone: takePhone(),
      },
      now + 1000,
    );
    expect(second).toEqual({ ok: false, error: "already_requested" });
  }, 60_000);
});

describe("NEXT exclusivity under concurrency (B4.3)", () => {
  it("exactly one of two simultaneous NEXT requests wins", async () => {
    const now = T0 + 240_000;
    const [guestA, guestB] = await Promise.all([createGuest(), createGuest()]);
    const quoteA = await makeQuote(guestA as string, takeTrack(), now);
    const quoteB = await makeQuote(guestB as string, takeTrack(), now + 100);
    expect(quoteA.available.NEXT).toBe(true);
    expect(quoteB.available.NEXT).toBe(true);

    const [resA, resB] = await Promise.all([
      domainService.createRequestAndStartPayment(
        {
          quoteId: quoteA.quoteId,
          guestId: guestA as string,
          tier: "NEXT",
          amountCents: quoteA.prices.NEXT,
          method: "mbway",
          phone: takePhone(),
        },
        now + 200,
      ),
      domainService.createRequestAndStartPayment(
        {
          quoteId: quoteB.quoteId,
          guestId: guestB as string,
          tier: "NEXT",
          amountCents: quoteB.prices.NEXT,
          method: "mbway",
          phone: takePhone(),
        },
        now + 200,
      ),
    ]);

    const outcomes = [resA, resB];
    const winners = outcomes.filter((o) => o.ok);
    const losers = outcomes.filter((o) => !o.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toEqual({ ok: false, error: "tier_unavailable" });

    const active = await db.query<{ n: string }>(
      `select count(*)::bigint as n from public.requests
        where session_id = $1 and tier = 'NEXT'
          and status in ('pending_payment', 'paid', 'accepted', 'playing')`,
      [SESSION_ID],
    );
    expect(Number(active.rows[0]?.n)).toBe(1);
  }, 60_000);
});

describe("endSession (B4.2 auto-close + B4.5 payouts)", () => {
  it("refunds everything active, closes the session and creates payouts", async () => {
    const now = T0 + 300_000;
    const guestId = await createGuest();
    const { requestId, amountCents } = await createPaidRequest(guestId, "QUEUE", now);

    const ended = await domainService.endSession(SESSION_ID, "staff:test-dj", now + 5000);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.alreadyEnded).toBe(false);
    expect(ended.closedRequests).toBeGreaterThanOrEqual(1);

    const row = await requestRowOf(requestId);
    expect(row.status).toBe("refunded");
    expect(row.close_reason).toBe("session_ended");
    expect(row.refunded_cents).toBe(amountCents);

    const session = await db.query<{ status: string; requests_open: boolean }>(
      `select status, requests_open from public.sessions where id = $1`,
      [SESSION_ID],
    );
    expect(session.rows[0]).toEqual({ status: "ended", requests_open: false });

    // The played request from the first suite recognized revenue, so the
    // statement must show venue/DJ earnings and pending payout rows.
    const entries = await db.query<LedgerEntryRow>(
      `select account, amount_cents from public.ledger_entries where session_id = $1`,
      [SESSION_ID],
    );
    const statement = sessionStatement(entries.rows);
    expect(statement.venueNet).toBeGreaterThan(0);
    expect(statement.djNet).toBeGreaterThan(0);
    expect(ended.statement).toEqual(statement);
    expect(ended.payoutIds.length).toBeGreaterThanOrEqual(2);

    const payouts = await db.query<{ recipient_type: string; status: string }>(
      `select recipient_type, status from public.payouts where session_id = $1 order by recipient_type`,
      [SESSION_ID],
    );
    expect(payouts.rows.length).toBeGreaterThanOrEqual(2);

    // Ending twice is safe.
    const again = await domainService.endSession(SESSION_ID, "staff:test-dj", now + 9000);
    expect(again.ok && again.alreadyEnded).toBe(true);
  }, 120_000);
});
