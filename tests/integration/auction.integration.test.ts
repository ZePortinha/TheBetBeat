/**
 * Slot auctions against the LOCAL Supabase Postgres (SUPABASE_TEST=1).
 * Mandatory cases from the product brief: simultaneous bids, minimum
 * increment, soft close and its cap, minimum price not reached, outbid
 * money back to the wallet (re-bid charges only the difference), backing
 * someone else's bid, rejected track, track not played in 15 min, mic
 * announcement limit, MB WAY money arriving after the auction moved on,
 * and the end-of-night wallet refund. (Midnight, phases and specials are
 * pure — lib/auction/schedule.test.ts.)
 *
 * Each run uses its own session (no planned slots) and fresh guests.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));

function loadDotEnvLocal(): void {
  try {
    const raw = readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match && process.env[match[1] as string] === undefined) process.env[match[1] as string] = match[2];
    }
  } catch {
    // Local-CLI defaults below.
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

const db = await import("@/lib/db");
const auction = await import("@/lib/auction/service");
const paymentsService = await import("@/lib/payments/service");
const { getPaymentProvider } = await import("@/lib/payments");
import type { MockPaymentProvider } from "@/lib/payments/mock";

const VENUE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const RUN = randomUUID().slice(0, 8);
const T0 = Date.now();
let SESSION_ID = "";
let tracks: string[] = [];
let nextTrack = 0;
let phone = 30_000_000;

const takeTrack = () => tracks[nextTrack++] as string;
const takePhone = () => `+3519${String(++phone).padStart(8, "0")}`;

async function createGuest(): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change,
       email_change_token_new, recovery_token)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(),
       '{"provider":"anonymous","providers":["anonymous"]}', '{}', now(), now(), '', '', '', '')`,
    [id, `auction-${RUN}-${id.slice(0, 8)}@betbeat.test`],
  );
  await db.query(`insert into public.guests (id, locale) values ($1, 'pt-PT')`, [id]);
  return id;
}

const balance = (guestId: string) => auction.walletBalance(db.getPool(), guestId, VENUE_ID);

async function slotRow(id: string) {
  const res = await db.query<{
    status: string;
    outcome: string | null;
    play_status: string | null;
    closes_at: Date;
    extensions: number;
    winning_bid_id: string | null;
    announce: boolean;
    recognition: string | null;
    refund_reason: string | null;
  }>(`select * from public.auction_slots where id = $1`, [id]);
  return res.rows[0]!;
}

/** Bid with what the wallet has; card top-up (charge now) for the rest. */
async function bid(
  guestId: string,
  slotId: string,
  totalCents: number,
  now: number,
  target: Parameters<typeof auction.placeBid>[0]["target"],
) {
  const req = { slotId, guestId, totalCents, target, display: { mode: "anonymous" as const } };
  const placed = await auction.placeBid(req, now);
  if (placed.ok || placed.error !== "insufficient_funds") return placed;
  const topUp = await auction.startTopUpBid({ ...req, needCents: placed.needCents!, method: "card" }, now);
  return topUp.bid ?? { ok: false as const, error: "insufficient_funds" as const };
}

/** A fresh 4-minute slot opening at `now` (min price 5 €). */
async function newSlot(now: number): Promise<string> {
  const id = await auction.openExtraSlot(SESSION_ID, "staff:test-dj", now);
  if (!id) throw new Error("slot not opened");
  return id;
}

beforeAll(async () => {
  // A dedicated live night whose plan has no slots: tests open their own.
  const config = {
    phases: [{ name: "warmup", start: null, slotsPerHour: 0, minPriceCents: 500 }],
    specials: { firstPeak: { enabled: false }, lastSong: { enabled: false } },
  };
  const s = await db.query<{ id: string }>(
    `insert into public.sessions (venue_id, name, status, starts_at, ends_at, auction_config)
     values ($1, $2, 'live', to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0), $5) returning id`,
    [VENUE_ID, `IT auction ${RUN}`, T0 - 3_600_000, T0 + 6 * 3_600_000, JSON.stringify(config)],
  );
  SESSION_ID = s.rows[0]!.id;
  const t = await db.query<{ id: string }>(
    `insert into public.library_tracks (venue_id, title, artist, genre, bpm, camelot_key, duration_sec)
     select $1, 'AU ${RUN} Track ' || n, 'AU ${RUN} Artist', 'house', 124, '8A', 180
       from generate_series(1, 30) as n returning id`,
    [VENUE_ID],
  );
  tracks = t.rows.map((r) => r.id);
}, 60_000);

