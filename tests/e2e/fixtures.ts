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
  const href = await page
    .locator('a[href^="/s/"]')
    .first()
    .getAttribute("href", { timeout: 10_000 });
  if (!href) throw new Error("Dev index has no guest link — is the DB seeded?");
  return href;
}

/** Same as getGuestUrl but through the API context (no browser page). */
export async function getGuestPath(request: APIRequestContext): Promise<string> {
  const html = await (await request.get("/")).text();
  const href = /href="(\/s\/[^"]+)"/.exec(html)?.[1];
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

export interface PaidRequest {
  requestId: string;
  paymentId: string;
  trackTitle: string;
  tier: "QUEUE" | "SOON" | "NEXT";
  amountCents: number;
  guest: AnonymousGuest;
}

/**
 * Full guest money path over the public API: quote → MB WAY request →
 * dev-panel confirmation (which delivers the SIGNED webhook through the
 * real `/api/webhooks/payments` route). Leaves a `paid` request waiting
 * for the DJ — exactly what the cockpit's "Decidir" column shows.
 */
export async function createPaidRequest(
  request: APIRequestContext,
  opts: { tier?: "QUEUE" | "SOON" | "NEXT"; token?: string; guest?: AnonymousGuest } = {},
): Promise<PaidRequest> {
  const tier = opts.tier ?? "QUEUE";
  const token = opts.token ?? tokenFromGuestPath(await getGuestPath(request));
  const guest = opts.guest ?? (await signInAnonymousGuest(request));
  const auth = { authorization: `Bearer ${guest.accessToken}` };

  const tracks = (await searchTracks(request, guest, token)).filter((t) => t.available);
  if (tracks.length === 0) throw new Error("no available tracks to request");

  // Try a few tracks: a tier can be unavailable (SOON full, NEXT taken)
  // or a track just got requested by someone else.
  let lastError = "unknown";
  for (const track of tracks.slice(0, 8)) {
    const quoteRes = await request.post("/api/guest/quotes", {
      headers: auth,
      data: { token, trackId: track.id },
    });
    if (!quoteRes.ok()) {
      lastError = `quote ${quoteRes.status()}`;
      continue;
    }
    const quote = (await quoteRes.json()) as {
      quoteId: string;
      tiers: Array<{ tier: string; priceCents: number; available: boolean }>;
    };
    const tierDto = quote.tiers.find((t) => t.tier === tier);
    if (!tierDto?.available) {
      lastError = `tier ${tier} unavailable`;
      if (tier !== "QUEUE") throw new Error(`tier ${tier} unavailable in this session`);
      continue;
    }

    const createRes = await request.post("/api/guest/requests", {
      headers: auth,
      data: {
        quoteId: quote.quoteId,
        tier,
        amountCents: tierDto.priceCents,
        method: "mbway",
        phone: "+351912345678",
        turnstileToken: "e2e-dev-always-pass",
      },
    });
    if (!createRes.ok()) {
      lastError = `create ${createRes.status()} ${await createRes.text()}`;
      continue;
    }
    const created = (await createRes.json()) as {
      requestId: string;
      payment: { paymentId: string };
    };

    const confirmRes = await request.post("/api/dev/psp", {
      headers: auth,
      data: { paymentId: created.payment.paymentId, action: "confirm" },
    });
    if (!confirmRes.ok()) {
      throw new Error(`dev PSP confirm failed (${confirmRes.status()})`);
    }

    // The webhook lands synchronously, but poll once in case of a slow DB.
    for (let i = 0; i < 10; i += 1) {
      const detail = await request.get(`/api/guest/requests/${created.requestId}`, {
        headers: auth,
      });
      const body = (await detail.json()) as { status: string };
      if (body.status === "paid") break;
      await new Promise((r) => setTimeout(r, 300));
    }

    return {
      requestId: created.requestId,
      paymentId: created.payment.paymentId,
      trackTitle: track.title,
      tier,
      amountCents: tierDto.priceCents,
      guest,
    };
  }
  throw new Error(`could not create a paid request: ${lastError}`);
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

  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByRole("textbox").first().fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: /entrar|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login") || url.pathname.startsWith("/login/mfa"), {
    timeout: 15_000,
  });

  if (page.url().includes("/login/mfa")) {
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
