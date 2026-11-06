/**
 * Load test (B11 targets: 1 000 guests, 50 requests/min per session; price
 * answers p95 < 150 ms). No external deps: plain fetch + timing.
 *
 * It replays what a full club does to one live night, against a running
 * server (production build: `pnpm build && pnpm start`):
 *
 *   1. arrival rush: every guest opens the party page (QR scan) and gets an
 *      anonymous identity;
 *   2. the night: each guest polls the auction state on the app's own
 *      cadence (every 3 s) and the session state (every 15 s), searches now
 *      and then, while `--bids` bids per minute land on the open auction
 *      (the price and wallet path, then an MB WAY top-up on the simulator).
 *
 * Usage:
 *   pnpm exec tsx --conditions=react-server --env-file=.env.local scripts/load-test.ts \
 *     [--base http://localhost:3000[,http://localhost:3001]] [--guests 1000] [--minutes 2] [--bids 50]
 *     [--concurrency 50] [--token <guest QR token>] [--fund]
 *     [--poll-ms 8000] [--hints board|refetch|off]
 *
 * The night replays components/guest/use-auction.ts: a poll every 8 s
 * while realtime is up (--poll-ms 3000 = realtime down). After a bid the
 * server pushes the board on realtime (no phone request); with
 * --hints refetch every phone reads /board within 0.5 s instead (at most
 * once per 1.5 s), which is the path when the board channel is down.
 *
 * --fund (local stacks only) credits every guest's wallet in the database,
 * so bids run the price + wallet path without an MB WAY top-up (whose
 * Turnstile check needs Cloudflare). Without it, bids start a top-up.
 *
 * Without --token it signs the seeded zone QR with QR_TOKEN_SECRET (local
 * stacks only). All guests share one client IP, like a club on one Wi-Fi.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface Args {
  /** One or more app instances (comma-separated); guest i sticks to i % n. */
  bases: string[];
  base: string;
  guests: number;
  minutes: number;
  bids: number;
  concurrency: number;
  token: string | null;
  /** Local stacks only: credit each guest's wallet so bids skip the payment. */
  fund: boolean;
  /** Auction poll per guest: 8 s with realtime up (the app), 3 s without. */
  pollMs: number;
  /**
   * What a bid costs the phones: "board" (default, the app with realtime
   * up: the board arrives inside the message, no request), "refetch" (the
   * board channel down: every phone reads /board on the public hint) or
   * "off".
   */
  hints: "board" | "refetch" | "off";
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 ? a[i + 1]! : d;
  };
  return {
    bases: get("base", "http://localhost:3000").split(",").map((b) => b.trim().replace(/\/$/, "")),
    base: get("base", "http://localhost:3000").split(",")[0]!.trim().replace(/\/$/, ""),
    guests: Number(get("guests", "1000")),
    minutes: Number(get("minutes", "2")),
    bids: Number(get("bids", "50")),
    concurrency: Number(get("concurrency", "50")),
    token: a.includes("--token") ? get("token", "") : null,
    fund: a.includes("--fund"),
    pollMs: Number(get("poll-ms", "8000")),
    hints: (["board", "refetch", "off"] as const).find((h) => h === get("hints", "board")) ?? "board",
  };
}

/** Tiny .env.local reader (values never logged). */
function loadLocalEnv(): void {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const SEED_VENUE = "aaaaaaaa-0000-4000-8000-000000000001";

async function guestToken(args: Args): Promise<string> {
  if (args.token) return args.token;
  const { signToken } = await import("@/lib/security/tokens");
  return signToken({ kind: "zone", venueId: SEED_VENUE, slug: "zone-pista-dev" });
}

async function signInAnonymous(): Promise<string> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing (.env.local)");
  const res = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ data: {} }),
  });
  if (!res.ok) throw new Error(`anonymous sign-in failed (${res.status})`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Guest ids from the bearer tokens; a 100 000 € top-up each (local only: a 100-bid auction compounds the minimum raise). */
async function fundWallets(bearers: string[]): Promise<void> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  const ids = bearers.map((b) => JSON.parse(Buffer.from(b.split(".")[1]!, "base64url").toString()).sub as string);
  await pool.query(`insert into public.guests (id) select unnest($1::uuid[]) on conflict (id) do nothing`, [ids]);
  await pool.query(
    `insert into public.wallet_entries (venue_id, guest_id, amount_cents, reason)
     select $2, unnest($1::uuid[]), 10000000, 'topup'`,
    [ids, SEED_VENUE],
  );
  await pool.end();
  console.log(`[load] funded ${ids.length} wallets`);
}