afterAll(async () => {
  await db.query(`update public.sessions set status = 'ended', ended_at = now() where id = $1`, [SESSION_ID]);
  await db.closePool();
}, 60_000);

describe("bidding on the server clock", () => {
  it("simultaneous bids at the same price: exactly one leads, the other is below the new minimum", async () => {
    const now = T0;
    const slot = await newSlot(now);
    const [a, b] = await Promise.all([createGuest(), createGuest()]);
    const [ta, tb] = [takeTrack(), takeTrack()];
    const results = await Promise.all([
      bid(a, slot, 500, now + 1000, { kind: "own", libraryTrackId: ta }),
      bid(b, slot, 500, now + 1000, { kind: "own", libraryTrackId: tb }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, error: "below_minimum" });
    const leaders = await db.query(`select 1 from public.auction_bids where slot_id = $1 and status = 'leading'`, [slot]);
    expect(leaders.rowCount).toBe(1);
  }, 60_000);

  it("enforces the larger of 1 € and 5%, gives outbid money back and re-bids charge only the difference", async () => {
    const now = T0 + 10_000;
    const slot = await newSlot(now);
    const [a, b] = await Promise.all([createGuest(), createGuest()]);
    const [ta, tb] = [takeTrack(), takeTrack()];

    expect(await bid(a, slot, 4000, now + 1000, { kind: "own", libraryTrackId: ta })).toMatchObject({ ok: true });
    expect(await balance(a)).toBe(0); // charged exactly the bid
    // 5% of 40 € is 2 €: 41 € is not enough, 42 € is.
    expect(await bid(b, slot, 4100, now + 2000, { kind: "own", libraryTrackId: tb })).toMatchObject({ error: "below_minimum" });
    expect(await bid(b, slot, 4200, now + 3000, { kind: "own", libraryTrackId: tb })).toMatchObject({ ok: true });
    expect(await balance(a)).toBe(4000); // outbid: back in A's wallet at once

    // A answers with 45 €: only 5 € is charged on top of the wallet.
    const payBefore = await db.query<{ n: string }>(`select count(*)::bigint as n from public.payments where guest_id = $1`, [a]);
    expect(await bid(a, slot, 4500, now + 4000, { kind: "own", libraryTrackId: ta })).toMatchObject({ ok: true });
    const lastPay = await db.query<{ amount_cents: number; n: string }>(
      `select amount_cents, (select count(*) from public.payments where guest_id = $1) as n
         from public.payments where guest_id = $1 order by created_at desc limit 1`,
      [a],
    );
    expect(Number(lastPay.rows[0]!.n)).toBe(Number(payBefore.rows[0]!.n) + 1);
    expect(lastPay.rows[0]!.amount_cents).toBe(500);
    expect(await balance(b)).toBe(4200);
    // Track is fixed per bidder per slot.
    expect(await bid(a, slot, 5000, now + 5000, { kind: "own", libraryTrackId: takeTrack() })).toMatchObject({ error: "track_fixed" });
  }, 60_000);

  it("soft close: +30 s per late bid, never past +3 min, then closed", async () => {
    const now = T0 + 20_000;
    const slot = await newSlot(now);
    const close = now + 240_000;
    const guests = await Promise.all([createGuest(), createGuest()]);
    const own = guests.map(() => takeTrack());
    let total = 500;
    // Bids at 20 s before each current close, alternating bidders.
    let current = close;
    for (let i = 0; i < 8; i++) {
      const r = await bid(guests[i % 2]!, slot, total, current - 20_000, { kind: "own", libraryTrackId: own[i % 2]! });
      expect(r).toMatchObject({ ok: true });
      current = (await slotRow(slot)).closes_at.getTime();
      total += 100;
    }
    const row = await slotRow(slot);
    expect(row.closes_at.getTime()).toBe(close + 180_000); // capped
    expect(row.extensions).toBe(6); // 6 × 30 s
    const late = await bid(guests[0]!, slot, total, close + 180_000, { kind: "own", libraryTrackId: own[0]! });
    expect(late).toMatchObject({ ok: false, error: "closed" });
  }, 60_000);

  it("minimum price not reached: no winner, nothing charged", async () => {
    const now = T0 + 30_000;
    const slot = await newSlot(now);
    await auction.tickAuctions(now + 241_000);
    expect(await slotRow(slot)).toMatchObject({ status: "closed", outcome: "no_winner", play_status: null });
  }, 60_000);

  it("backing someone else's bid: both pay their part, both get it back when outbid", async () => {
    const now = T0 + 40_000;
    const slot = await newSlot(now);
    const [a, c, d] = await Promise.all([createGuest(), createGuest(), createGuest()]);
    const r = await bid(a, slot, 1000, now + 1000, { kind: "own", libraryTrackId: takeTrack() });
    if (!r.ok) throw new Error("first bid failed");
    expect(await bid(c, slot, 1500, now + 2000, { kind: "back", bidId: r.bidId })).toMatchObject({ ok: true });
    expect(await bid(d, slot, 1600, now + 3000, { kind: "own", libraryTrackId: takeTrack() })).toMatchObject({ ok: true });
    expect(await balance(a)).toBe(1000);
    expect(await balance(c)).toBe(500);
  }, 60_000);
});

describe("after the close", () => {
  it("locks the winner, the DJ plays it, and the money is spent and split", async () => {
    const now = T0 + 50_000;
    const slot = await newSlot(now);
    const a = await createGuest();
    await bid(a, slot, 2000, now + 1000, { kind: "own", libraryTrackId: takeTrack() });
    await auction.tickAuctions(now + 241_000);
    expect(await slotRow(slot)).toMatchObject({ outcome: "won", play_status: "locked" });
    expect((await auction.djSlotAction(slot, "playing", "staff:test-dj", now + 300_000)).ok).toBe(true);
    expect((await auction.djSlotAction(slot, "played", "staff:test-dj", now + 480_000)).ok).toBe(true);
    const spent = await db.query<{ n: string }>(
      `select coalesce(sum(amount_cents), 0) as n from public.auction_contributions where slot_id = $1 and spent_at is not null`,
      [slot],
    );
    expect(Number(spent.rows[0]!.n)).toBe(2000);
    const recognition = await db.query(
      `select 1 from public.ledger_entries where session_id = $1 and memo = 'recognition:auction'`,
      [SESSION_ID],
    );
    expect(recognition.rowCount).toBeGreaterThan(0);
  }, 60_000);

  it("a rejected track goes back to the wallets and the slot reopens", async () => {
    const now = T0 + 60_000;
    const slot = await newSlot(now);
    const a = await createGuest();
    await bid(a, slot, 2000, now + 1000, { kind: "own", libraryTrackId: takeTrack() });
    await auction.tickAuctions(now + 241_000);
    const rejected = await auction.djSlotAction(slot, "reject", "staff:test-dj", now + 250_000);
    expect(rejected).toMatchObject({ ok: true });
    expect(await slotRow(slot)).toMatchObject({ play_status: "refunded", refund_reason: "rejected_by_dj" });
    expect(await balance(a)).toBe(2000);
    expect(rejected.ok && rejected.reopenedSlotId).toBeTruthy();
  }, 60_000);

  it("a winner not played within 15 minutes is refunded to the wallets", async () => {
    const now = T0 + 70_000;
    const slot = await newSlot(now);
    const a = await createGuest();
    await bid(a, slot, 2000, now + 1000, { kind: "own", libraryTrackId: takeTrack() });
    await auction.tickAuctions(now + 241_000);
    await auction.tickAuctions(now + 241_000 + 14 * 60_000);
    expect((await slotRow(slot)).play_status).toBe("locked");
    await auction.tickAuctions(now + 241_000 + 15 * 60_000);
    expect(await slotRow(slot)).toMatchObject({ play_status: "refunded", refund_reason: "not_played" });
    expect(await balance(a)).toBe(2000);
  }, 60_000);

  it("caps mic announcements at 3 per hour, then the name goes to the screen only", async () => {
    const base = T0 + 80_000;
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const now = base + i * 300_000;
      const slot = await newSlot(now);
      const g = await createGuest();
      const req = { slotId: slot, guestId: g, totalCents: 15000, target: { kind: "own" as const, libraryTrackId: takeTrack() }, display: { mode: "handle" as const, handle: `fan${i}` } };
      const placed = await auction.placeBid(req, now + 1000);
      if (!placed.ok) await auction.startTopUpBid({ ...req, needCents: placed.needCents!, method: "card" }, now + 1000);
      await auction.tickAuctions(now + 241_000);
      const row = await slotRow(slot);
      expect(row.recognition).toBe("announce");
      results.push(row.announce);
    }
    expect(results).toEqual([true, true, true, false]);
  }, 60_000);
});

