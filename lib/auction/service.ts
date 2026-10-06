import "server-only";

/**
 * Slot auction engine (2026-10-05). The rules are pure (lib/auction/*);
 * this module applies them to the database, atomically, with the SERVER
 * clock (`now` injected by the route or the worker, never read here).
 *
 * Money model (product owner): every bid is CHARGED. A guest's money lives
 * in a per-venue wallet (`wallet_entries`, a sub-ledger of guest_escrow):
 *   top-up captured       → wallet +A            (ledger: capture)
 *   bid action            → wallet −add, contribution +add
 *   outbid / not played   → contribution back to the wallet
 *   track played          → contribution spent  (ledger: recognition)
 *   end of night / asked  → wallet refunded to the payment method
 * Re-bidding therefore only charges what the wallet does not cover.
 *
 * Concurrency: a slot is serialized by `auction_slots … FOR UPDATE`
 * (nothing takes a weaker lock on a slot row before it); a wallet by a
 * per-(guest, venue) advisory lock, so two bids can never spend the same
 * euro. One leading bid per slot is also backed by a unique index.
 */

import type { PoolClient } from "pg";
import { getPool, withTransaction } from "@/lib/db";
import { parseSessionConfig } from "@/lib/domain/config";
import { postLedgerGroup } from "@/lib/ledger/post";
import { captureGroup, recognitionGroup, refundGroup } from "@/lib/ledger/groups";
import { computeSplit } from "@/lib/ledger/split";
import { getPaymentProvider } from "@/lib/payments";
import type { PaymentMethod } from "@/lib/domain/types";
import { guestChannel, publicChannel, staffChannel } from "@/lib/realtime/events";
import { publishBroadcasts, type OutgoingBroadcast } from "@/lib/realtime/publish";
import { closeOutcome, decideBid, minNextBid } from "./bidding";
import { parseAuctionConfig, type AuctionConfig } from "./config";
import { displayLabel, recognitionFor, type DisplayChoice } from "./recognition";
import { planNight } from "./schedule";

type Db = Pick<PoolClient, "query">;

/* ------------------------------------------------------------------ */
/* Rows & night context                                                */
/* ------------------------------------------------------------------ */

export interface SlotRow {
  id: string;
  session_id: string;
  venue_id: string;
  kind: "regular" | "first_peak" | "last_song";
  phase: string;
  opens_at: Date;
  scheduled_close_at: Date;
  closes_at: Date;
  min_price_cents: number;
  extensions: number;
  status: "scheduled" | "open" | "paused" | "cancelled" | "closed";
  outcome: "won" | "no_winner" | null;
  winning_bid_id: string | null;
  play_status: "locked" | "accepted" | "playing" | "played" | "refunded" | null;
  refund_reason: string | null;
  recognition: string | null;
  announce: boolean;
  closed_at: Date | null;
  accepted_at: Date | null;
  playing_at: Date | null;
  played_at: Date | null;
  announced_at: Date | null;
}

export interface BidRow {
  id: string;
  slot_id: string;
  session_id: string;
  venue_id: string;
  owner_guest_id: string;
  library_track_id: string | null;
  track_title: string;
  track_artist: string;
  track_genre: string | null;
  track_bpm: string | null;
  track_key: string | null;
  track_duration_sec: number | null;
  total_cents: number;
  display_mode: "anonymous" | "handle" | "table";
  display_label: string | null;
  status: "leading" | "outbid" | "won" | "lost";
}

export interface Night {
  sessionId: string;
  venueId: string;
  status: string;
  startsAtMs: number;
  endsAtMs: number;
  config: AuctionConfig;
  betbeatFeeBps: number;
  venueShareBps: number;
}

/** A club config that fails to parse must never stop a night: defaults. */
function safeAuctionConfig(input: unknown): AuctionConfig {
  try {
    return parseAuctionConfig(input);
  } catch {
    console.error("[auction] invalid club auction config, using defaults");
    return parseAuctionConfig({});
  }
}

