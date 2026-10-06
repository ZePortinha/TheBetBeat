# Security

How each point of BETBEAT_BRIEF.md §B12 is met, where to look, and what is
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
| No mass assignment | Every route handler, server action, webhook and job body is parsed with a strict zod schema (`.strict()` allowlists). Price, status, role, venue and amounts never come from the client: the guest sends `quoteId` + tier + method; the server re-validates the quote and computes everything else. |
| No concatenated SQL | `pg` parameterized queries everywhere (`$1…`), Supabase client for RLS reads; SQL functions use parameters only. |
| Access tests | `tests/integration/rls-access.integration.test.ts` (108 cases) tries to read and write every table with the anon key, an anonymous guest, a DJ, a manager and an admin; everything out of scope must fail. `scripts/db-audit.ts` (`pnpm db:audit`) fails if a table lacks RLS, a policy is a generic `true`, anon/authenticated hold unexpected privileges, or a SECURITY DEFINER function has no pinned `search_path`. |

## B12.3 Authentication and session

| Requirement | Implementation |
| --- | --- |
| No open sensitive screens | `middleware.ts` redirects `/cockpit` and `/console` without a non-anonymous Supabase session; the server layouts re-run `requireStaff` (role per venue) on every request, and `app/api/cockpit/*` / console actions re-gate per call. The display route only renders the public DTO of a signed display token. |
| Server-side validation on every request | `lib/security/staff.ts` calls `supabase.auth.getUser()` (token verified against Auth, not decoded locally) and loads memberships through RLS. The client never decides permissions. |
| Cookies | Auth cookies are written by `@supabase/ssr`: `sameSite=lax`, `secure` on HTTPS, path `/`. They are NOT `httpOnly`: the browser client must read the session to join private Realtime channels and to run the anonymous guest flow. This is the library exception the brief allows, documented in `docs/DECISIONS.md` with its mitigations: nonce + `strict-dynamic` CSP (no inline or third-party script can run), short-lived access tokens with refresh handled server-side, and permissions decided only by server-side `auth.getUser()` on every request. The console venue cookie (`bb-console-venue`, httpOnly, lax) and the guest locale cookie carry no identity. |
| Passwords | Only in Supabase Auth (bcrypt). The app never stores or logs them. |
| MFA for managers and admins | TOTP enrol/challenge on `/login/mfa`; `requireStaff` enforces AAL2 for any manager/admin membership on every request (`getAuthenticatorAssuranceLevel`). |

## B12.4 Infrastructure and traffic

| Requirement | Implementation |
| --- | --- |
| HTTPS + HSTS | `next.config.ts` headers: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`. TLS terminates at the host. |
| Security headers on every response | CSP with a per-request nonce + `'strict-dynamic'` in `middleware.ts` (`default-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `worker-src 'self'`, Turnstile origins only), plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, minimal `Permissions-Policy`, `poweredByHeader: false`. Verified by `tests/e2e/security.spec.ts`. |
| Rate limiting | `lib/security/rate-limit.ts` (sliding window, keyed per guest uid / IP / phone hash) on anonymous session, search, quotes, payments, login and request reads; 429 with a generic body. In-memory for a single node; the interface allows a Redis adapter. |
| Anti-bot | Cloudflare Turnstile verified server-side (`lib/security/turnstile.ts`) on payment start and tier upgrade (token required by the zod schema). **Gaps, to close in Phase 8:** (1) anonymous session creation goes straight to Supabase Auth, protected today only by Supabase's per-IP anonymous sign-in rate limit; enabling `[auth.captcha] provider = "turnstile"` in `supabase/config.toml` and passing `captchaToken` in `signInAnonymously` closes it; (2) the staff login form does not render the widget yet, so `loginAction` verifies a token only when one is posted (the per-IP login rate limit still applies). Dev uses the always-pass test keys. |
| Uploads | Library import (`app/api/cockpit/library/import`): real type sniffed from content, 10 MB cap, XML parsed without external entities (`lib/catalog/import.ts`). Venue images: 2 MB cap (Phase 8 adapter). |
| Minimal responses | Explicit DTOs in `lib/domain/dto.ts` and per-route shapes; never `select *` to the client. Staff card payloads carry no guest PII; guests only ever see their own requests. |
| No leaks | Errors to clients are `{ error: { code, id } }` with a short correlation id that is also logged; no stack traces or keys in responses. Phones are masked in logs (`maskPhone`) and stored hashed with a salt (`hashPhone`) for anti-abuse checks. Sentry is not wired yet (Phase 8): when it is, `beforeSend` must scrub phones, emails and tokens before this row can be ticked. |

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
- `pnpm audit` runs in CI; no high vulnerabilities allowed.

## B12.7 Audit before delivery

`pnpm db:audit` runs in CI and at the end of Phases 1, 3, 7, 8 and 9.

**Last recorded result (2026-10-02, local Supabase after `pnpm db:reset`):**
`✓ db:audit passed — 19 tables with RLS, 19 policies, no generic-true, privileges within matrix.`
Re-run at the end of Phase 8 and before delivery.

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
