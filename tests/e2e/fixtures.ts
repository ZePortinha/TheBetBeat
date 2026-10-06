/**
 * Shared E2E fixtures — mirrors supabase/seed.sql (fictional dev data).
 *
 * Everything here talks to the running app + local Supabase only through
 * public contracts: the dev index page, the guest/cockpit/dev APIs and
 * Supabase Auth. Service-role access is used for ONE thing — resetting a
 * staff account's TOTP factor so the MFA enrolment screen is
 * deterministic across runs (B12.3). It is read from `.env.local`.
 */
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";

export const SEED = {
  venueId: "aaaaaaaa-0000-4000-8000-000000000001",
  venueName: "Club Meridiano",
  sessionId: "dddddddd-0000-4000-8000-000000000001",
  sessionName: "Noite Meridiano",
  displaySlug: "display-dev",
  zones: {
    pista: { id: "bbbbbbbb-0000-4000-8000-000000000001", qrSlug: "zone-pista-dev" },
    bar: { id: "bbbbbbbb-0000-4000-8000-000000000002", qrSlug: "zone-bar-dev" },
  },
  staff: {
    dj: {
      userId: "11111111-1111-4111-8111-111111111111",
      email: "dj.helix@betbeat.local",
      password: "betbeat-dev",
      name: "DJ Helix",
      mfa: false,
    },
    manager: {
      userId: "33333333-3333-4333-8333-333333333333",
      email: "manager@betbeat.local",
      password: "betbeat-dev",
      name: "Rita Gestora",
      mfa: true,
    },
    admin: {
      userId: "44444444-4444-4444-8444-444444444444",
      email: "admin@betbeat.local",
      password: "betbeat-dev",
      name: "BetBeat Ops",
      mfa: true,
    },
  },
} as const;

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

/**
 * Minimal `.env.local` loader (no dotenv dependency). Playwright's own
 * process does not go through Next's env loading; the dev server does.
 * Never logs values.
 */
export function loadLocalEnv(): void {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function supabaseEnv(): { url: string; anonKey: string; serviceKey: string | null } {
  loadLocalEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing — copy .env.example to .env.local",
    );
  }
  return { url: url.replace(/\/$/, ""), anonKey, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null };
}

/* ------------------------------------------------------------------ */
/* Guest entry                                                         */
/* ------------------------------------------------------------------ */

/** Sign a dev QR token by asking the dev index page for its guest link. */
export async function getGuestUrl(page: Page): Promise<string> {
  await page.goto("/");
  // The dev link to the seeded zone (the live-events list links elsewhere).
  const href = await page.getByTestId("dev-guest-link").getAttribute("href", { timeout: 10_000 });
  if (!href) throw new Error("Dev index has no guest link — is the DB seeded?");
  return href;
}

/** Same as getGuestUrl but through the API context (no browser page). */
export async function getGuestPath(request: APIRequestContext): Promise<string> {
  const html = await (await request.get("/")).text();
  const href = /href="(\/s\/[^"]+)" data-testid="dev-guest-link"/.exec(html)?.[1];
  if (!href) throw new Error("Dev index has no guest link — is the DB seeded?");
  return href;
}