export async function loadNight(db: Db, sessionId: string): Promise<Night | null> {
  const res = await db.query<{
    id: string;
    venue_id: string;
    status: string;
    starts_at: Date;
    ends_at: Date;
    auction_config: unknown;
    venue_auction: unknown;
    session_config: unknown;
    venue_share_bps: number;
  }>(
    `select s.id, s.venue_id, s.status, s.starts_at, s.ends_at, s.auction_config,
            v.settings -> 'auction' as venue_auction,
            coalesce(ss.config, '{}'::jsonb) as session_config,
            coalesce(ss.venue_share_bps, 5000) as venue_share_bps
       from public.sessions s
       join public.venues v on v.id = s.venue_id
       left join public.session_settings ss on ss.session_id = s.id
      where s.id = $1`,
    [sessionId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    sessionId: row.id,
    venueId: row.venue_id,
    status: row.status,
    startsAtMs: row.starts_at.getTime(),
    endsAtMs: row.ends_at.getTime(),
    config: safeAuctionConfig(row.auction_config ?? row.venue_auction ?? {}),
    betbeatFeeBps: parseSessionConfig(row.session_config).betbeatFeeBps,
    venueShareBps: row.venue_share_bps,
  };
}

/* ------------------------------------------------------------------ */
/* Publishing                                                          */
/* ------------------------------------------------------------------ */

function slotChanged(sessionId: string, slotId: string): OutgoingBroadcast[] {
  return [
    { topic: publicChannel(sessionId), event: "auction.updated", payload: { slotId }, private: false },
    { topic: staffChannel(sessionId), event: "auction.updated", payload: { slotId }, private: true },
  ];
}

function toGuests(
  guestIds: Iterable<string>,
  event: "auction.outbid" | "auction.won" | "wallet.changed",
  payload: unknown,
): OutgoingBroadcast[] {
  return [...new Set(guestIds)].map((id) => ({ topic: guestChannel(id), event, payload, private: true }));
}

/** Commit first, then broadcast: a message never announces a rollback. */
async function runAndPublish<T>(
  fn: (client: PoolClient) => Promise<{ value: T; publishes: OutgoingBroadcast[] }>,
  now: number,
): Promise<T> {
  const { value, publishes } = await withTransaction(fn);
  await publishBroadcasts(publishes, now);
  return value;
}

/* ------------------------------------------------------------------ */
/* Planning                                                            */
/* ------------------------------------------------------------------ */

/**
 * Plans the night once (idempotent): snapshots the club config onto the
 * session and inserts the future slots. Slots already over are skipped.
 */
export async function ensureNightPlan(sessionId: string, now: number): Promise<number> {
  return withTransaction(async (client) => {
    await client.query(`select pg_advisory_xact_lock(hashtextextended('betbeat:auction-plan:' || $1, 0))`, [
      sessionId,
    ]);
    // Planned once: the config snapshot marks it (even a night with no slot).
    const planned = await client.query(`select 1 from public.sessions where id = $1 and auction_config is not null`, [
      sessionId,
    ]);
    if ((planned.rowCount ?? 0) > 0) return 0;
    const night = await loadNight(client, sessionId);
    if (!night) return 0;
    await client.query(`update public.sessions set auction_config = $2 where id = $1`, [
      sessionId,
      JSON.stringify(night.config),
    ]);
    const plan = planNight(night.startsAtMs, night.endsAtMs, night.config);
    let created = 0;
    for (const slot of plan.slots) {
      if (slot.closesAtMs <= now) continue;
      const res = await client.query(
        `insert into public.auction_slots
           (session_id, venue_id, kind, phase, opens_at, scheduled_close_at, closes_at, min_price_cents)
         values ($1, $2, $3, $4, to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0),
                 to_timestamp($6 / 1000.0), $7)
         on conflict (session_id, scheduled_close_at) do nothing`,
        [sessionId, night.venueId, slot.kind, slot.phase, slot.opensAtMs, slot.closesAtMs, slot.minPriceCents],
      );
      created += res.rowCount ?? 0;
    }
    return created;
  });
}

/** An extra regular slot opening now (DJ "abrir leilão" or a rejected winner). */
async function insertSlotNowInTx(
  client: PoolClient,
  night: Night,
  phase: string,
  minPriceCents: number,
  now: number,
): Promise<string> {
  const closesAtMs = now + night.config.auctionDurationSec * 1000;
  const res = await client.query<{ id: string }>(
    `insert into public.auction_slots
       (session_id, venue_id, kind, phase, opens_at, scheduled_close_at, closes_at, min_price_cents, status)
     values ($1, $2, 'regular', $3, to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0),
             to_timestamp($5 / 1000.0), $6, 'open')
     returning id`,
    [night.sessionId, night.venueId, phase, now, closesAtMs, minPriceCents],
  );
  return (res.rows[0] as { id: string }).id;
}

/* ------------------------------------------------------------------ */
/* Wallet                                                              */
/* ------------------------------------------------------------------ */

async function lockWallet(client: PoolClient, guestId: string, venueId: string): Promise<void> {
  await client.query(`select pg_advisory_xact_lock(hashtextextended('betbeat:wallet:' || $1 || ':' || $2, 0))`, [
    guestId,
    venueId,
  ]);
}

export async function walletBalance(db: Db, guestId: string, venueId: string): Promise<number> {
  const res = await db.query<{ n: string }>(
    `select coalesce(sum(amount_cents), 0)::bigint as n from public.wallet_entries where guest_id = $1 and venue_id = $2`,
    [guestId, venueId],
  );
  return Number(res.rows[0]?.n ?? 0);
}

/** Every unreturned, unspent euro behind a bid goes back to its contributors. */
async function returnContributionsInTx(
  client: PoolClient,
  bid: Pick<BidRow, "id" | "venue_id" | "session_id">,
  now: number,
): Promise<string[]> {
  const res = await client.query<{ id: string; guest_id: string; amount_cents: number }>(
    `update public.auction_contributions set returned_at = to_timestamp($2 / 1000.0)
      where bid_id = $1 and returned_at is null and spent_at is null
      returning id, guest_id, amount_cents`,
    [bid.id, now],
  );
  for (const c of res.rows) {
    await client.query(
      `insert into public.wallet_entries (venue_id, guest_id, session_id, amount_cents, reason, contribution_id)
       values ($1, $2, $3, $4, 'bid_returned', $5)`,
      [bid.venue_id, c.guest_id, bid.session_id, c.amount_cents, c.id],
    );
  }
  return res.rows.map((r) => r.guest_id);
}

/**
 * Refunds a guest's whole wallet at a venue to the payment methods it came
 * from (newest top-up first). Exactly-once per allocation key; a PSP
 * failure leaves the money in the wallet and the refund row `failed`.
 */
export async function refundWalletInTx(
  client: PoolClient,
  guestId: string,
  venueId: string,
  sessionId: string | null,
  now: number,
): Promise<number> {
  await lockWallet(client, guestId, venueId);
  let remaining = await walletBalance(client, guestId, venueId);
  if (remaining <= 0) return 0;
  const payments = await client.query<{ id: string; provider_ref: string; session_id: string | null; refundable: string }>(
    `select p.id, p.provider_ref, p.session_id,
            (p.captured_cents - coalesce((select sum(r.amount_cents) from public.refunds r
                                           where r.payment_id = p.id
                                             and r.status in ('pending', 'processing', 'succeeded')), 0))::bigint as refundable
       from public.payments p
      where p.guest_id = $1 and p.venue_id = $2 and p.intent_id is not null
        and p.captured_cents > 0 and p.provider_ref is not null
      order by p.created_at desc`,
    [guestId, venueId],
  );
  const provider = await getPaymentProvider();
  let refunded = 0;
  for (const p of payments.rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(p.refundable));
    if (take <= 0) continue;
    const key = `wallet:${guestId}:${now}:${p.id}`;
    const inserted = await client.query<{ id: string }>(
      `insert into public.refunds (payment_id, request_id, guest_id, amount_cents, reason, status, idempotency_key)
       values ($1, null, $2, $3, 'wallet', 'processing', $4)
       on conflict (idempotency_key) do nothing returning id`,
      [p.id, guestId, take, key],
    );
    const refundId = inserted.rows[0]?.id;
    if (!refundId) continue;
    try {
      const result = await provider.refund(p.provider_ref, take, key);
      await client.query(
        `update public.refunds set status = 'succeeded', provider_ref = $2, attempts = attempts + 1 where id = $1`,
        [refundId, result.providerRef],
      );
      await postLedgerGroup(client, refundGroup(take, { venueId, ...(p.session_id ? { sessionId: p.session_id } : {}), memo: "refund:wallet" }));
      await client.query(
        `insert into public.wallet_entries (venue_id, guest_id, session_id, amount_cents, reason, payment_id, refund_id)
         values ($1, $2, $3, $4, 'refund', $5, $6)`,
        [venueId, guestId, sessionId, -take, p.id, refundId],
      );
      refunded += take;
      remaining -= take;
    } catch (error) {
      await client.query(
        `update public.refunds set status = 'failed', attempts = attempts + 1, last_error = $2 where id = $1`,
        [refundId, error instanceof Error ? error.message.slice(0, 500) : "unknown"],
      );
    }
  }
  return refunded;
}

/** Guest asked for their balance back ("Devolver saldo"). */
export async function refundWallet(guestId: string, venueId: string, sessionId: string | null, now: number): Promise<number> {
  return runAndPublish(async (client) => {
    const value = await refundWalletInTx(client, guestId, venueId, sessionId, now);
    return { value, publishes: value > 0 ? toGuests([guestId], "wallet.changed", {}) : [] };
  }, now);
}

/* ------------------------------------------------------------------ */
/* Bidding                                                             */
/* ------------------------------------------------------------------ */

export type BidTarget = { kind: "own"; libraryTrackId: string } | { kind: "back"; bidId: string };

export interface BidRequest {
  slotId: string;
  guestId: string;
  /** The bid's NEW total (never a delta — the server derives what to pay). */
  totalCents: number;
  target: BidTarget;
  display: DisplayChoice;
}

export type BidError =
  | "slot_not_found"
  | "not_open"
  | "closed"
  | "below_minimum"
  | "above_maximum"
  | "track_not_found"
  | "track_fixed"
  | "bid_not_found"
  | "insufficient_funds";

export type PlaceResult =
  | { ok: true; bidId: string; totalCents: number; closesAt: string; extended: boolean }
  | { ok: false; error: BidError; needCents?: number };

