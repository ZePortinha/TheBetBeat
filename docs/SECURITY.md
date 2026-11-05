# Security

How each point of DISCONTROL_BRIEF.md §B12 is met, where to look, and what is
verified automatically. Summary for every session: `.claude/rules/security.md`.

## B12.1 Secrets and keys

| Requirement | Implementation |
| --- | --- |
| Nothing in code: all keys from env, validated at boot | `lib/security/env.ts` (zod schema, `server-only`); the app throws before serving if a variable is missing or malformed. `worker/env.ts` validates the worker's own knobs the same way. |
| Nothing in git | `.gitignore` excludes `.env*` except `.env.example` (placeholders only, commented). `scripts/install-hooks.mjs` installs a pre-commit hook running `gitleaks protect --staged`, `pnpm lint` and `pnpm typecheck` (prints a warning when gitleaks is not installed). |
| Service-role key server only | Used only by `lib/supabase/admin.ts` and `lib/db.ts` callers; every module that touches it imports `server-only`, so a client import fails the build. Never `NEXT_PUBLIC_*`. |
| Client gets the public key only | `lib/security/public-env.ts` exposes only `NEXT_PUBLIC_*` values. RLS is the boundary (B12.2 tests). |

If a secret is ever committed: rotate it immediately (Supabase keys, `QR_TOKEN_SECRET`
invalidates every printed QR, `DATA_ENCRYPTION_KEY` requires re-encrypting
stored phones/emails/payout data) and rewrite history.

## B12.2 Database and access

| Requirement | Implementation |
| --- | --- |
| RLS on every table, default deny | `supabase/migrations/00000000000002_rls.sql` enables RLS on all 19 `public` tables; without a policy nothing is readable or writable. |
| Policies scoped by owner or venue role | Helpers `has_venue_role(venue, roles[])`, `is_platform_admin()`, `session_venue()` (SECURITY DEFINER, pinned `search_path`). Guest rows use `auth.uid() = guest_id`; staff policies always check the venue role, never bare `authenticated` (anonymous guests are `authenticated` too). No `USING (true)` anywhere; the only public reads are the display's public DTO built server-side. |
| Money and audit tables: server only | `payments`, `refunds`, `ledger_entries`, `payouts`, `invoices`, `audit_log` have no client policies at all; writes go through `lib/domain/service.ts` and `lib/ledger` with the service role. `ledger_entries` rejects UPDATE/DELETE by trigger (immutable). |
| Least privilege per role | DJs read their session's requests and never venue finances; managers see their venues; platform admins (staff row with `venue_id IS NULL`) see all. `app/api/cockpit/_lib/auth.ts` and `app/(console)/console/_lib/context.ts` resolve the venue server-side; the client never sends `venue_id`. |
| No mass assignment | At the database: RLS picks the rows, column grants pick the columns (migration 0014). Clients may write only `guests(id, locale)`, `venues(name)`, `zones(venue_id, name)` and `genre_multipliers(multiplier, auto_apply)`; `db:audit` fails on any other client-writable column. Before 0014 a guest could set its own `phone_verified_at` and a manager `venues.betbeat_fee_bps` straight through PostgREST (reproduced, fixed 2026-10-06). In the app: every route handler, server action, webhook and job body is parsed with a strict zod schema (`.strict()` allowlists). Price, status, role, venue and amounts never come from the client: the guest sends `quoteId` + tier + method; the server re-validates the quote and computes everything else. |
| No concatenated SQL | `pg` parameterized queries everywhere (`$1…`), Supabase client for RLS reads; SQL functions use parameters only. |
| Access tests | `tests/integration/rls-access.integration.test.ts` (108 cases) tries to read and write every table with the anon key, an anonymous guest, a DJ, a manager and an admin; everything out of scope must fail. `scripts/db-audit.ts` (`pnpm db:audit`) fails if a table lacks RLS, a policy is a generic `true`, anon/authenticated hold unexpected privileges, or a SECURITY DEFINER function has no pinned `search_path`. |

## B12.3 Authentication and session

| Requirement | Implementation |
| --- | --- |
| No open sensitive screens | `middleware.ts` redirects `/cockpit` and `/console` without a non-anonymous Supabase session; the server layouts re-run `requireStaff` (role per venue) on every request, and `app/api/cockpit/*` / console actions re-gate per call. The display route only renders the public DTO of a signed display token. |
| Server-side validation on every request | `lib/security/staff.ts` calls `supabase.auth.getUser()` (token verified against Auth, not decoded locally) and loads memberships through RLS. The client never decides permissions. |
| Cookies | Auth cookies are written by `@supabase/ssr`: `sameSite=lax`, `secure` on HTTPS, path `/`. They are NOT `httpOnly`: the browser client must read the session to join private Realtime channels and to run the anonymous guest flow. This is the library exception the brief allows, documented in `docs/DECISIONS.md` with its mitigations: nonce + `strict-dynamic` CSP (no inline or third-party script can run), short-lived access tokens with refresh handled server-side, and permissions decided only by server-side `auth.getUser()` on every request. The console venue cookie (`bb-console-venue`, httpOnly, lax) and the guest locale cookie carry no identity. |
| Passwords | Only in Supabase Auth (bcrypt). The app never stores or logs them. |
| MFA for managers and admins | TOTP enrol/challenge on `/login/mfa`; `requireStaff` enforces AAL2 for any manager/admin membership on every request (`getAuthenticatorAssuranceLevel`). The cockpit API (`requireStaffApi`) applies the same rule: without AAL2 only plain DJ memberships count. |
| Safe redirects | `?next=` on `/login`, its action and `/login/mfa` goes through `safeNextPath()` (`lib/security/redirect.ts`): same-site paths only. |
| Brute force | Staff login limited per IP and per account. SMS sign-in: 5 guesses per code, plus durable caps counted in the database (5 codes/hour and 10/day per number and per guest). |