describe("money", () => {
  it("MB WAY that lands after the auction moved on stays in the wallet", async () => {
    const now = T0 + 2_000_000;
    const slot = await newSlot(now);
    const [a, b] = await Promise.all([createGuest(), createGuest()]);
    const ta = takeTrack();
    const req = { slotId: slot, guestId: a, totalCents: 1000, target: { kind: "own" as const, libraryTrackId: ta }, display: { mode: "anonymous" as const } };
    const started = await auction.startTopUpBid({ ...req, needCents: 1000, method: "mbway", phone: takePhone() }, now + 1000);
    expect(started.state).toBe("pending");
    // Meanwhile B takes the lead at 20 €.
    expect(await bid(b, slot, 2000, now + 2000, { kind: "own", libraryTrackId: takeTrack() })).toMatchObject({ ok: true });
    const pay = await db.query<{ provider_ref: string }>(`select provider_ref from public.payments where intent_id = $1`, [started.intentId]);
    const provider = (await getPaymentProvider()) as MockPaymentProvider;
    await paymentsService.recordWebhook(provider.simulateMbwayConfirmation(pay.rows[0]!.provider_ref), now + 3000);
    const intent = await db.query<{ status: string }>(`select status from public.auction_intents where id = $1`, [started.intentId]);
    expect(intent.rows[0]!.status).toBe("superseded");
    expect(await balance(a)).toBe(1000);
  }, 60_000);

  it("end of night: open bids come back and every wallet is refunded to its payment method", async () => {
    const now = T0 + 2_100_000;
    const slot = await newSlot(now);
    const a = await createGuest();
    await bid(a, slot, 3000, now + 1000, { kind: "own", libraryTrackId: takeTrack() });
    expect(await balance(a)).toBe(0);
    const done = await auction.finishNightAuctions(SESSION_ID, now + 5000);
    expect(done.walletsRefunded).toBeGreaterThan(0);
    expect(await balance(a)).toBe(0);
    const refunds = await db.query<{ n: string }>(
      `select coalesce(sum(amount_cents), 0) as n from public.refunds where guest_id = $1 and status = 'succeeded'`,
      [a],
    );
    expect(Number(refunds.rows[0]!.n)).toBe(3000);
    expect((await slotRow(slot)).status).toBe("cancelled");
  }, 60_000);

  it("a guest who chose to keep the balance keeps it, but only while the club allows it", async () => {
    const now = T0 + 2_200_000;
    const slot = await newSlot(now);
    const [keeper, other] = await Promise.all([createGuest(), createGuest()]);
    await bid(keeper, slot, 3000, now + 1000, { kind: "own", libraryTrackId: takeTrack() });
    await bid(other, slot, 4000, now + 2000, { kind: "own", libraryTrackId: takeTrack() });
    expect(await balance(keeper)).toBe(3000);
    await auction.setKeepBalance(keeper, VENUE_ID, true);
    const allow = (on: boolean) =>
      db.query(`update public.sessions set auction_config = auction_config || jsonb_build_object('keepBalanceAllowed', $2::boolean) where id = $1`, [
        SESSION_ID,
        on,
      ]);

    await allow(true);
    await auction.finishNightAuctions(SESSION_ID, now + 5000);
    expect(await balance(keeper)).toBe(3000);
    expect(await balance(other)).toBe(0);

    await allow(false);
    await auction.finishNightAuctions(SESSION_ID, now + 6000);
    expect(await balance(keeper)).toBe(0);
  }, 60_000);

  it("a kept balance unused for 30 days goes back to the payment method", async () => {
    const now = T0 + 2_300_000;
    const slot = await newSlot(now);
    const [stale, recent, top] = await Promise.all([createGuest(), createGuest(), createGuest()]);
    await bid(stale, slot, 2000, now + 1000, { kind: "own", libraryTrackId: takeTrack() });
    await bid(recent, slot, 3000, now + 2000, { kind: "own", libraryTrackId: takeTrack() });
    await bid(top, slot, 4000, now + 3000, { kind: "own", libraryTrackId: takeTrack() });
    expect([await balance(stale), await balance(recent)]).toEqual([2000, 3000]);
    const age = (guestId: string, days: number) =>
      db.query(`update public.wallet_entries set created_at = created_at - make_interval(days => $2) where guest_id = $1`, [
        guestId,
        days,
      ]);
    await age(stale, 31);
    await age(recent, 10);

    await auction.expireKeptBalances(Date.now());
    expect(await balance(stale)).toBe(0);
    expect(await balance(recent)).toBe(3000);
    const refunds = await db.query<{ n: string }>(
      `select coalesce(sum(amount_cents), 0) as n from public.refunds where guest_id = $1 and status = 'succeeded'`,
      [stale],
    );
    expect(Number(refunds.rows[0]!.n)).toBe(2000);
  }, 60_000);
});