async function lockSlot(client: PoolClient, slotId: string): Promise<SlotRow | null> {
  const res = await client.query<SlotRow>(`select * from public.auction_slots where id = $1 for update`, [slotId]);
  return res.rows[0] ?? null;
}

async function leaderOf(db: Db, slotId: string): Promise<BidRow | null> {
  const res = await db.query<BidRow>(
    `select * from public.auction_bids where slot_id = $1 and status = 'leading' limit 1`,
    [slotId],
  );
  return res.rows[0] ?? null;
}

/**
 * The single bidding path (new bid, raise, back someone): validates with
 * lib/auction/bidding at server time, pays the difference from the wallet,
 * outbids the previous leader (money back to its contributors) and applies
 * the soft close. Fails with `insufficient_funds` + `needCents` when the
 * wallet does not cover it — the caller then charges a top-up.
 */
async function placeInTx(
  client: PoolClient,
  req: BidRequest,
  now: number,
): Promise<{ value: PlaceResult; publishes: OutgoingBroadcast[] }> {
  const fail = (error: BidError, needCents?: number) => ({
    value: { ok: false as const, error, ...(needCents !== undefined ? { needCents } : {}) },
    publishes: [],
  });

  const slot = await lockSlot(client, req.slotId);
  if (!slot) return fail("slot_not_found");
  if (slot.status === "scheduled" || slot.status === "paused") return fail("not_open");
  if (slot.status !== "open") return fail("closed");
  const night = await loadNight(client, slot.session_id);
  if (!night) return fail("slot_not_found");

  const leader = await leaderOf(client, slot.id);
  const decision = decideBid(
    {
      opensAtMs: slot.opens_at.getTime(),
      closesAtMs: slot.closes_at.getTime(),
      scheduledClosesAtMs: slot.scheduled_close_at.getTime(),
      topCents: leader?.total_cents ?? null,
      minPriceCents: slot.min_price_cents,
      totalCents: req.totalCents,
      now,
    },
    night.config,
  );
  if (!decision.ok) return fail(decision.reason === "not_open" ? "not_open" : decision.reason);

  // The bid this action strengthens.
  let bid: BidRow | null;
  const label = displayLabel(req.display);
  if (req.target.kind === "own") {
    const own = await client.query<BidRow>(
      `select * from public.auction_bids where slot_id = $1 and owner_guest_id = $2`,
      [slot.id, req.guestId],
    );
    bid = own.rows[0] ?? null;
    if (bid && bid.library_track_id !== req.target.libraryTrackId) return fail("track_fixed");
    if (!bid) {
      const track = await client.query<{
        id: string;
        title: string;
        artist: string;
        genre: string | null;
        bpm: string | null;
        camelot_key: string | null;
        duration_sec: number | null;
      }>(
        `select id, title, artist, genre, bpm, camelot_key, duration_sec
           from public.library_tracks where id = $1 and venue_id = $2 and not blocked`,
        [req.target.libraryTrackId, slot.venue_id],
      );
      const t = track.rows[0];
      if (!t) return fail("track_not_found");
      const inserted = await client.query<BidRow>(
        `insert into public.auction_bids
           (slot_id, session_id, venue_id, owner_guest_id, library_track_id, track_title, track_artist,
            track_genre, track_bpm, track_key, track_duration_sec, total_cents, display_mode, display_label, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, $12, $13, 'outbid')
         returning *`,
        [slot.id, slot.session_id, slot.venue_id, req.guestId, t.id, t.title, t.artist, t.genre, t.bpm,
          t.camelot_key, t.duration_sec, req.display.mode, label],
      );
      bid = inserted.rows[0] as BidRow;
    }
  } else {
    const backed = await client.query<BidRow>(
      `select * from public.auction_bids where id = $1 and slot_id = $2`,
      [req.target.bidId, slot.id],
    );
    bid = backed.rows[0] ?? null;
    if (!bid) return fail("bid_not_found");
  }

  const add = req.totalCents - bid.total_cents;
  if (add <= 0) return fail("below_minimum");

  await lockWallet(client, req.guestId, slot.venue_id);
  const balance = await walletBalance(client, req.guestId, slot.venue_id);
  if (balance < add) return fail("insufficient_funds", add - balance);

  const publishes: OutgoingBroadcast[] = [...slotChanged(slot.session_id, slot.id)];
  if (leader && leader.id !== bid.id) {
    const returnedTo = await returnContributionsInTx(client, leader, now);
    await client.query(
      `update public.auction_bids set status = 'outbid', total_cents = 0, updated_at = now() where id = $1`,
      [leader.id],
    );
    const notify = new Set([...returnedTo, leader.owner_guest_id]);
    notify.delete(req.guestId);
    publishes.push(...toGuests(notify, "auction.outbid", { slotId: slot.id }));
  }

  const contribution = await client.query<{ id: string }>(
    `insert into public.auction_contributions (bid_id, slot_id, guest_id, amount_cents, total_after_cents, extended)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [bid.id, slot.id, req.guestId, add, req.totalCents, decision.extended],
  );
  await client.query(
    `insert into public.wallet_entries (venue_id, guest_id, session_id, amount_cents, reason, contribution_id)
     values ($1, $2, $3, $4, 'bid', $5)`,
    [slot.venue_id, req.guestId, slot.session_id, -add, contribution.rows[0]?.id],
  );
  const ownAction = req.target.kind === "own";
  await client.query(
    `update public.auction_bids
        set total_cents = $2, status = 'leading', updated_at = now(),
            display_mode = case when $3 then $4 else display_mode end,
            display_label = case when $3 then $5 else display_label end
      where id = $1`,
    [bid.id, req.totalCents, ownAction, req.display.mode, label],
  );
  await client.query(
    `update public.auction_slots
        set closes_at = to_timestamp($2 / 1000.0), extensions = extensions + $3
      where id = $1`,
    [slot.id, decision.closesAtMs, decision.extended ? 1 : 0],
  );
  publishes.push(...toGuests([req.guestId], "wallet.changed", {}));

  return {
    value: {
      ok: true,
      bidId: bid.id,
      totalCents: req.totalCents,
      closesAt: new Date(decision.closesAtMs).toISOString(),
      extended: decision.extended,
    },
    publishes,
  };
}

/** Places a bid paid entirely from the wallet (else `insufficient_funds`). */
export async function placeBid(req: BidRequest, now: number): Promise<PlaceResult> {
  return runAndPublish((client) => placeInTx(client, req, now), now);
}

/* ------------------------------------------------------------------ */
/* Top-ups: a bid waiting for its money                                */
/* ------------------------------------------------------------------ */

export interface TopUpInput extends BidRequest {
  needCents: number;
  method: PaymentMethod;
  phone?: string;
  email?: string;
}

export interface TopUpStarted {
  intentId: string;
  /** 'placed' (card, at once), 'pending' (MB WAY push out) or 'failed'. */
  state: "placed" | "pending" | "superseded" | "failed";
  expiresAt: string | null;
  bid?: PlaceResult;
}

/**
 * Charges what the wallet lacks, then places the bid when the money is in.
 * Card/wallet: authorize + capture now. MB WAY: the webhook settles it.
 * If the auction moved on meanwhile, the money simply stays in the wallet.
 */
export async function startTopUpBid(input: TopUpInput, now: number): Promise<TopUpStarted> {
  const slotRes = await getPool().query<{ session_id: string; venue_id: string }>(
    `select session_id, venue_id from public.auction_slots where id = $1`,
    [input.slotId],
  );
  const slot = slotRes.rows[0];
  if (!slot) return { intentId: "", state: "failed", expiresAt: null };

  const intentRes = await getPool().query<{ id: string }>(
    `insert into public.auction_intents
       (slot_id, guest_id, library_track_id, backed_bid_id, target_total_cents, display_mode, display_label)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      input.slotId,
      input.guestId,
      input.target.kind === "own" ? input.target.libraryTrackId : null,
      input.target.kind === "back" ? input.target.bidId : null,
      input.totalCents,
      input.display.mode,
      displayLabel(input.display),
    ],
  );
  const intentId = (intentRes.rows[0] as { id: string }).id;
  const idempotencyKey = `topup:${intentId}`;
  const provider = await getPaymentProvider();
  const payIn = {
    idempotencyKey,
    requestId: intentId,
    method: input.method,
    amountCents: input.needCents,
    currency: "EUR" as const,
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.email ? { email: input.email } : {}),
  };
  const intent = input.method === "mbway" ? await provider.charge(payIn) : await provider.authorize(payIn);
  const paymentRes = await getPool().query<{ id: string }>(
    `insert into public.payments
       (request_id, session_id, venue_id, intent_id, guest_id, provider, method, status, amount_cents,
        provider_ref, idempotency_key, expires_at)
     values (null, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (idempotency_key) do update set updated_at = now()
     returning id`,
    [slot.session_id, slot.venue_id, intentId, input.guestId, provider.name, input.method, intent.status,
      input.needCents, intent.providerRef, idempotencyKey, intent.expiresAt ?? null],
  );
  const paymentId = (paymentRes.rows[0] as { id: string }).id;

  if (intent.status === "failed") {
    await getPool().query(`update public.auction_intents set status = 'failed', settled_at = now() where id = $1`, [intentId]);
    return { intentId, state: "failed", expiresAt: null };
  }
  if (intent.status === "authorized") {
    // Card/wallet: charge now — the money must exist to sit in the wallet.
    await provider.capture(intent.providerRef, input.needCents, `capture:${paymentId}`);
    const settled = await runAndPublish(async (client) => {
      await client.query(
        `update public.payments set status = 'captured', captured_cents = $2 where id = $1`,
        [paymentId, input.needCents],
      );
      await postLedgerGroup(
        client,
        captureGroup(input.needCents, { venueId: slot.venue_id, sessionId: slot.session_id, memo: "capture:topup" }),
      );
      return settleTopUpInTx(client, paymentId, "confirmed", now);
    }, now);
    return { intentId, state: settled.state, expiresAt: null, ...(settled.bid ? { bid: settled.bid } : {}) };
  }
  return { intentId, state: "pending", expiresAt: intent.expiresAt ?? null };
}

