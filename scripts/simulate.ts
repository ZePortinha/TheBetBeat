/**
 * Simulated guests (BRIEF B11 scripts: `pnpm simulate`) — demos and
 * cockpit testing. Fictional guests scan the dev zone QR, search, get a
 * quote, pay by MB WAY and confirm (or decline / let it expire) through
 * the dev PSP panel, which drives the REAL signed-webhook path. Nothing
 * here bypasses the public API: what the cockpit shows is exactly what
 * real guests would produce.
 *
 *   pnpm simulate                     # 6 requests/min for 10 min
 *   pnpm simulate --rate 20 --guests 30 --minutes 3
 *   pnpm simulate --rate 50 --minutes 1 --fail 0.2   # stress (B11: 50/min)
 *
 * Options:
 *   --base <url>      app base URL (default http://localhost:3000)
 *   --rate <n>        requests per minute (default 6)
 *   --guests <n>      size of the fictional guest pool (default 12)
 *   --minutes <n>     how long to run; 0 = until Ctrl+C (default 10)
 *   --fail <0..1>     share of MB WAY declines/expiries (default 0.1)
 *   --delay <ms>      guest "thinking" time before confirming (default 1500)
 *   --tiers q,s,n     tier weights QUEUE,SOON,NEXT (default 70,25,5)
 *
 * Requires: supabase + `pnpm dev` (+ `pnpm worker` for deadlines) running
 * and `.env.local` (Supabase URL + anon key) — read here without dotenv.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface Args {
  base: string;
  rate: number;
  guests: number;
  minutes: number;
  fail: number;
  delay: number;
  tiers: [number, number, number];
}

type Tier = "QUEUE" | "SOON" | "NEXT";
const TIERS: Tier[] = ["QUEUE", "SOON", "NEXT"];

interface Guest {
  index: number;
  accessToken: string;
  phone: string;
}

interface Stats {
  attempted: number;
  paid: number;
  declined: number;
  expired: number;
  unavailable: number;
  errors: number;
  rateLimited: number;
  byTier: Record<Tier, number>;
  webhookMs: number[];
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 && a[i + 1] !== undefined ? a[i + 1]! : d;
  };
  const tiers = get("tiers", "70,25,5")
    .split(",")
    .map((n) => Math.max(0, Number(n) || 0));
  return {
    base: get("base", "http://localhost:3000").replace(/\/$/, ""),
    rate: Math.max(0.1, Number(get("rate", "6"))),
    guests: Math.max(1, Math.floor(Number(get("guests", "12")))),
    minutes: Math.max(0, Number(get("minutes", "10"))),
    fail: Math.min(1, Math.max(0, Number(get("fail", "0.1")))),
    delay: Math.max(0, Number(get("delay", "1500"))),
    tiers: [tiers[0] ?? 70, tiers[1] ?? 25, tiers[2] ?? 5],
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function weightedTier(weights: [number, number, number]): Tier {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let r = Math.random() * total;
  for (let i = 0; i < TIERS.length; i += 1) {
    r -= weights[i]!;
    if (r <= 0) return TIERS[i]!;
  }
  return "QUEUE";
}

function fmtEur(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

async function signInAnonymous(supabaseUrl: string, anonKey: string): Promise<string> {
  const res = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ data: {} }),
  });
  if (!res.ok) {
    throw new Error(`anonymous sign-in failed (${res.status}) — enable anonymous sign-ins in supabase/config.toml`);
  }
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

async function api<T>(
  args: Args,
  guest: Guest,
  method: "GET" | "POST",
  pathname: string,
  body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; status: number; code: string }> {
  const res = await fetch(args.base + pathname, {
    method,
    headers: {
      authorization: `Bearer ${guest.accessToken}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const code = (json as { error?: { code?: string } | string } | null)?.error;
    return {
      ok: false,
      status: res.status,
      code: typeof code === "string" ? code : (code?.code ?? "generic"),
    };
  }
  return { ok: true, data: json as T };
}

interface SearchTrack {
  id: string;
  title: string;
  artist: string;
  available: boolean;
}

async function oneRequest(args: Args, token: string, guest: Guest, stats: Stats): Promise<void> {
  stats.attempted += 1;
  const tag = `g${String(guest.index).padStart(2, "0")}`;

  // 1. Search — sometimes by a letter (like a real thumb), sometimes the curated sections.
  const q = Math.random() < 0.5 ? pick(["a", "e", "o", "ne", "so", "mi", "vel"]) : "";
  const qs = new URLSearchParams({ token });
  if (q) qs.set("q", q);
  const search = await api<{ sections: Array<{ tracks: SearchTrack[] }> }>(
    args,
    guest,
    "GET",
    `/api/guest/search?${qs}`,
  );
  if (!search.ok) {
    if (search.status === 429) stats.rateLimited += 1;
    else stats.errors += 1;
    console.log(`${stamp()} ${tag} search failed: ${search.code}`);
    return;
  }
  const tracks = search.data.sections.flatMap((s) => s.tracks).filter((t) => t.available);
  if (tracks.length === 0) {
    stats.unavailable += 1;
    console.log(`${stamp()} ${tag} nothing available to request`);
    return;
  }
  const track = pick(tracks);

  // 2. Quote (persisted, 120 s).
  const quote = await api<{
    quoteId: string;
    tiers: Array<{ tier: Tier; priceCents: number; available: boolean; maxCents: number }>;
  }>(args, guest, "POST", "/api/guest/quotes", { token, trackId: track.id });
  if (!quote.ok) {
    if (quote.status === 429) stats.rateLimited += 1;
    else stats.errors += 1;
    console.log(`${stamp()} ${tag} quote failed: ${quote.code}`);
    return;
  }

  // 3. Tier: weighted wish, falling back to whatever is available.
  const wish = weightedTier(args.tiers);
  const available = quote.data.tiers.filter((t) => t.available);
  const tierDto =
    quote.data.tiers.find((t) => t.tier === wish && t.available) ?? available[0];
  if (!tierDto) {
    stats.unavailable += 1;
    console.log(`${stamp()} ${tag} no tier available for ${track.title}`);
    return;
  }
  // Free extra value (B4.1): one guest in four tips 1–5 € above the price.
  const extra = Math.random() < 0.25 ? 100 * (1 + Math.floor(Math.random() * 5)) : 0;
  const amountCents = Math.min(tierDto.maxCents, tierDto.priceCents + extra);

  // 4. MB WAY request (Turnstile dev keys always pass).
  const created = await api<{ requestId: string; payment: { paymentId: string } }>(
    args,
    guest,
    "POST",
    "/api/guest/requests",
    {
      quoteId: quote.data.quoteId,
      tier: tierDto.tier,
      amountCents,
      method: "mbway",
      phone: guest.phone,
      turnstileToken: "simulate-dev",
    },
  );
  if (!created.ok) {
    if (created.status === 429) stats.rateLimited += 1;
    else if (["guest_limit", "spend_limit", "already_requested", "tier_unavailable", "requests_closed"].includes(created.code)) {
      stats.unavailable += 1;
    } else stats.errors += 1;
    console.log(`${stamp()} ${tag} request refused: ${created.code}`);
    return;
  }

  // 5. The guest looks at their phone… then confirms, declines or forgets.
  await sleep(args.delay * (0.5 + Math.random()));
  const roll = Math.random();
  const action = roll < args.fail / 2 ? "decline" : roll < args.fail ? "expire" : "confirm";
  const t0 = performance.now();
  const psp = await api<{ deliveries: Array<{ status: number }> }>(
    args,
    guest,
    "POST",
    "/api/dev/psp",
    { paymentId: created.data.payment.paymentId, action },
  );
  const webhookMs = performance.now() - t0;
  if (!psp.ok) {
    stats.errors += 1;
    console.log(`${stamp()} ${tag} psp ${action} failed: ${psp.code}`);
    return;
  }
  if (action === "confirm") {
    stats.paid += 1;
    stats.byTier[tierDto.tier] += 1;
    stats.webhookMs.push(webhookMs);
  } else if (action === "decline") stats.declined += 1;
  else stats.expired += 1;

  console.log(
    `${stamp()} ${tag} ${action.padEnd(7)} ${tierDto.tier.padEnd(5)} ${fmtEur(amountCents).padStart(9)}  ${track.title} · ${track.artist}  (webhook ${webhookMs.toFixed(0)} ms)`,
  );
}

function summary(stats: Stats, startedAt: number): void {
  const mins = (Date.now() - startedAt) / 60_000;
  const sorted = [...stats.webhookMs].sort((a, b) => a - b);
  const p = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : NaN);
  console.log("");
  console.log(`[simulate] ${mins.toFixed(1)} min · attempted ${stats.attempted} · paid ${stats.paid} ` +
    `(QUEUE ${stats.byTier.QUEUE} / SOON ${stats.byTier.SOON} / NEXT ${stats.byTier.NEXT}) · ` +
    `declined ${stats.declined} · expired ${stats.expired} · unavailable ${stats.unavailable} · ` +
    `rate-limited ${stats.rateLimited} · errors ${stats.errors}`);
  if (sorted.length) {
    console.log(`[simulate] confirm → webhook round-trip: p50 ${p(0.5).toFixed(0)} ms · p95 ${p(0.95).toFixed(0)} ms ` +
      `(B1.5 target: < 1 s from confirmed payment to the cockpit alert)`);
  }
}

async function main() {
  const args = parseArgs();
  loadLocalEnv();
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!supabaseUrl || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing (.env.local)");
  }
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(args.base) && !process.argv.includes("--not-local")) {
    throw new Error(`refusing to simulate against ${args.base} (dev-only; pass --not-local if you really mean it)`);
  }

  console.log(`[simulate] base=${args.base} rate=${args.rate}/min guests=${args.guests} minutes=${args.minutes || "∞"} fail=${args.fail}`);

  // Dev index → signed zone QR token (never forged client-side, B4.7).
  const indexHtml = await (await fetch(`${args.base}/`)).text();
  const guestPath = /href="(\/s\/[^"]+)"/.exec(indexHtml)?.[1];
  if (!guestPath) throw new Error("dev index has no guest link — is the DB seeded and the session live?");
  const token = decodeURIComponent(guestPath.replace("/s/", ""));

  // Fictional guest pool: each one is a real anonymous Supabase user.
  const guests: Guest[] = [];
  for (let i = 0; i < args.guests; i += 1) {
    guests.push({
      index: i + 1,
      accessToken: await signInAnonymous(supabaseUrl, anonKey),
      phone: `+3519${String(10_000_000 + Math.floor(Math.random() * 89_999_999))}`,
    });
  }
  console.log(`[simulate] ${guests.length} anonymous guests ready`);

  const stats: Stats = {
    attempted: 0, paid: 0, declined: 0, expired: 0, unavailable: 0, errors: 0, rateLimited: 0,
    byTier: { QUEUE: 0, SOON: 0, NEXT: 0 },
    webhookMs: [],
  };
  const startedAt = Date.now();
  const deadline = args.minutes > 0 ? startedAt + args.minutes * 60_000 : Infinity;
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    console.log("\n[simulate] stopping…");
  });

  const intervalMs = 60_000 / args.rate;
  const inflight = new Set<Promise<void>>();
  while (!stopping && Date.now() < deadline) {
    const guest = pick(guests);
    const run = oneRequest(args, token, guest, stats)
      .catch((e: unknown) => {
        stats.errors += 1;
        console.log(`${stamp()} error: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => inflight.delete(run));
    inflight.add(run);
    // Poisson-ish spacing around the target rate (real crowds are lumpy).
    await sleep(intervalMs * (0.4 + Math.random() * 1.2));
  }
  await Promise.all(inflight);
  summary(stats, startedAt);
}

main().catch((e: unknown) => {
  console.error("[simulate] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