export function tokenFromGuestPath(guestPath: string): string {
  return decodeURIComponent(guestPath.replace(/^\/s\//, "").split("/")[0] ?? "");
}

/* ------------------------------------------------------------------ */
/* Anonymous guest + API-driven requests                               */
/* ------------------------------------------------------------------ */

export interface AnonymousGuest {
  guestId: string;
  accessToken: string;
}

/**
 * Creates an anonymous Supabase session (B6 "Identidade sem registo")
 * straight against Supabase Auth, so API-driven test guests behave
 * exactly like a browser guest (same `auth.uid()` ownership and RLS).
 */
export async function signInAnonymousGuest(request: APIRequestContext): Promise<AnonymousGuest> {
  const { url, anonKey } = supabaseEnv();
  const res = await request.post(`${url}/auth/v1/signup`, {
    headers: { apikey: anonKey, "content-type": "application/json" },
    data: { data: {} },
  });
  if (!res.ok()) {
    throw new Error(`anonymous sign-in failed (${res.status()}) — enable anonymous sign-ins`);
  }
  const body = (await res.json()) as { access_token: string; user: { id: string } };
  return { guestId: body.user.id, accessToken: body.access_token };
}

export interface SearchTrack {
  id: string;
  title: string;
  artist: string;
  available: boolean;
}

export async function searchTracks(
  request: APIRequestContext,
  guest: AnonymousGuest,
  token: string,
  q = "",
): Promise<SearchTrack[]> {
  const qs = new URLSearchParams({ token });
  if (q) qs.set("q", q);
  const res = await request.get(`/api/guest/search?${qs}`, {
    headers: { authorization: `Bearer ${guest.accessToken}` },
  });
  if (!res.ok()) throw new Error(`search failed (${res.status()})`);
  const data = (await res.json()) as { sections: Array<{ tracks: SearchTrack[] }> };
  return data.sections.flatMap((s) => s.tracks);
}

/* ------------------------------------------------------------------ */
/* Slot auctions (dev-only driver: /api/dev/auction)                   */
/* ------------------------------------------------------------------ */

/** A live seeded night with one fresh open auction closing in N seconds. */
export async function openAuction(request: APIRequestContext, closesInSec = 240): Promise<string> {
  const res = await request.post("/api/dev/auction", {
    data: { action: "open", sessionId: SEED.sessionId, closesInSec },
  });
  if (!res.ok()) throw new Error(`dev auction open failed (${res.status()})`);
  return ((await res.json()) as { slotId: string }).slotId;
}

/** Ends that auction now and runs one worker tick (winner locked or no winner). */
export async function closeAuction(request: APIRequestContext, slotId: string): Promise<void> {
  const res = await request.post("/api/dev/auction", { data: { action: "close", slotId } });
  if (!res.ok()) throw new Error(`dev auction close failed (${res.status()})`);
}

export interface ApiBid {
  guest: AnonymousGuest;
  trackId: string;
}

/**
 * One bid through the public guest API, paid with the (mock) card so it
 * is placed at once. A second guest outbidding the UI guest is just this.
 */
export async function bidViaApi(
  request: APIRequestContext,
  opts: {
    slotId: string;
    totalCents: number;
    guest?: AnonymousGuest;
    trackId?: string;
    backBidId?: string;
    handle?: string;
    token?: string;
  },
): Promise<ApiBid> {
  const token = opts.token ?? tokenFromGuestPath(await getGuestPath(request));
  const guest = opts.guest ?? (await signInAnonymousGuest(request));
  const trackId =
    opts.trackId ?? (await searchTracks(request, guest, token)).filter((t) => t.available).at(-1)?.id ?? "";
  const res = await request.post("/api/guest/auction/bid", {
    headers: { authorization: `Bearer ${guest.accessToken}` },
    data: {
      token,
      slotId: opts.slotId,
      totalCents: opts.totalCents,
      target: opts.backBidId ? { kind: "back", bidId: opts.backBidId } : { kind: "own", trackId },
      display: opts.handle ? { mode: "handle", handle: opts.handle } : { mode: "anonymous" },
      method: "card",
      turnstileToken: "e2e-dev-always-pass",
    },
  });
  if (!res.ok()) throw new Error(`bid failed (${res.status()}): ${await res.text()}`);
  return { guest, trackId };
}

/** The public auction state (+ the guest's own part when signed in). */
export async function auctionState(
  request: APIRequestContext,
  guest?: AnonymousGuest,
): Promise<{
  open: Array<{ id: string; minNextCents: number; top: { bidId: string; totalCents: number } | null }>;
  me: { walletCents: number; bids: Array<{ slotId: string; status: string }> } | null;
  upNext: { slotId: string } | null;
}> {
  const token = tokenFromGuestPath(await getGuestPath(request));
  const res = await request.get(`/api/guest/auction?token=${encodeURIComponent(token)}`, {
    headers: guest ? { authorization: `Bearer ${guest.accessToken}` } : {},
  });
  if (!res.ok()) throw new Error(`auction state failed (${res.status()})`);
  return res.json();
}

/* ------------------------------------------------------------------ */
/* Staff login (+ TOTP MFA for managers/admins)                        */
/* ------------------------------------------------------------------ */

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — what Supabase Auth issues. */
export function totp(secretBase32: string, at = Date.now()): string {
  const counter = Math.floor(at / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

/**
 * Removes every TOTP factor of a seeded staff user so `/login/mfa` shows
 * the enrolment secret (which the test reads to compute codes). Needs
 * the service-role key; without it the test can only pass on a fresh DB.
 */
async function resetMfaFactors(request: APIRequestContext, userId: string): Promise<void> {
  const { url, serviceKey } = supabaseEnv();
  if (!serviceKey) return;
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
  const list = await request.get(`${url}/auth/v1/admin/users/${userId}/factors`, { headers });
  if (!list.ok()) return;
  const factors = (await list.json()) as Array<{ id: string }>;
  for (const f of factors) {
    await request.delete(`${url}/auth/v1/admin/users/${userId}/factors/${f.id}`, { headers });
  }
}

export async function loginStaff(
  page: Page,
  who: keyof typeof SEED.staff,
  next = "/cockpit",
): Promise<void> {
  const account = SEED.staff[who];
  if (account.mfa) await resetMfaFactors(page.request, account.userId);

  // The login limiter is per IP (10 / 10 min); every test is a fresh "visitor".
  const ip = Array.from({ length: 4 }, () => Math.floor(Math.random() * 254) + 1).join(".");
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });

  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByRole("textbox").first().fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: /entrar|sign in/i }).click();
  // Managers/admins always end on /login/mfa; waiting for "anything but /login"
  // would resolve mid-redirect (/console → /login/mfa) and skip the MFA step.
  await page.waitForURL(
    (url) =>
      account.mfa
        ? url.pathname.startsWith("/login/mfa")
        : !url.pathname.startsWith("/login"),
    { timeout: 15_000 },
  );

  if (account.mfa) {
    // Enrolment shows the base32 secret under the QR; verify mode does not.
    const secretEl = page.locator("p.break-all");
    await page.locator('input[inputmode="numeric"]').waitFor({ timeout: 15_000 });
    const secret = (await secretEl.count()) > 0 ? (await secretEl.first().textContent())?.trim() : null;
    if (!secret) {
      throw new Error(
        `${account.email} already has a TOTP factor and no service-role key is available to reset it — set SUPABASE_SERVICE_ROLE_KEY in .env.local or run pnpm db:reset`,
      );
    }
    await page.locator('input[inputmode="numeric"]').fill(totp(secret));
    await page.getByRole("button", { name: /verificar|verify/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
  }
}