/**
 * A top-up payment settled (card capture above, or the MB WAY webhook —
 * which already captured and posted the ledger). Credits the wallet once,
 * then tries the waiting bid; if the auction moved on, the money stays.
 */
export async function settleTopUpInTx(
  client: PoolClient,
  paymentId: string,
  kind: "confirmed" | "failed" | "expired",
  now: number,
): Promise<{ value: { state: TopUpStarted["state"]; bid?: PlaceResult }; publishes: OutgoingBroadcast[] }> {
  const payRes = await client.query<{
    intent_id: string;
    guest_id: string;
    venue_id: string;
    session_id: string;
    captured_cents: number;
  }>(`select intent_id, guest_id, venue_id, session_id, captured_cents from public.payments where id = $1`, [paymentId]);
  const pay = payRes.rows[0];
  if (!pay) return { value: { state: "failed" }, publishes: [] };
  const intentRes = await client.query<{
    id: string;
    slot_id: string;
    status: string;
    library_track_id: string | null;
    backed_bid_id: string | null;
    target_total_cents: number;
    display_mode: DisplayChoice["mode"];
    display_label: string | null;
  }>(`select * from public.auction_intents where id = $1 for update`, [pay.intent_id]);
  const intent = intentRes.rows[0];
  if (!intent) return { value: { state: "failed" }, publishes: [] };

  if (kind !== "confirmed") {
    await client.query(
      `update public.auction_intents set status = 'failed', reason = $2, settled_at = now()
        where id = $1 and status = 'pending'`,
      [intent.id, kind],
    );
    return { value: { state: "failed" }, publishes: toGuests([pay.guest_id], "wallet.changed", {}) };
  }

  await lockWallet(client, pay.guest_id, pay.venue_id);
  const credited = await client.query(
    `select 1 from public.wallet_entries where payment_id = $1 and reason = 'topup'`,
    [paymentId],
  );
  if ((credited.rowCount ?? 0) === 0 && pay.captured_cents > 0) {
    await client.query(
      `insert into public.wallet_entries (venue_id, guest_id, session_id, amount_cents, reason, payment_id)
       values ($1, $2, $3, $4, 'topup', $5)`,
      [pay.venue_id, pay.guest_id, pay.session_id, pay.captured_cents, paymentId],
    );
  }
  if (intent.status !== "pending") return { value: { state: "failed" }, publishes: [] };

  const display: DisplayChoice =
    intent.display_mode === "handle"
      ? { mode: "handle", handle: intent.display_label ?? "" }
      : intent.display_mode === "table"
        ? { mode: "table", table: intent.display_label ?? "" }
        : { mode: "anonymous" };
  const placed = await placeInTx(
    client,
    {
      slotId: intent.slot_id,
      guestId: pay.guest_id,
      totalCents: intent.target_total_cents,
      target: intent.backed_bid_id
        ? { kind: "back", bidId: intent.backed_bid_id }
        : { kind: "own", libraryTrackId: intent.library_track_id ?? "" },
      display,
    },
    now,
  );
  const ok = placed.value.ok;
  await client.query(
    `update public.auction_intents set status = $2, reason = $3, settled_at = now() where id = $1`,
    [intent.id, ok ? "placed" : "superseded", ok ? null : placed.value.ok ? null : placed.value.error],
  );
  return {
    value: { state: ok ? "placed" : "superseded", bid: placed.value },
    publishes: [...placed.publishes, ...toGuests([pay.guest_id], "wallet.changed", {})],
  };
}

/* ------------------------------------------------------------------ */
/* Closing, winners and the DJ                                         */
/* ------------------------------------------------------------------ */