## B12.4 Infrastructure and traffic

| Requirement | Implementation |
| --- | --- |
| HTTPS + HSTS | `next.config.ts` headers: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`. TLS terminates at the host. |
| Security headers on every response | CSP with a per-request nonce + `'strict-dynamic'` in `middleware.ts` (`default-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`, `worker-src 'self'`, `manifest-src 'self'`, `upgrade-insecure-requests` in production, Turnstile origins only), plus `Cross-Origin-Opener-Policy: same-origin`, `X-Permitted-Cross-Domain-Policies: none`, plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, minimal `Permissions-Policy`, `poweredByHeader: false`. Verified by `tests/e2e/security.spec.ts`. |
| Rate limiting | `lib/security/rate-limit.ts` (sliding window, keyed per guest uid / IP / phone hash) on search, bids, payments, login, SMS and public reads; 429 with a generic body. In-memory per process; staff sign-in is also counted in Postgres (`lib/security/rate-limit-pg.ts`, migration 0015) so several app instances share one count, and SMS codes keep durable caps and an attempt counter taken atomically before each comparison. The client IP is the address the trusted proxy saw (`lib/security/client-ip.ts`, `TRUSTED_PROXY_HOPS` from the right of `X-Forwarded-For`), so a client cannot pick its own bucket. Per-IP limits on public reads are generous because a whole club shares one Wi-Fi address; `/api/guest/session-state` is protected by a 1 s per-session micro-cache instead. |
| Body size | `middleware.ts` refuses /api requests whose declared `Content-Length` exceeds 256 KB (11 MB for the library import) with 413 before any route reads the body (`lib/security/body-limit.ts`). |
| CSRF | Cookies are `sameSite=lax`; on top of that `middleware.ts` refuses cross-site POST/PUT/PATCH/DELETE to `/api` by Origin (`lib/security/csrf.ts`; webhooks excluded). Server actions have Next's own origin check. |
| Server-side fetches (SSRF) | The BPM measurer only downloads `https://*.dzcdn.net` previews (also after redirects), streamed with a 3 MB cap. Push endpoints are limited to the browsers' push services (`isPushEndpoint`). |
| Realtime | Private channels (staff, guest, board) are RLS-authorized. `session:<id>:board` carries the public auction board: readable by any signed-in guest, writable only by the server (no insert policy, migration 0021), so a client cannot forge it. Public `session:<id>:public` channels carry only "refetch" hints, never data; since any client can broadcast on a public channel, hints are coalesced (one refetch per 500 ms per screen). |
| Anti-bot | Cloudflare Turnstile verified server-side (`lib/security/turnstile.ts`) on payment start and tier upgrade (token required by the zod schema). Anonymous session creation and staff sign-in pass the Turnstile token to Supabase Auth when `NEXT_PUBLIC_SUPABASE_CAPTCHA=1`: turn on CAPTCHA (provider Turnstile, the same secret) in the production Supabase project in the same deploy; the guest app then waits for a token before creating the anonymous session. Off by default so local runs and E2E work offline. With it on, the per-IP anonymous sign-in limit can be raised for venue Wi-Fi. The staff login form renders the widget and `loginAction` refuses a sign-in without a valid token in production (dev accepts a missing one so local runs work offline). Dev uses the always-pass test keys. |
| Uploads | Library import (`app/api/cockpit/library/import`): real type sniffed from content, 10 MB cap, XML parsed without external entities (`lib/catalog/import.ts`). Venue images: 2 MB cap (Phase 8 adapter). |
| Minimal responses | Explicit DTOs in `lib/domain/dto.ts` and per-route shapes; never `select *` to the client. Staff card payloads carry no guest PII; guests only ever see their own requests. |
| No leaks | Errors to clients are `{ error: { code, id } }` with a short correlation id that is also logged; no stack traces or keys in responses. Phones are masked in logs (`maskPhone`) and stored hashed with a salt (`hashPhone`) for anti-abuse checks. Sentry (Phase 8, off without a DSN): `lib/observability/scrub.ts` runs as `beforeSend`, `beforeSendTransaction` and `beforeBreadcrumb` on the server, edge, worker and browser. It masks phones, emails, IBANs, JWTs, Supabase keys and bearer tokens in every string, filters sensitive keys at any depth, drops request bodies, cookies and all headers but a short allowlist, removes QR/display tokens from URLs and sensitive query values, and keeps only the user id. `sendDefaultPii: false`, no replay. Tested in `lib/observability/scrub.test.ts` (including a property test for Portuguese numbers). PostHog runs server-side only with allowlisted primitive properties, no person profiles and no IP (`lib/analytics/capture.ts`). |

