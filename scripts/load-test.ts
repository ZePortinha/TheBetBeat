/**
 * Load test (B11 targets: 1000 guests, 50 requests/min per session;
 * quote p95 < 150ms). No external deps — plain fetch + timing.
 *
 * Usage: pnpm exec tsx scripts/load-test.ts [--base http://localhost:3000]
 *        [--guests 200] [--quotes 500] [--concurrency 25]
 * Requires: supabase + dev server (production build recommended) running,
 * plus `.env.local` (Supabase URL + anon key) — read here without dotenv.
 * Guest routes need an anonymous guest identity (B6): each simulated
 * guest signs in anonymously and sends its bearer token.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface Args {
  base: string;
  guests: number;
  quotes: number;
  concurrency: number;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 ? a[i + 1]! : d;
  };
  return {
    base: get("base", "http://localhost:3000"),
    guests: Number(get("guests", "200")),
    quotes: Number(get("quotes", "500")),
    concurrency: Number(get("concurrency", "25")),
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

async function signInAnonymous(): Promise<string> {
  loadLocalEnv();
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

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

async function timeIt(fn: () => Promise<Response>): Promise<{ ms: number; ok: boolean; status: number }> {
  const t0 = performance.now();
  try {
    const res = await fn();
    // Drain the body so keep-alive sockets are reusable.
    await res.arrayBuffer().catch(() => undefined);
    return { ms: performance.now() - t0, ok: res.ok, status: res.status };
  } catch {
    return { ms: performance.now() - t0, ok: false, status: 0 };
  }
}

async function pool<T>(
  items: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await items[idx]!();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function main() {
  const args = parseArgs();
  console.log(`[load] base=${args.base} guests=${args.guests} quotes=${args.quotes} conc=${args.concurrency}`);

  // 1. Grab a signed guest URL + a track list from the dev index + search API.
  const indexHtml = await (await fetch(args.base + "/")).text();
  const guestPath = indexHtml.match(/href="(\/s\/[^"]+)"/)?.[1];
  if (!guestPath) throw new Error("No guest link on dev index — DB seeded? dev server up?");
  const token = decodeURIComponent(guestPath.replace("/s/", ""));

  // A pool of anonymous guests so per-guest rate limits (B4.7) spread out.
  const guestTokens: string[] = [];
  for (let i = 0; i < Math.min(args.concurrency, 50); i += 1) {
    guestTokens.push(await signInAnonymous());
  }
  const authFor = (i: number) => ({
    authorization: `Bearer ${guestTokens[i % guestTokens.length]!}`,
  });

  const searchRes = await fetch(
    `${args.base}/api/guest/search?token=${encodeURIComponent(token)}&q=a`,
    { headers: authFor(0) },
  );
  if (!searchRes.ok) throw new Error(`search API ${searchRes.status} — guest surface deployed?`);
  const search = (await searchRes.json()) as { results?: Array<{ id: string }> };
  const trackIds = (search.results ?? []).map((r) => r.id);
  if (trackIds.length === 0) throw new Error("search returned no tracks");

  // 2. Session-screen loads (simulates guests scanning).
  const guestLoads = Array.from({ length: args.guests }, () => () =>
    timeIt(() => fetch(args.base + guestPath)),
  );
  const loadResults = await pool(guestLoads, args.concurrency);

  // 3. Quote hammering (p95 target < 150ms server-side; we measure end-to-end).
  const quoteCalls = Array.from({ length: args.quotes }, (_, i) => () =>
    timeIt(() =>
      fetch(`${args.base}/api/guest/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authFor(i) },
        body: JSON.stringify({ token, trackId: trackIds[i % trackIds.length] }),
      }),
    ),
  );
  const quoteResults = await pool(quoteCalls, args.concurrency);

  for (const [name, results] of [
    ["guest page", loadResults],
    ["POST quote", quoteResults],
  ] as const) {
    const ok = results.filter((r) => r.ok).length;
    const rate429 = results.filter((r) => r.status === 429).length;
    const times = results.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
    console.log(
      `[load] ${name}: ${ok}/${results.length} ok (${rate429} rate-limited) ` +
        `p50=${pct(times, 50).toFixed(0)}ms p95=${pct(times, 95).toFixed(0)}ms ` +
        `p99=${pct(times, 99).toFixed(0)}ms`,
    );
  }
  console.log("[load] NOTE: rate limits are part of the design (B4.7); run with");
  console.log("[load] RATE_LIMIT_RELAXED or spread across IPs for raw throughput.");
}

main().catch((e) => {
  console.error("[load] failed:", e.message);
  process.exit(1);
});