async function closeSlotInTx(
  client: PoolClient,
  slotId: string,
  now: number,
): Promise<{ value: boolean; publishes: OutgoingBroadcast[] }> {
  const slot = await lockSlot(client, slotId);
  if (!slot || slot.status !== "open" || slot.closes_at.getTime() > now) return { value: false, publishes: [] };
  const night = await loadNight(client, slot.session_id);
  if (!night) return { value: false, publishes: [] };
  const leader = await leaderOf(client, slot.id);
  const publishes = slotChanged(slot.session_id, slot.id);

  if (closeOutcome(leader?.total_cents ?? null, slot.min_price_cents) === "no_winner" || !leader) {
    // Nobody reached the minimum: the slot is the DJ's, nothing is charged.
    await client.query(
      `update public.auction_slots set status = 'closed', outcome = 'no_winner', closed_at = to_timestamp($2 / 1000.0)
        where id = $1`,
      [slot.id, now],
    );
    return { value: true, publishes };
  }

  const recent = await client.query<{ closed_at: Date }>(
    `select closed_at from public.auction_slots
      where session_id = $1 and announce and closed_at > to_timestamp($2 / 1000.0) - interval '1 hour'`,
    [slot.session_id, now],
  );
  const rec = recognitionFor(
    leader.total_cents,
    leader.display_mode === "anonymous",
    recent.rows.map((r) => r.closed_at.getTime()),
    now,
    night.config.recognition,
  );
  await client.query(
    `update public.auction_slots
        set status = 'closed', outcome = 'won', winning_bid_id = $2, play_status = 'locked',
            recognition = $3, announce = $4, closed_at = to_timestamp($5 / 1000.0)
      where id = $1`,
    [slot.id, leader.id, rec.level, rec.announce, now],
  );
  await client.query(`update public.auction_bids set status = 'won', updated_at = now() where id = $1`, [leader.id]);
  await client.query(
    `update public.auction_bids set status = 'lost', updated_at = now() where slot_id = $1 and id <> $2`,
    [slot.id, leader.id],
  );
  const backers = await client.query<{ guest_id: string }>(
    `select distinct guest_id from public.auction_contributions where bid_id = $1 and returned_at is null`,
    [leader.id],
  );
  publishes.push(...toGuests(backers.rows.map((b) => b.guest_id), "auction.won", { slotId: slot.id }));
  return { value: true, publishes };
}

/** The winner did not play (rejected, 15 min passed, night over): money back to the wallets. */
async function refundWinnerInTx(
  client: PoolClient,
  slot: SlotRow,
  reason: "rejected_by_dj" | "not_played" | "session_ended",
  now: number,
): Promise<OutgoingBroadcast[]> {
  if (!slot.winning_bid_id) return [];
  const bidRes = await client.query<BidRow>(`select * from public.auction_bids where id = $1`, [slot.winning_bid_id]);
  const bid = bidRes.rows[0];
  if (!bid) return [];
  const returnedTo = await returnContributionsInTx(client, bid, now);
  await client.query(
    `update public.auction_slots
        set play_status = 'refunded', refund_reason = $2, refunded_at = to_timestamp($3 / 1000.0)
      where id = $1`,
    [slot.id, reason, now],
  );
  return [...slotChanged(slot.session_id, slot.id), ...toGuests(returnedTo, "wallet.changed", {})];
}

/** The winner played: the money behind it is spent and split (ledger recognition). */
async function markPlayedInTx(client: PoolClient, slot: SlotRow, night: Night, now: number): Promise<OutgoingBroadcast[]> {
  const spent = await client.query<{ amount_cents: number }>(
    `update public.auction_contributions set spent_at = to_timestamp($2 / 1000.0)
      where bid_id = $1 and returned_at is null and spent_at is null
      returning amount_cents`,
    [slot.winning_bid_id, now],
  );
  const total = spent.rows.reduce((sum, r) => sum + r.amount_cents, 0);
  if (total > 0) {
    await postLedgerGroup(
      client,
      recognitionGroup(computeSplit(total, night.betbeatFeeBps, night.venueShareBps), {
        venueId: night.venueId,
        sessionId: night.sessionId,
        memo: "recognition:auction",
      }),
    );
  }
  await client.query(
    `update public.auction_slots set play_status = 'played', played_at = to_timestamp($2 / 1000.0) where id = $1`,
    [slot.id, now],
  );
  return slotChanged(slot.session_id, slot.id);
}

export type SlotAction =
  | "accept"
  | "reject"
  | "playing"
  | "played"
  | "pause"
  | "resume"
  | "cancel"
  | "announced";

export type SlotActionResult = { ok: true; reopenedSlotId?: string } | { ok: false; error: "not_found" | "invalid_action" };

/** Every DJ decision on a slot (B1: the DJ has the final say). */
export async function djSlotAction(slotId: string, action: SlotAction, actor: string, now: number): Promise<SlotActionResult> {
  type Step = { value: SlotActionResult; publishes: OutgoingBroadcast[] };
  return runAndPublish<SlotActionResult>(async (client): Promise<Step> => {
    const invalid: Step = { value: { ok: false, error: "invalid_action" }, publishes: [] };
    const notFound: Step = { value: { ok: false, error: "not_found" }, publishes: [] };
    const slot = await lockSlot(client, slotId);
    if (!slot) return notFound;
    const night = await loadNight(client, slot.session_id);
    if (!night) return notFound;
    const hasBids = (await leaderOf(client, slot.id)) !== null;
    const at = new Date(now);
    let publishes: OutgoingBroadcast[] = slotChanged(slot.session_id, slot.id);
    let reopenedSlotId: string | undefined;

    switch (action) {
      case "accept":
        if (slot.play_status !== "locked") return invalid;
        await client.query(`update public.auction_slots set play_status = 'accepted', accepted_at = $2 where id = $1`, [slot.id, at]);
        break;
      case "reject": {
        if (slot.play_status !== "locked" && slot.play_status !== "accepted") return invalid;
        publishes = await refundWinnerInTx(client, slot, "rejected_by_dj", now);
        // Reopen (club default): a fresh 4-minute auction at the same price.
        reopenedSlotId = await insertSlotNowInTx(client, night, slot.phase, slot.min_price_cents, now);
        publishes.push(...slotChanged(slot.session_id, reopenedSlotId));
        break;
      }
      case "playing": {
        if (slot.play_status !== "locked" && slot.play_status !== "accepted") return invalid;
        const bid = (await client.query<BidRow>(`select * from public.auction_bids where id = $1`, [slot.winning_bid_id])).rows[0];
        if (!bid) return invalid;
        await client.query(`update public.auction_slots set play_status = 'playing', playing_at = $2 where id = $1`, [slot.id, at]);
        await client.query(
          `insert into public.session_tracks (session_id, title, artist, genre, bpm, camelot_key, duration_sec, source, started_at)
           values ($1, $2, $3, $4, $5, $6, $7, 'request', $8)`,
          [slot.session_id, bid.track_title, bid.track_artist, bid.track_genre, bid.track_bpm, bid.track_key, bid.track_duration_sec, at],
        );
        break;
      }
      case "played":
        if (slot.play_status !== "playing") return invalid;
        publishes = await markPlayedInTx(client, slot, night, now);
        break;
      case "pause":
        if ((slot.status !== "scheduled" && slot.status !== "open") || hasBids) return invalid;
        await client.query(`update public.auction_slots set status = 'paused' where id = $1`, [slot.id]);
        break;
      case "resume": {
        if (slot.status !== "paused") return invalid;
        const next = now >= slot.closes_at.getTime() ? "cancelled" : now >= slot.opens_at.getTime() ? "open" : "scheduled";
        await client.query(`update public.auction_slots set status = $2 where id = $1`, [slot.id, next]);
        break;
      }
      case "cancel":
        if (!["scheduled", "open", "paused"].includes(slot.status) || hasBids) return invalid;
        await client.query(`update public.auction_slots set status = 'cancelled' where id = $1`, [slot.id]);
        break;
      case "announced":
        if (!slot.announce || slot.announced_at) return invalid;
        await client.query(`update public.auction_slots set announced_at = $2 where id = $1`, [slot.id, at]);
        break;
    }
    await client.query(
      `insert into public.audit_log (actor, action, entity, entity_id, venue_id, payload)
       values ($1, $2, 'auction_slot', $3, $4, $5)`,
      [actor, `auction.${action}`, slot.id, slot.venue_id, JSON.stringify(reopenedSlotId ? { reopenedSlotId } : {})],
    );
    return { value: { ok: true, ...(reopenedSlotId ? { reopenedSlotId } : {}) }, publishes };
  }, now);
}