## B12.5 Sensitive data

- `lib/security/crypto.ts`: AES-256-GCM with `DATA_ENCRYPTION_KEY` (outside the
  database) for guest phones and emails, payout IBANs and third-party tokens.
  Format `base64(iv || ciphertext || tag)`.
- Anti-abuse checks use `hashPhone()` (salted SHA-256), never the clear number;
  the clear number exists only encrypted, for the MB WAY push and the optional
  SMS notice.

## B12.6 Dependencies

- Every dependency is from the B11 stack; new ones are justified in
  `docs/DECISIONS.md` after checking the exact name, publisher and repository.
- `pnpm-lock.yaml` is committed; `pnpm.onlyBuiltDependencies` blocks install
  scripts except the approved native builds.
- `pnpm audit` runs in CI; no high vulnerabilities allowed in runtime code.
- 2026-11-05: next 15.5.29 (critical Image Optimization RCE, high Server
  Actions DoS), zod 4.6.7 (high memory exhaustion, no 3.x fix), storybook
  9.1.21 (critical/high dev-server code injection), vitest 4.1.12, vite
  forced to ^7.3.7. `pnpm audit --audit-level high`: clean. Four moderate
  advisories remain, all dev-only tooling (minimatch under eslint-config-next,
  glob and an older @vitest/mocker under Storybook). New runtime packages:
  `@sentry/nextjs` and `@sentry/node`, pinned to 11.8.0.
- 2026-10-06: postcss forced to ^8.5.29 (`overrides` in `pnpm-workspace.yaml`;
  next pins 8.4.31, which has the sourceMappingURL file-read advisories) and
  vitest 4.1.11 (tinypool RCE advisories). Two advisories remain, both in
  dev-only tooling with no patched release reachable: `braces` (eslint's
  glob matcher, DoS on crafted patterns) and `@vitest/mocker` under
  Storybook 9. Neither ships to production.

## B12.7 Audit before delivery

`pnpm db:audit` runs in CI and at the end of Phases 1, 3, 7, 8 and 9.

**Last recorded result (2026-10-02, local Supabase after `pnpm db:reset`):**
`✓ db:audit passed — 19 tables with RLS, 19 policies, no generic-true, privileges within matrix.`
Re-run at the end of Phase 8 and before delivery.

## B12 review (Phase 8, 2026-11-05)

Read against every point of B12 for this phase's changes and the open items:

| Point | Status |
| --- | --- |
| B12.1 secrets | New variables (Sentry DSNs, PostHog key) are optional and validated in `lib/security/env.ts` (https only). The browser DSN is public by design; the PostHog key moved to server-only names. Secret scan of the whole git history for Supabase/JWT/Twilio/AWS/GitHub/Turnstile/PostHog/Sentry patterns and key files: nothing found. gitleaks itself could not be installed in the cloud container; run `gitleaks detect` locally (the pre-commit hook already runs it when installed). |
| B12.2 database | No schema change. `pnpm db:audit` needs the Supabase stack (not runnable in the container); run it locally before merge. |
| B12.3 auth | Unchanged. |
| B12.4 traffic | New public route `/api/guest/auction/board`: zod-validated token, per-IP limit, public DTO only (the same object every guest already got), cacheable. CSP `connect-src` adds the Sentry ingest origin only when a DSN is set. Session-state per-IP limit raised to 15 000/min after the load test (reads are micro-cached). Turnstile gaps closed in code; the production Supabase CAPTCHA switch is reported at boot by `lib/security/launch-readiness.ts`. |
| B12.4 no leaks | Sentry scrubbing and PostHog allowlist, see above. Search events carry the query length, never the text. |
| B12.6 dependencies | `pnpm audit` clean of high and critical. |
| Open before launch | Supabase CAPTCHA on in production, real Turnstile keys, Sentry source maps upload, gitleaks and `db:audit` on a local run. |

## Verification map

| Check | Command | Needs DB |
| --- | --- | --- |
| Types, lint, unit + property tests | `pnpm typecheck && pnpm lint && pnpm test` | no |
| i18n coverage (no hardcoded copy) | `pnpm i18n:check` | no |
| RLS access matrix, transitions, exactly-once refunds, NEXT concurrency | `SUPABASE_TEST=1 pnpm test` | yes |
| RLS / privilege audit | `pnpm db:audit` | yes |
| Security headers, staff gates, unsigned webhook rejection | `pnpm test:e2e tests/e2e/security.spec.ts` | yes |
| Secrets scan | `gitleaks detect` (and the pre-commit hook) | no |
| Dependency vulnerabilities | `pnpm audit --audit-level high` | no |
