# BetBeat

Guests at a nightclub pay to request songs from the DJ, choosing how long they are
willing to wait (dynamic pricing). The DJ always decides what plays; if a song does
not play, the guest is automatically refunded. One Next.js app serves four surfaces:

| Surface | Route | Device |
| --- | --- | --- |
| Guest app (PWA, pt-PT + EN) | `/s/[qrToken]` | phone, 393×852 |
| DJ cockpit (PWA, offline-capable) | `/cockpit` | iPad landscape, 1194×834 |
| Venue display | `/display/[token]` | TV 1920×1080 / 1080×1920 |
| Venue panel + BetBeat admin | `/console` | desktop, 1440×900 |

The product specification is `BETBEAT_BRIEF.md` (source of truth). Progress and
decisions live in `docs/PROGRESS.md` and `docs/DECISIONS.md`; the security
posture in `docs/SECURITY.md`; how to run a night in `docs/OPERATIONS.md`.

## Setup

Requirements: Node 20+, pnpm 12, Docker (for local Supabase), Supabase CLI,
optionally `gitleaks` (pre-commit secrets scan).

```bash
pnpm install                 # also installs the git pre-commit hook
cp .env.example .env.local   # then fill in the values below
supabase start               # local Postgres + Auth + Realtime
pnpm db:reset                # migrations + fictional seed
pnpm dev                     # http://localhost:3000 (dev index with entry links)
pnpm worker                  # deadlines, refunds, payouts, reconciliation
```

Open `http://localhost:3000`: the dev index links to the guest app (signed QR of
the seeded "Pista" zone), the cockpit, the display and the console. Seeded staff
logins (local only, password `betbeat-dev`): `dj.helix@betbeat.local` (DJ),
`manager@betbeat.local` (manager, TOTP MFA enrolled on first login),
`admin@betbeat.local` (BetBeat admin).

### Environment variables

All server variables are validated at boot by `lib/security/env.ts` (zod); the
app refuses to start if one is missing. Only `NEXT_PUBLIC_*` values reach the
browser. Never commit `.env.local`.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Public base URL (QR links, share cards, webhook self-delivery in dev) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project + public key (RLS is the boundary) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only: route handlers, server actions, worker |
| `DATABASE_URL` | Direct Postgres connection (domain services, worker, `db:audit`) |
| `QR_TOKEN_SECRET` | HMAC key for signed QR / display tokens (32+ bytes) |
| `DATA_ENCRYPTION_KEY` | AES-256-GCM key (base64, 32 bytes) for phones, emails, payout data |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile (dev: always-pass test keys) |
| `PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET` | `mock` until Phase 8; webhook HMAC secret |
| `SMS_PROVIDER`, `EMAIL_PROVIDER`, `INVOICING_PROVIDER`, `CATALOG_PROVIDER` | `mock` adapters behind interfaces |
| `SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Optional observability (Phase 8) |
| `WORKER_*` | Optional worker knobs (intervals, crons, retry policy), see `worker/env.ts` |

### Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js (Turbopack in dev) |
| `pnpm worker` | pg-boss worker: second-precision deadlines, refunds, payouts, reconciliation, weekly genre job |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | TypeScript strict, ESLint, Prettier |
| `pnpm test` | Vitest unit + property tests (pricing, state machine, ledger, payments, worker) |
| `SUPABASE_TEST=1 pnpm test` | Integration tests against local Supabase (transitions, RLS matrix, worker jobs) |
| `pnpm test:e2e` | Playwright (phone, iPad, TV, desktop projects) + axe |
| `pnpm storybook` | Component library with every state |
| `pnpm db:reset` / `pnpm db:audit` | Migrations + seed / RLS and privilege audit (B12.7) |
| `pnpm simulate` | Fictional guests paying for requests in real time (demo + cockpit testing) |
| `pnpm exec tsx scripts/load-test.ts` | Load test against B11 targets |
| `pnpm i18n:check` | Every `t("…")` key exists in `messages/` (no DB) |
| `pnpm exec tsx scripts/screenshot.ts <url> <out.png> [WxH] [--slow]` | Screenshots for the visual review |

## Architecture

```
app/(guest)   app/(cockpit)   app/(display)   app/(console)      ← 4 surfaces (App Router)
app/api/guest  app/api/cockpit  app/api/display  app/api/webhooks ← route handlers (zod allowlists)
          │                │
          ▼                ▼