/** DJ "abrir leilão agora": an extra slot at the current phase's price. */
export async function openExtraSlot(sessionId: string, actor: string, now: number): Promise<string | null> {
  return runAndPublish(async (client) => {
    const night = await loadNight(client, sessionId);
    if (!night || night.status !== "live") return { value: null, publishes: [] };
    const { phaseWindows } = await import("./schedule");
    const phase =
      phaseWindows(night.startsAtMs, night.endsAtMs, night.config).find((w) => now >= w.startMs && now < w.endMs) ??
      null;
    const minPrice = Math.max(phase?.minPriceCents ?? 0, night.config.minIncrementCents);
    const id = await insertSlotNowInTx(client, night, phase?.name ?? "close", minPrice, now);
    await client.query(
      `insert into public.audit_log (actor, action, entity, entity_id, venue_id) values ($1, 'auction.extra_slot', 'auction_slot', $2, $3)`,
      [actor, id, night.venueId],
    );
    return { value: id, publishes: slotChanged(sessionId, id) };
  }, now);
}

/* ------------------------------------------------------------------ */
/* Worker tick                                                         */
/* ------------------------------------------------------------------ */

export interface TickResult {
  planned: number;
  opened: number;
  closed: number;
  refunded: number;
  played: number;
  expiredTopUps: number;
}

