# Decisions

Each entry: date, context, decision, rejected alternative.

## 2026-10-02 — Continuous execution of all phases

- **Context:** The owner explicitly ordered all phases built in one continuous
  run ("faz já todas as fases"), overriding brief rule A2.1 (stop for approval
  at each phase boundary).
- **Decision:** Build phases 0→9 sequentially without approval pauses; keep all
  other phase-end criteria (green checks, PROGRESS.md, commit per phase).
- **Rejected:** Pausing per phase — contradicted the owner's direct instruction.

## 2026-10-02 — Pinned stable majors instead of bleeding edge

- **Context:** Brief A2.11 asks for current stable versions.
- **Decision:** Next.js 15 / React 19 / Tailwind 4 / zod 3 / Storybook 9 /
  Motion 12 / pg-boss 10 — stable, LTS-grade, well-documented combinations.
- **Rejected:** Always-latest majors — higher breakage risk with no product gain.

## 2026-10-02 — Guest catalog reads go through server DTOs, not direct RLS selects

- **Context:** B12.4 requires minimal responses; guest search needs ranking,
  pricing hints and availability logic anyway.
- **Decision:** Guests never select `library_tracks` directly; the search API
  returns explicit DTOs. RLS on the table only grants staff.
- **Rejected:** Guest-readable RLS on library_tracks — wider surface, no benefit.

## 2026-10-02 — Ledger rows use signed cents with zero-sum groups

- **Context:** B4.5 requires immutable double-entry.
- **Decision:** `ledger_entries(group_id, account, amount_cents)` signed;
  each group sums to zero (enforced by writer + tests); UPDATE/DELETE blocked by
  trigger.
- **Rejected:** Separate debit/credit columns — equivalent semantics, noisier.

## 2026-10-02 — Genre lookups are own-property only (prototype pollution)

- **Context:** fast-check found that a track genre literally named "toString"
  or "__proto__" (possible via imported rekordbox files) made the multiplier
  lookup read inherited Object.prototype members and crash quoting.
- **Decision:** `genreMultiplierFor` uses `Object.hasOwn` guards; property
  tests keep hostile-string genres in their generator space.
- **Rejected:** Sanitizing genres at import only — defense belongs in the
  engine too.

## 2026-10-02 — Declined and expired payments share close reason

- **Context:** B4.2 defines `payment_timeout → expired` but no distinct close
  reason for PSP declines.
- **Decision:** `payment_failed` and `payment_expired` both close as
  `expired/payment_timeout`; the payments table keeps the precise PSP outcome.
- **Rejected:** Widening CLOSE_REASONS — churn across exhaustive switches with
  no user-visible benefit (guest sees "não foi cobrado" either way).

## 2026-10-02 — Staff MFA via Supabase TOTP, AAL2 enforced server-side

- **Context:** B12.3 requires MFA for managers/admin.
- **Decision:** TOTP enroll/challenge on /login/mfa; `requireStaff` enforces
  AAL2 server-side for manager/admin on every request.
- **Rejected:** SMS MFA (real SMS provider unavailable; weaker factor).

## 2026-10-02 — Session "active now" seed

- **Context:** Dev/demo needs a live session whenever `db:reset` runs.
- **Decision:** Seed session starts `now()-1h`, ends `now()+5h`, status `live`.
- **Rejected:** Fixed timestamps — would go stale immediately.

## 2026-10-02 — Supabase auth cookies are not httpOnly (documented exception)

- **Context:** B12.3 asks for `httpOnly` cookies, allowing a documented
  exception when the auth library requires it. `@supabase/ssr` cookies must be
  readable by the browser client: anonymous guests sign in client-side and
  private Realtime channels need the access token on the socket.
- **Decision:** Keep the library defaults (`sameSite=lax`, `secure` on HTTPS,
  not httpOnly). Mitigations: nonce + `strict-dynamic` CSP on every response
  (no inline or foreign script executes), server-side `auth.getUser()` on every
  staff request (the client never decides permissions), short-lived access
  tokens, console venue cookie httpOnly.
- **Rejected:** Proxying Supabase Auth behind our own httpOnly session: loses
  Realtime private-channel authorization and the anonymous guest flow.

## 2026-10-02 — E2E staff MFA through TOTP computed in the test

- **Context:** Managers/admins need AAL2 (B12.3); Playwright has no
  authenticator app.
- **Decision:** `tests/e2e/fixtures.ts` resets the seeded account's TOTP factor
  through the Supabase admin API (service-role key from `.env.local`, test
  process only), reads the enrolment secret from `/login/mfa` and computes
  RFC 6238 codes with `node:crypto`. No new dependency.
- **Rejected:** A dev-only MFA bypass flag: a bypass that exists can be left on.

## 2026-10-02 — Destructive "Terminar set" E2E is opt-in

- **Context:** Ending the seeded live session breaks every later spec (guest,
  display, console) in the same run.
- **Decision:** `cockpit.spec.ts` covers the end-set sheet (summary, cancel, a
  short hold does NOT end) unconditionally and runs the full 2 s hold only with
  `E2E_END_SET=1`, to be run last or followed by `pnpm db:reset`.
- **Rejected:** Recreating a live session from the test: requires console
  actions the DJ account does not have and hides state between specs.

## 2026-10-02 — Cockpit service worker never touches /api

- **Context:** B11 asks for a cockpit service worker for offline mode; B7
  requires offline actions to replay in order with idempotency keys.
- **Decision:** `public/sw-cockpit.js` caches only the app shell (network-first)
  and hashed assets (cache-first). Actions stay in the page's localStorage
  queue (`components/cockpit/offline-queue.ts`); the SW never caches or replays
  `/api/**`, and never caches a response that redirected (a `/cockpit` bounce
  to `/login` must not become the offline shell). The last-resort offline page
  carries one inline pt-PT line because a service worker runs outside
  next-intl; the real copy lives in `cockpit.offline.*`.
- **Rejected:** Background Sync for actions: would reorder or duplicate
  money-relevant POSTs outside the queue's guarantees.

## 2026-10-02 — Static i18n coverage check instead of typed message keys

- **Context:** `console.json` shipped as `{}` without any check failing;
  next-intl keys are untyped strings here.
- **Decision:** `scripts/i18n-check.ts` scans translator declarations and calls
  (nearest declaration above the call wins) and fails on missing keys or
  unmatched dynamic prefixes per locale; pt-PT carries every namespace, EN only
  `common` + `guest` (B6). Runs with `pnpm i18n:check`, no DB needed.
- **Rejected:** next-intl's TypeScript message augmentation: it does not cover
  dynamic keys and would require a global types refactor mid-project.

## 2026-10-02 — Delivery docs language

- **Decision:** `README.md` and `docs/SECURITY.md` in English (engineering);
  `docs/OPERATIONS.md` in pt-PT because its readers are venue staff and DJs.