/* ------------------------------------------------------------------ */
/* Measurement                                                         */
/* ------------------------------------------------------------------ */

interface Sample {
  ms: number;
  status: number;
}

const samples = new Map<string, Sample[]>();
const bidErrors = new Map<string, number>();

function record(name: string, sample: Sample): void {
  const list = samples.get(name) ?? [];
  list.push(sample);
  samples.set(name, list);
}

async function timed(name: string, run: () => Promise<Response>): Promise<Response | null> {
  const t0 = performance.now();
  try {
    const res = await run();
    const body = await res.arrayBuffer();
    record(name, { ms: performance.now() - t0, status: res.status });
    return new Response(body, { status: res.status, headers: res.headers });
  } catch {
    record(name, { ms: performance.now() - t0, status: 0 });
    return null;
  }
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

function report(elapsedMs: number): void {
  const rows: string[] = [];
  rows.push("| Endpoint | Requests | req/s | p50 ms | p95 ms | p99 ms | Statuses |");
  rows.push("| --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const [name, list] of samples) {
    const times = list.map((s) => s.ms).sort((a, b) => a - b);
    const statuses = new Map<number, number>();
    for (const s of list) statuses.set(s.status, (statuses.get(s.status) ?? 0) + 1);
    const statusText = [...statuses.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([code, n]) => `${code === 0 ? "net" : code}×${n}`)
      .join(" ");
    const perSec = name.startsWith("night:") ? (list.length / (elapsedMs / 1000)).toFixed(1) : "";
    rows.push(
      `| ${name} | ${list.length} | ${perSec} | ${pct(times, 50).toFixed(0)} | ${pct(times, 95).toFixed(0)} | ${pct(times, 99).toFixed(0)} | ${statusText} |`,
    );
  }
  console.log(rows.join("\n"));
  if (bidErrors.size > 0) console.log(`\n[load] refused bids: ${[...bidErrors].map(([c, n]) => `${c}×${n}`).join(" ")}`);
}

async function inPool<T>(items: Array<() => Promise<T>>, concurrency: number): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await items[idx]!();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Scenario                                                            */
/* ------------------------------------------------------------------ */

const HINT_MIN_MS = 1_500; // components/guest/use-auction.ts
const HINT_SPREAD_MS = 500;
const STATE_POLL_MS = 15_000; // components/guest/session-screen.tsx
const SEARCH_EVERY_MS = 120_000;
const QUERIES = ["house", "noite", "disco", "luz", "mar", "a"];

interface AuctionState {
  open?: Array<{ id: string; minNextCents: number }>;
}

async function main() {
  loadLocalEnv();
  const args = parseArgs();
  const token = await guestToken(args);
  const q = `token=${encodeURIComponent(token)}`;
  const partyPath = `/s/${encodeURIComponent(token)}`;
  console.log(
    `[load] base=${args.bases.join(",")} guests=${args.guests} minutes=${args.minutes} bids/min=${args.bids} ` +
      `poll=${args.pollMs}ms hints=${args.hints} conc=${args.concurrency}`,
  );

  // 1. Arrival rush: page + identity per guest.
  const bearers: string[] = new Array(args.guests);
  const t0 = performance.now();
  await inPool(
    Array.from({ length: args.guests }, (_, i) => async () => {
      await timed("arrival: GET party page", () => fetch(args.bases[i % args.bases.length]! + partyPath));
      const t = performance.now();
      try {
        bearers[i] = await signInAnonymous();
        record("arrival: anonymous sign-in", { ms: performance.now() - t, status: 200 });
      } catch {
        record("arrival: anonymous sign-in", { ms: performance.now() - t, status: 0 });
      }
    }),
    args.concurrency,
  );
  const signedIn = bearers.filter(Boolean);
  console.log(`[load] arrival: ${signedIn.length}/${args.guests} guests in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  if (signedIn.length === 0) throw new Error("no guest could sign in");
  if (args.fund) await fundWallets(signedIn);
  const auth = (i: number) => ({ authorization: `Bearer ${signedIn[i % signedIn.length]!}` });
  const baseOf = (i: number) => args.bases[i % args.bases.length]!;

  // Tracks to bid on.
  const search = await fetch(`${args.base}/api/guest/search?${q}&q=a`, { headers: auth(0) });
  if (!search.ok) throw new Error(`search ${search.status}: is the night live?`);
  const sections = ((await search.json()) as { sections: Array<{ tracks: Array<{ id: string }> }> }).sections;
  const trackIds = [...new Set(sections.flatMap((s) => s.tracks.map((t) => t.id)))];
  if (trackIds.length === 0) throw new Error("search returned no tracks");

  // 2. The night.
  const endAt = performance.now() + args.minutes * 60_000;
  const nightStart = performance.now();
  const lastAuctionRead = new Array<number>(signedIn.length).fill(0);
  const readAuction = (i: number) => {
    lastAuctionRead[i] = performance.now();
    return timed("night: GET auction state", () => fetch(`${baseOf(i)}/api/guest/auction?${q}`, { headers: auth(i) }));
  };
  const pendingHints: Array<Promise<unknown>> = [];
  const fanOutHint = () => {
    const at = performance.now();
    for (let i = 0; i < signedIn.length; i += 1) {
      if (at - lastAuctionRead[i]! < HINT_MIN_MS) continue;
      lastAuctionRead[i] = at;
      pendingHints.push(
        sleep(Math.random() * HINT_SPREAD_MS).then(() =>
          timed("night: GET auction board (hint)", () => fetch(`${baseOf(i)}/api/guest/auction/board?${q}`)),
        ),
      );
    }
  };
  const guestLoops = signedIn.map(async (_bearer, i) => {
    // Spread the first poll so the club does not start in lockstep.
    await sleep(Math.random() * args.pollMs);
    let nextState = performance.now() + Math.random() * STATE_POLL_MS;
    let nextSearch = performance.now() + Math.random() * SEARCH_EVERY_MS;
    while (performance.now() < endAt) {
      const tick = performance.now();
      await readAuction(i);
      if (tick >= nextState) {
        nextState += STATE_POLL_MS;
        await timed("night: GET session state", () => fetch(`${baseOf(i)}/api/guest/session-state?${q}`));
      }
      if (tick >= nextSearch) {
        nextSearch += SEARCH_EVERY_MS;
        const term = QUERIES[i % QUERIES.length]!;
        await timed("night: GET search", () => fetch(`${baseOf(i)}/api/guest/search?${q}&q=${term}`, { headers: auth(i) }));
      }
      await sleep(Math.max(0, args.pollMs - (performance.now() - tick)));
    }
  });

  const bidLoop = (async () => {
    const gapMs = 60_000 / Math.max(1, args.bids);
    let k = 0;
    let floorCents = 500;
    while (performance.now() < endAt) {
      const tick = performance.now();
      const state = (await (await fetch(`${baseOf(k)}/api/guest/auction?${q}`, { headers: auth(k) })).json()) as AuctionState;
      const slot = state.open?.[0];
      if (slot) {
        const guest = k;
        const totalCents = Math.max(floorCents, slot.minNextCents) + (k % 5) * 100;
        const res = await timed("night: POST bid", () =>
          fetch(`${baseOf(guest)}/api/guest/auction/bid`, {
            method: "POST",
            headers: { "content-type": "application/json", origin: baseOf(guest), ...auth(guest) },
            body: JSON.stringify({
              token,
              slotId: slot.id,
              totalCents,
              target: { kind: "own", trackId: trackIds[guest % trackIds.length] },
              display: { mode: "anonymous" },
              method: "mbway",
              phone: `+3519${String(10_000_000 + guest).slice(-8)}`,
              turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
            }),
          }),
        );
        if (res?.ok && args.hints === "refetch") fanOutHint();
        if (res && !res.ok) {
          const body = (await res.json().catch(() => ({}))) as { minCents?: number; error?: { code?: string } };
          if (body.minCents) floorCents = body.minCents;
          const code = body.error?.code ?? String(res.status);
          bidErrors.set(code, (bidErrors.get(code) ?? 0) + 1);
        }
      } else {
        record("night: POST bid (no open auction)", { ms: 0, status: 0 });
      }
      k += 1;
      await sleep(Math.max(0, gapMs - (performance.now() - tick)));
    }
  })();

  await Promise.all([...guestLoops, bidLoop]);
  await Promise.all(pendingHints);
  const elapsed = performance.now() - nightStart;
  console.log(`[load] night: ${(elapsed / 1000).toFixed(0)} s with ${signedIn.length} guests\n`);
  report(elapsed);
}

main().catch((e: unknown) => {
  console.error("[load] failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
