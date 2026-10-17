/**
 * Library + promoter split (2026-10-11).
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
const domain = await import("@/lib/domain/service");
const library = await import("@/lib/catalog/library");

/**
 * The DJ's library (add / dedupe / browse / remove) and the event's revenue
 * split with a promoter, end to end on the money path: a played auction
 * credits Ritma 11%, club, promoter and DJ, and the end of the night
 * creates the promoter's payout. (SUPABASE_TEST=1, local test stack.)
 */
const VENUE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const RUN = randomUUID().slice(0, 8);
const T0 = Date.now();
let SESSION_ID = "";

async function createGuest(): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change,
       email_change_token_new, recovery_token)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(),
       '{"provider":"anonymous","providers":["anonymous"]}', '{}', now(), now(), '', '', '', '')`,
    [id, `library-${RUN}-${id.slice(0, 8)}@ritma.test`],
  );
  await db.query(`insert into public.guests (id, locale) values ($1, 'pt-PT')`, [id]);
  return id;
}

beforeAll(async () => {
  const config = {
    phases: [{ name: "warmup", start: null, slotsPerHour: 0, minPriceCents: 500 }],
    specials: { firstPeak: { enabled: false }, lastSong: { enabled: false } },
  };
  const s = await db.query<{ id: string }>(
    `insert into public.sessions (venue_id, name, status, starts_at, ends_at, auction_config, genres, bpm_min, bpm_max)
     values ($1, $2, 'live', to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0), $5, '{funk}', 100, 130) returning id`,
    [VENUE_ID, `IT library ${RUN}`, T0 - 3_600_000, T0 + 6 * 3_600_000, JSON.stringify(config)],
  );
  SESSION_ID = s.rows[0]!.id;
  await db.query(
    `insert into public.session_settings (session_id, config, venue_share_bps, promoter_share_bps, promoter_name)
     values ($1, '{"betbeatFeeBps":1100}', 3000, 2000, 'Promotora Lua Cheia')`,
    [SESSION_ID],
  );
}, 60_000);

afterAll(async () => {
  await db.query(`update public.sessions set status = 'ended', ended_at = coalesce(ended_at, now()) where id = $1`, [SESSION_ID]);
  await db.query(`update public.library_tracks set blocked = true where venue_id = $1 and artist like $2`, [VENUE_ID, `LB ${RUN}%`]);
  await db.closePool();
}, 60_000);

const song = (title: string, over: Partial<Parameters<typeof library.insertLibraryTracks>[2][number]> = {}) => ({
  title,
  artist: `LB ${RUN} Duque`,
  album: `LB ${RUN} Esquina`,
  genre: "Funk",
  bpm: 108,
  camelotKey: "2B",
  year: 2019,
  durationSec: 195,
  ...over,
});

describe("the DJ's own library", () => {
  it("adds songs once (same title + artist in any case is skipped) and browses by artist, album and style", async () => {
    const added = await db.withTransaction((c) =>
      library.insertLibraryTracks(c, VENUE_ID, [
        song("Cadência"),
        song("CADÊNCIA"),
        song("Passo Leve", { album: null, genre: "Kizomba", bpm: 92 }),
        song("Terra", { artist: `LB ${RUN} Maré`, album: `LB ${RUN} Sal`, genre: "Kizomba" }),
      ]),
    );
    expect(added).toBe(3);

    const tracks = await library.listLibraryTracks(VENUE_ID, { artist: `lb ${RUN} duque` });
    expect(tracks.map((t) => t.title).sort()).toEqual(["Cadência", "Passo Leve"]);
    expect(tracks.find((t) => t.title === "Cadência")).toMatchObject({ album: `LB ${RUN} Esquina`, year: 2019, bpm: 108, camelotKey: "2B" });

    const artists = await library.listLibraryGroups(VENUE_ID, "artists", { q: `LB ${RUN}` });
    expect(artists.find((a) => a.name === `LB ${RUN} Duque`)).toMatchObject({ tracks: 2, secondary: 1 });
    const albums = await library.listLibraryGroups(VENUE_ID, "albums", { q: `LB ${RUN}` });
    expect(albums.map((a) => a.name).sort()).toEqual([`LB ${RUN} Esquina`, `LB ${RUN} Sal`]);
    const styles = await library.listLibraryGroups(VENUE_ID, "styles", { q: `LB ${RUN}` });
    expect(styles.find((g) => g.name.toLowerCase() === "kizomba")).toMatchObject({ tracks: 2, secondary: 2 });
  }, 60_000);

  it("edits a song but refuses to turn it into a duplicate", async () => {
    const [a, b] = await library.listLibraryTracks(VENUE_ID, { artist: `LB ${RUN} Duque` });
    const edit = (title: string) =>
      db.withTransaction((c) =>
        library.updateLibraryTrack(c, VENUE_ID, a!.id, { ...song(title), album: null, coverUrl: null }),
      );
    expect(await edit(b!.title)).toBe("duplicate");
    expect(await edit(`${a!.title} (Edit)`)).toBe("ok");
  }, 60_000);

  it("deletes an unused song, but only blocks one guests already bid on", async () => {
    const slot = await auction.openExtraSlot(SESSION_ID, "staff:test-dj", T0);
    const [used, unused] = await library.listLibraryTracks(VENUE_ID, { artist: `LB ${RUN} Duque` });
    const guest = await createGuest();
    const req = { slotId: slot!, guestId: guest, totalCents: 500, target: { kind: "own" as const, libraryTrackId: used!.id }, display: { mode: "anonymous" as const } };
    const placed = await auction.placeBid(req, T0 + 1000);
    if (!placed.ok) await auction.startTopUpBid({ ...req, needCents: placed.needCents!, method: "card" }, T0 + 1000);

    expect(await db.withTransaction((c) => library.removeLibraryTrack(c, VENUE_ID, used!.id))).toBe("blocked");
    expect(await db.withTransaction((c) => library.removeLibraryTrack(c, VENUE_ID, unused!.id))).toBe("deleted");
    expect(await db.withTransaction((c) => library.removeLibraryTrack(c, VENUE_ID, unused!.id))).toBe("not_found");
    await db.query(`update public.auction_slots set status = 'cancelled' where id = $1`, [slot]);
  }, 60_000);
});

describe("revenue split with a promoter", () => {
  it("a played 100 € winner credits Ritma 11%, club 30%, promoter 20% and the DJ the rest; the night pays the promoter", async () => {
    const now = T0 + 60_000;
    await db.query(`update public.auction_slots set status = 'cancelled' where session_id = $1 and status = 'open'`, [SESSION_ID]);
    const slot = (await auction.openExtraSlot(SESSION_ID, "staff:test-dj", now))!;
    await db.withTransaction((c) =>
      library.insertLibraryTracks(c, VENUE_ID, [song("Pista Cheia", { artist: `LB ${RUN} Rua` })]),
    );
    const [track] = await library.listLibraryTracks(VENUE_ID, { artist: `LB ${RUN} Rua` });
    const guest = await createGuest();
    const req = { slotId: slot, guestId: guest, totalCents: 10_000, target: { kind: "own" as const, libraryTrackId: track!.id }, display: { mode: "anonymous" as const } };
    const placed = await auction.placeBid(req, now + 1000);
    if (!placed.ok) {
      const topUp = await auction.startTopUpBid({ ...req, needCents: placed.needCents!, method: "card" }, now + 1000);
      expect(topUp.bid).toMatchObject({ ok: true });
    }
    await auction.tickAuctions(now + 241_000);
    expect((await auction.djSlotAction(slot, "playing", "staff:test-dj", now + 300_000)).ok).toBe(true);
    expect((await auction.djSlotAction(slot, "played", "staff:test-dj", now + 480_000)).ok).toBe(true);

    const credits = await db.query<{ account: string; amount: string }>(
      `select account, sum(amount_cents)::bigint as amount from public.ledger_entries
        where session_id = $1 and memo = 'recognition:auction' group by account`,
      [SESSION_ID],
    );
    const by = Object.fromEntries(credits.rows.map((r) => [r.account, Number(r.amount)]));
    expect(by).toMatchObject({
      guest_escrow: 10_000,
      betbeat_revenue: -1100,
      venue_payable: -2670,
      promoter_payable: -1780,
      dj_payable: -4450,
    });

    const ended = await domain.endSession(SESSION_ID, "staff:test-admin", now + 600_000);
    expect(ended.ok).toBe(true);
    const payouts = await db.query<{ recipient_type: string; amount_cents: string }>(
      `select recipient_type, amount_cents from public.payouts where session_id = $1 order by recipient_type`,
      [SESSION_ID],
    );
    expect(payouts.rows.map((p) => [p.recipient_type, Number(p.amount_cents)])).toEqual([
      ["dj", 4450],
      ["promoter", 1780],
      ["venue", 2670],
    ]);
  }, 60_000);
});