lib/domain  ── state machine (pure, `now` injected) + services (transactions, events, broadcasts)
lib/pricing ── computeQuote: pure, deterministic, property-tested
lib/payments ─ PaymentProvider interface + MockPaymentProvider (+ signed webhooks)
lib/ledger ─── double-entry, immutable, zero-sum groups; balances derived
lib/security ─ env, signed tokens, rate limit, Turnstile, AES-GCM, staff gate (MFA)
lib/realtime ─ server-published Broadcast envelopes on authorized channels
worker/ ────── pg-boss: deadlines (5 s loop), refund retry, payouts, reconciliation, M_g
supabase/ ──── schema + RLS (every table, default deny) + fictional seed
```

**Principles that shape the code**

- State transitions happen only on the server, through `lib/domain/machine.ts`
  (pure) applied by `lib/domain/service.ts` inside a transaction with a row lock.
  Every transition writes a `request_events` row and an `audit_log` row, then
  publishes pre-filtered realtime events (staff channel, guest channel, public
  channel). Clients never subscribe to table changes.
- Clients never send prices. The guest sends a `quoteId`; the server re-validates
  the persisted quote (120 s TTL), reserves the slot under a lock (a `NEXT` slot
  can never be sold twice) and fixes the price when payment starts.
- Money is integer cents. Refunds are exactly-once through an idempotency key per
  request and reason; webhooks are HMAC-verified and deduplicated.
- Deadlines expire only on the server (worker scans with `SKIP LOCKED`); the UI
  rings are display only.
- The cockpit is optimistic with rollback, keeps an ordered offline action queue
  (replayed with idempotency keys on reconnect) and never sends a reject or
  cancel before its 5 s "Desfazer" window closes.
- Identity: guests are Supabase anonymous users (owner of their quotes and
  requests through RLS); staff sign in with email and TOTP MFA (managers, admins).

### Request lifecycle

```
pending_payment ──(payment confirmed)──► paid ──(DJ accepts)──► accepted ──► playing ──► played
      │ payment_timeout                   │ dj_timeout / rejected_by_dj      │ cancelled_by_dj
      ▼                                   ▼                                  ▼
   expired                             refunded (full)                   refunded (full)
```

A `SOON` or `NEXT` promise that is missed (`sla_missed`) demotes the request to
`QUEUE` and refunds the difference immediately; the request stays in the queue.
Ending the set refunds everything that did not play. All of it is automatic.

## Pricing engine (`lib/pricing`)

`computeQuote(input, now)` is a pure function: no I/O, deterministic, fully
tested (unit + fast-check). The quote service around it adds the id and expiry
and persists every quote, so conversion can be measured.

Inputs: session base price `B` (10 € default), acceptance rate `R` (8/h default),
the active queue, the track (genre, BPM, key), the set context (last 5 tracks),
the venue's genre multipliers `M_g` and the last published factors (smoothing).

```
rho = activeRequests / R                      hours of queue (demand level)
D   = clamp(0.85 + 0.5·rho, 0.85, 2.0)        demand factor
S   = 0.5·s_genre + 0.35·s_bpm + 0.15·s_key   musical fit in [0, 1]
F   = 1 + 0.5·(1 − S)                         off-style costs up to +50 %
P_queue = B · M_g · F · D
P_soon  = P_queue · 2.0 · (1 + o²)            o = activeSoon / C_s,  C_s = max(1, ⌊R·20/60⌋)
P_next  = P_queue · 3.5                       only when no NEXT is active
```

Then, in order: smooth (factors move at most ±15 % per minute), clamp to the tier
limits (defaults QUEUE 5–60 €, SOON 15–120 €, NEXT 25–200 €), round (to the euro
below 20 €, to 5 € from 20 €), enforce the guaranteed order (each tier at least
5 € above the previous) and validate (never NaN, negative or out of range).

**Worked example (the mandatory test in `lib/pricing/compute.test.ts`)**

B = 10 €, M_g = 1, S = 0.9, 3 active requests, R = 8, 1 active SOON (C_s = 2):

| | value |
| --- | --- |
| rho | 3 / 8 = 0.375 |
| D | 0.85 + 0.5 · 0.375 = 1.0375 |
| F | 1 + 0.5 · 0.1 = 1.05 |
| QUEUE | 10 · 1 · 1.05 · 1.0375 = 10.89 → **11 €** |
| SOON | 10.89 · 2 · (1 + 0.25) = 27.23 → **25 €** |
| NEXT | 10.89 · 3.5 = 38.13 → **40 €** |

ETA per tier uses the interval `i = 60 / R` minutes: `NEXT` is the remaining time
of the current track, `SOON` is `(nNext + position) · i`, `QUEUE` is
`(nNext + nSoon + position) · i`, displayed as "~X min". Inside a tier, requests
less than 5 minutes from missing their promise go first, then
`amount × (1 + 0.01 · minutesWaiting)` so old requests are never forgotten.

The console's pricing page has a live simulator (B, R, active requests,
occupancy, genre, fit) showing the three prices and the breakdown.

## Testing

- `pnpm test`: 393 unit and property tests, no database needed.
- `SUPABASE_TEST=1 pnpm test`: integration tests (every transition and close
  reason, exactly-once refunds with duplicate webhooks, the `NEXT` concurrency
  test, ledger balance, RLS access matrix for every table and role).
- `pnpm test:e2e`: Playwright specs per surface (`tests/e2e/*.spec.ts`), each
  scoped to its viewport project. `E2E_END_SET=1` enables the destructive
  "Terminar set" test (run it last, or `pnpm db:reset` afterwards).
- Screenshots for the B10 review are produced with `scripts/screenshot.ts` and
  kept in `docs/screens/`.

## Conventions

Code, names, comments and commits in English. UI copy in pt-PT (plus EN on the
guest app), always in `messages/<locale>/*.json`. Money in integer cents, time in
UTC, displayed in Europe/Lisbon. `now` is injected everywhere in domain code.
Only fictional data. Forbidden words in the UI: "aposta", "apostar", "odds",
"ganhar" (BetBeat is not gambling: the outcome is deterministic and refunded).