/** One pass (worker loop, ~1 s): plan, open, close, refund unplayed, auto-play, expire top-ups. */
export async function tickAuctions(now: number): Promise<TickResult> {
  const pool = getPool();
  const result: TickResult = { planned: 0, opened: 0, closed: 0, refunded: 0, played: 0, expiredTopUps: 0 };

  const live = await pool.query<{ id: string }>(`select id from public.sessions where status = 'live'`);
  for (const { id } of live.rows) result.planned += await ensureNightPlan(id, now);

  const opened = await pool.query<{ id: string; session_id: string }>(
    `update public.auction_slots s set status = 'open'
       from public.sessions se
      where se.id = s.session_id and se.status = 'live'
        and s.status = 'scheduled' and s.opens_at <= to_timestamp($1 / 1000.0)
        and s.closes_at > to_timestamp($1 / 1000.0)
      returning s.id, s.session_id`,
    [now],
  );
  result.opened = opened.rowCount ?? 0;
  await publishBroadcasts(opened.rows.flatMap((r) => slotChanged(r.session_id, r.id)), now);
  // Missed entirely (worker down, session paused): never open late.
  await pool.query(
    `update public.auction_slots set status = 'cancelled'
      where status = 'scheduled' and closes_at <= to_timestamp($1 / 1000.0)`,
    [now],
  );

  const due = await pool.query<{ id: string }>(
    `select id from public.auction_slots where status = 'open' and closes_at <= to_timestamp($1 / 1000.0)`,
    [now],
  );
  for (const { id } of due.rows) {
    if (await runAndPublish((client) => closeSlotInTx(client, id, now), now)) result.closed += 1;
  }

  // Winners the DJ did not play in time: money back to the wallets.
  const waiting = await pool.query<{ id: string; session_id: string; closed_at: Date }>(
    `select id, session_id, closed_at from public.auction_slots where play_status in ('locked', 'accepted')`,
  );
  for (const w of waiting.rows) {
    const night = await loadNight(pool, w.session_id);
    if (!night || w.closed_at.getTime() + night.config.refundAfterMin * 60_000 > now) continue;
    await runAndPublish(async (client) => {
      const slot = await lockSlot(client, w.id);
      if (!slot || (slot.play_status !== "locked" && slot.play_status !== "accepted")) {
        return { value: undefined, publishes: [] };
      }
      result.refunded += 1;
      return { value: undefined, publishes: await refundWinnerInTx(client, slot, "not_played", now) };
    }, now);
  }

  // Playing for longer than the track: played.
  const playing = await pool.query<{ id: string; session_id: string }>(
    `select s.id, s.session_id from public.auction_slots s
       join public.auction_bids b on b.id = s.winning_bid_id
      where s.play_status = 'playing' and b.track_duration_sec is not null
        and s.playing_at + make_interval(secs => b.track_duration_sec) <= to_timestamp($1 / 1000.0)`,
    [now],
  );
  for (const p of playing.rows) {
    await runAndPublish(async (client) => {
      const slot = await lockSlot(client, p.id);
      const night = await loadNight(client, p.session_id);
      if (!slot || !night || slot.play_status !== "playing") return { value: undefined, publishes: [] };
      result.played += 1;
      return { value: undefined, publishes: await markPlayedInTx(client, slot, night, now) };
    }, now);
  }

  // MB WAY top-ups whose push expired unanswered.
  const expired = await pool.query<{ id: string }>(
    `update public.payments set status = 'expired'
      where intent_id is not null and status = 'pending' and expires_at is not null
        and expires_at <= to_timestamp($1 / 1000.0)
      returning id`,
    [now],
  );
  for (const { id } of expired.rows) {
    await runAndPublish((client) => settleTopUpInTx(client, id, "expired", now), now);
    result.expiredTopUps += 1;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* End of night                                                        */
/* ------------------------------------------------------------------ */

/**
 * Night over (DJ or auto-close): unplayed winners and open bids go back to
 * the wallets, a playing winner counts as played, and every wallet that
 * took part tonight is refunded to its payment method (keeping a balance
 * for another night needs a legal review first — off).
 */
export async function finishNightAuctions(sessionId: string, now: number): Promise<{ walletsRefunded: number }> {
  return runAndPublish(async (client) => {
    const night = await loadNight(client, sessionId);
    if (!night) return { value: { walletsRefunded: 0 }, publishes: [] };
    const publishes: OutgoingBroadcast[] = [];
    const slots = await client.query<SlotRow>(
      `select * from public.auction_slots where session_id = $1 for update`,
      [sessionId],
    );
    for (const slot of slots.rows) {
      if (["scheduled", "open", "paused"].includes(slot.status)) {
        const leader = await leaderOf(client, slot.id);
        if (leader) {
          const returnedTo = await returnContributionsInTx(client, leader, now);
          await client.query(`update public.auction_bids set status = 'lost', total_cents = 0 where id = $1`, [leader.id]);
          publishes.push(...toGuests(returnedTo, "wallet.changed", {}));
        }
        await client.query(`update public.auction_slots set status = 'cancelled' where id = $1`, [slot.id]);
      } else if (slot.play_status === "locked" || slot.play_status === "accepted") {
        publishes.push(...(await refundWinnerInTx(client, slot, "session_ended", now)));
      } else if (slot.play_status === "playing") {
        publishes.push(...(await markPlayedInTx(client, slot, night, now)));
      }
    }
    // A kept balance waits for the guest's next night, their "Devolver" or
    // the keepBalanceDays expiry (expireKeptBalances, daily worker job).
    const guests = await client.query<{ guest_id: string }>(
      `select distinct w.guest_id from public.wallet_entries w
         left join public.wallet_preferences p on p.guest_id = w.guest_id and p.venue_id = $2
        where w.session_id = $1 and not ($3 and coalesce(p.keep_balance, false))`,
      [sessionId, night.venueId, night.config.keepBalanceAllowed],
    );
    let walletsRefunded = 0;
    for (const g of guests.rows) {
      if ((await refundWalletInTx(client, g.guest_id, night.venueId, sessionId, now)) > 0) walletsRefunded += 1;
    }
    publishes.push(...toGuests(guests.rows.map((g) => g.guest_id), "wallet.changed", {}));
    return { value: { walletsRefunded }, publishes };
  }, now);
}

/* ------------------------------------------------------------------ */
/* Read models                                                         */
/* ------------------------------------------------------------------ */

export interface PublicSlot {
  id: string;
  kind: SlotRow["kind"];
  phase: string;
  opensAt: string;
  closesAt: string;
  scheduledCloseAt: string;
  minPriceCents: number;
  minNextCents: number;
  extensions: number;
  bids: number;
  top: {
    bidId: string;
    totalCents: number;
    trackTitle: string;
    trackArtist: string;
    /** Shown only from the screen-name tier (50 € by default). */
    label: string | null;
    backers: number;
  } | null;
}

export interface PublicWinner {
  slotId: string;
  kind: SlotRow["kind"];
  trackTitle: string;
  trackArtist: string;
  label: string | null;
  totalCents: number;
  playStatus: NonNullable<SlotRow["play_status"]>;
  recognition: string | null;
  closedAt: string;
  /** DJ target (closedAt + 10 min) and refund deadline (+15 min). */
  playBy: string;
  refundAt: string;
}

export interface PublicAuctionState {
  serverNow: string;
  open: PublicSlot[];
  next: { id: string; kind: SlotRow["kind"]; opensAt: string; closesAt: string; minPriceCents: number } | null;
  /** "A seguir": the winner waiting for the DJ. */
  upNext: PublicWinner | null;
  recentWinners: PublicWinner[];
  /** Who spent the most tonight (played winners), amounts public. */
  ranking: Array<{ label: string | null; spentCents: number }>;
  rules: {
    quickBidStepsCents: [number, number, number];
    minIncrementCents: number;
    minIncrementBps: number;
    lastMinuteWarningSec: number;
    screenNameCents: number;
    showAmountOnScreen: boolean;
    keepBalanceAllowed: boolean;
    keepBalanceDays: number;
  };
}

function winnerDto(
  r: {
    slot_id: string;
    kind: SlotRow["kind"];
    track_title: string;
    track_artist: string;
    display_label: string | null;
    total_cents: number;
    play_status: NonNullable<SlotRow["play_status"]>;
    recognition: string | null;
    closed_at: Date;
  },
  config: AuctionConfig,
): PublicWinner {
  const closed = r.closed_at.getTime();
  return {
    slotId: r.slot_id,
    kind: r.kind,
    trackTitle: r.track_title,
    trackArtist: r.track_artist,
    label: r.total_cents >= config.recognition.screenNameCents ? r.display_label : null,
    totalCents: r.total_cents,
    playStatus: r.play_status,
    recognition: r.recognition,
    closedAt: r.closed_at.toISOString(),
    playBy: new Date(closed + config.playTargetMin * 60_000).toISOString(),
    refundAt: new Date(closed + config.refundAfterMin * 60_000).toISOString(),
  };
}

/** Everything public about tonight's auctions (app, queue, rankings, venue screen). */
export async function publicAuctionState(sessionId: string, now: number): Promise<PublicAuctionState | null> {
  const pool = getPool();
  const night = await loadNight(pool, sessionId);
  if (!night) return null;
  const { config } = night;

  const [openRes, nextRes, winnersRes, rankingRes] = await Promise.all([
    pool.query<SlotRow & { bids: number; top_id: string | null; top_total: number | null; top_title: string | null; top_artist: string | null; top_label: string | null; backers: number | null }>(
      `select s.*, coalesce(c.n, 0)::int as bids,
              b.id as top_id, b.total_cents as top_total, b.track_title as top_title,
              b.track_artist as top_artist, b.display_label as top_label,
              (select count(distinct guest_id) from public.auction_contributions
                where bid_id = b.id and returned_at is null)::int as backers
         from public.auction_slots s
         left join public.auction_bids b on b.slot_id = s.id and b.status = 'leading'
         left join lateral (select count(*) as n from public.auction_contributions where slot_id = s.id) c on true
        where s.session_id = $1 and s.status = 'open'
        order by s.closes_at`,
      [sessionId],
    ),
    pool.query<SlotRow>(
      `select * from public.auction_slots where session_id = $1 and status = 'scheduled'
        order by opens_at limit 1`,
      [sessionId],
    ),
    pool.query<{
      slot_id: string;
      kind: SlotRow["kind"];
      track_title: string;
      track_artist: string;
      display_label: string | null;
      total_cents: number;
      play_status: NonNullable<SlotRow["play_status"]>;
      recognition: string | null;
      closed_at: Date;
    }>(
      `select s.id as slot_id, s.kind, b.track_title, b.track_artist, b.display_label, b.total_cents,
              s.play_status, s.recognition, s.closed_at
         from public.auction_slots s
         join public.auction_bids b on b.id = s.winning_bid_id
        where s.session_id = $1 and s.play_status is not null
        order by s.closed_at desc
        limit 12`,
      [sessionId],
    ),
    // Spent = money behind played winners, per guest; label = their last public choice tonight.
    pool.query<{ guest_id: string; spent: string; label: string | null }>(
      `select c.guest_id, sum(c.amount_cents)::bigint as spent,
              (select b.display_label from public.auction_bids b
                where b.owner_guest_id = c.guest_id and b.session_id = $1 and b.display_label is not null
                order by b.updated_at desc limit 1) as label
         from public.auction_contributions c
         join public.auction_slots s on s.id = c.slot_id
        where s.session_id = $1 and c.spent_at is not null
        group by c.guest_id
        order by spent desc
        limit 10`,
      [sessionId],
    ),
  ]);

  const winners = winnersRes.rows.map((r) => winnerDto(r, config));
  const nextRow = nextRes.rows[0];
  return {
    serverNow: new Date(now).toISOString(),
    open: openRes.rows.map((s) => ({
      id: s.id,
      kind: s.kind,
      phase: s.phase,
      opensAt: s.opens_at.toISOString(),
      closesAt: s.closes_at.toISOString(),
      scheduledCloseAt: s.scheduled_close_at.toISOString(),
      minPriceCents: s.min_price_cents,
      minNextCents: minNextBid(s.top_total, s.min_price_cents, config),
      extensions: s.extensions,
      bids: s.bids,
      top:
        s.top_id && s.top_total !== null
          ? {
              bidId: s.top_id,
              totalCents: s.top_total,
              trackTitle: s.top_title ?? "",
              trackArtist: s.top_artist ?? "",
              label: s.top_total >= config.recognition.screenNameCents ? s.top_label : null,
              backers: s.backers ?? 1,
            }
          : null,
    })),
    next: nextRow
      ? {
          id: nextRow.id,
          kind: nextRow.kind,
          opensAt: nextRow.opens_at.toISOString(),
          closesAt: nextRow.closes_at.toISOString(),
          minPriceCents: nextRow.min_price_cents,
        }
      : null,
    upNext: winners.find((w) => w.playStatus === "locked" || w.playStatus === "accepted") ?? null,
    recentWinners: winners.filter((w) => w.playStatus === "played" || w.playStatus === "playing").slice(0, 5),
    ranking: rankingRes.rows.map((r) => ({ label: r.label, spentCents: Number(r.spent) })),
    rules: {
      quickBidStepsCents: config.quickBidStepsCents,
      minIncrementCents: config.minIncrementCents,
      minIncrementBps: config.minIncrementBps,
      lastMinuteWarningSec: config.lastMinuteWarningSec,
      screenNameCents: config.recognition.screenNameCents,
      showAmountOnScreen: config.recognition.showAmountOnScreen,
      keepBalanceAllowed: config.keepBalanceAllowed,
      keepBalanceDays: config.keepBalanceDays,
    },
  };
}

export type MyBidStatus = "leading" | "outbid" | "next" | "playing" | "played" | "refunded" | "lost";

export interface MyAuctionState {
  walletCents: number;
  /** The guest's end-of-night choice (honoured only when the club allows it). */
  keepBalance: boolean;
  bids: Array<{
    slotId: string;
    bidId: string;
    slotKind: SlotRow["kind"];
    closesAt: string;
    trackTitle: string;
    trackArtist: string;
    owner: boolean;
    libraryTrackId: string | null;
    /** What I have behind it now (0 once returned). */
    myCents: number;
    totalCents: number;
    status: MyBidStatus;
  }>;
  pending: Array<{ intentId: string; slotId: string; targetTotalCents: number; createdAt: string }>;
}

/**
 * Kept balances expire: money left in a wallet with no movement for the
 * club's `keepBalanceDays` (30 by default) goes back to the payment
 * method. Daily worker job; it also sweeps any balance stranded otherwise.
 */
export async function expireKeptBalances(now: number): Promise<{ refunded: number }> {
  const DAY_MS = 86_400_000;
  // Pre-filter at the 1-day floor; each club's own limit is checked below.
  const res = await getPool().query<{ guest_id: string; venue_id: string; last_at: Date; auction: unknown }>(
    `select w.guest_id, w.venue_id, max(w.created_at) as last_at, v.settings -> 'auction' as auction
       from public.wallet_entries w
       join public.venues v on v.id = w.venue_id
      group by w.guest_id, w.venue_id, v.id
     having sum(w.amount_cents) > 0 and max(w.created_at) < to_timestamp($1 / 1000.0)`,
    [now - DAY_MS],
  );
  let refunded = 0;
  for (const r of res.rows) {
    const days = safeAuctionConfig(r.auction ?? {}).keepBalanceDays;
    if (r.last_at.getTime() > now - days * DAY_MS) continue;
    if ((await refundWallet(r.guest_id, r.venue_id, null, now)) > 0) refunded += 1;
  }
  return { refunded };
}

/** End-of-night choice for the balance: keep it here for another night, or refund it. */
export async function setKeepBalance(guestId: string, venueId: string, keep: boolean): Promise<void> {
  await getPool().query(
    `insert into public.wallet_preferences (guest_id, venue_id, keep_balance) values ($1, $2, $3)
     on conflict (guest_id, venue_id) do update set keep_balance = excluded.keep_balance, updated_at = now()`,
    [guestId, venueId, keep],
  );
}

/** The guest's own view: wallet, every bid they own or backed tonight, waiting top-ups. */
export async function myAuctionState(sessionId: string, venueId: string, guestId: string): Promise<MyAuctionState> {
  const pool = getPool();
  const [walletCents, bidsRes, pendingRes, prefRes] = await Promise.all([
    walletBalance(pool, guestId, venueId),
    pool.query<{
      slot_id: string;
      bid_id: string;
      kind: SlotRow["kind"];
      closes_at: Date;
      track_title: string;
      track_artist: string;
      owner: boolean;
      library_track_id: string | null;
      my_cents: string;
      total_cents: number;
      bid_status: BidRow["status"];
      slot_status: SlotRow["status"];
      play_status: SlotRow["play_status"];
      won: boolean;
    }>(
      `select s.id as slot_id, b.id as bid_id, s.kind, s.closes_at, b.track_title, b.track_artist,
              b.owner_guest_id = $2 as owner, b.library_track_id,
              coalesce((select sum(amount_cents) from public.auction_contributions
                         where bid_id = b.id and guest_id = $2 and returned_at is null), 0)::bigint as my_cents,
              b.total_cents, b.status as bid_status, s.status as slot_status, s.play_status,
              s.winning_bid_id = b.id as won
         from public.auction_bids b
         join public.auction_slots s on s.id = b.slot_id
        where s.session_id = $1
          and (b.owner_guest_id = $2
               or exists (select 1 from public.auction_contributions c where c.bid_id = b.id and c.guest_id = $2))
        order by s.closes_at desc`,
      [sessionId, guestId],
    ),
    pool.query<{ id: string; slot_id: string; target_total_cents: number; created_at: Date }>(
      `select i.id, i.slot_id, i.target_total_cents, i.created_at
         from public.auction_intents i join public.auction_slots s on s.id = i.slot_id
        where i.guest_id = $1 and s.session_id = $2 and i.status = 'pending'
        order by i.created_at desc`,
      [guestId, sessionId],
    ),
    pool.query<{ keep_balance: boolean }>(
      `select keep_balance from public.wallet_preferences where guest_id = $1 and venue_id = $2`,
      [guestId, venueId],
    ),
  ]);

  const statusOf = (r: (typeof bidsRes.rows)[number]): MyBidStatus => {
    if (r.won) {
      if (r.play_status === "playing") return "playing";
      if (r.play_status === "played") return "played";
      if (r.play_status === "refunded") return "refunded";
      return "next";
    }
    if (r.slot_status === "open") return r.bid_status === "leading" ? "leading" : "outbid";
    return "lost";
  };

  return {
    walletCents,
    keepBalance: prefRes.rows[0]?.keep_balance ?? false,
    bids: bidsRes.rows.map((r) => ({
      slotId: r.slot_id,
      bidId: r.bid_id,
      slotKind: r.kind,
      closesAt: r.closes_at.toISOString(),
      trackTitle: r.track_title,
      trackArtist: r.track_artist,
      owner: r.owner,
      libraryTrackId: r.library_track_id,
      myCents: Number(r.my_cents),
      totalCents: r.total_cents,
      status: statusOf(r),
    })),
    pending: pendingRes.rows.map((p) => ({
      intentId: p.id,
      slotId: p.slot_id,
      targetTotalCents: p.target_total_cents,
      createdAt: p.created_at.toISOString(),
    })),
  };
}
