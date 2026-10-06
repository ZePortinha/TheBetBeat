# Progress

## Phase status

| Phase | Status | Notes |
| --- | --- | --- |
| 0 — Plan | done | Env verified: Node 25, pnpm 12, Docker OK, supabase CLI 2.78, gitleaks installed |
| 1 — Foundations | done* | Scaffold, tokens, DB+RLS+seed, 18 components+stories, staff auth+MFA. *Visual review of tokens/Storybook happens with the surfaces screenshot pass |
| 2 — Pricing engine | done | B5 complete incl. exact B5.2 example + fast-check; simulator ships in the console |
| 3 — Domain & money | done | FSM (168 tests), mock PSP, ledger, services, worker; 393 unit + 20 integration tests green; money/security subagent review pending (scheduled before Phase 8 close) |
| 4 — Guest app | built, unverified | All screens + API + webhook + dev PSP panel; `tests/e2e/guest.spec.ts` written; E2E run, phone screenshots, B10.6 checklist and axe pending (need DB) |
| 5 — DJ cockpit | built, unverified | All screens, actions, offline queue, sounds, wake lock, `public/sw-cockpit.js`, `scripts/simulate.ts`; `tests/e2e/cockpit.spec.ts` written; E2E run, iPad screenshots, < 1 s check with `pnpm simulate` pending |
| 6 — Venue display | done* | Screenshots reviewed (`docs/screens/display-*.png`); *E2E run + QR decode from screenshot pending |
| 7 — Console | built, unverified | Venue panel + admin pages; `console.json` complete (`pnpm i18n:check` clean); `tests/e2e/console.spec.ts` written; E2E run, desktop screenshots, `pnpm db:audit` pending |
| 8 — Real integrations & robustness | todo | Real PSP/SMS/invoicing/catalog credentials unavailable → adapters stay mocked behind interfaces; Sentry/PostHog wiring, load-test run, B12 review pending |
| 9 — Delivery | docs done | README, `docs/OPERATIONS.md`, `docs/SECURITY.md`, DECISIONS updated. Final `db:audit` result still to paste into SECURITY.md |

## This round (cloud session, no Docker / Supabase — 2026-10-02)

Branch `cloud/finish-surfaces` (also pushed to the session branch). Everything
that does not need a database was finished and verified:

- `pnpm install`, `pnpm typecheck`, `pnpm lint`: green from the start (the 7
  earlier typecheck errors were already fixed in the WIP commits).
- `pnpm test`: 393 unit + property tests green.
- `pnpm i18n:check` (new): 0 missing keys in pt-PT and EN across all surfaces.
  `messages/pt-PT/console.json` went from `{}` to the full namespace; the two
  hardcoded aria-labels and two placeholders in the console moved to
  translations.
- `public/sw-cockpit.js` (registration already existed in `cockpit-shell.tsx`;
  CSP gained `worker-src 'self'`).
- `scripts/simulate.ts`; `scripts/load-test.ts` fixed (wrong quote body field,
  missing guest auth).
- `tests/e2e/fixtures.ts` (anonymous guest + API-driven paid requests, TOTP MFA
  login), `guest.spec.ts`, `cockpit.spec.ts`, `console.spec.ts`.
- Phase 9 docs.

## Local verification log (2026-10-02)

- Steps 1–2 done: `pnpm db:audit` green (pasted into SECURITY.md); `SUPABASE_TEST=1 pnpm test`
  128/128 integration green. Fixed a test-pollution bug: the RLS suite seeded an immutable
  `psp_clearing` ledger row that made the reconciliation test report a 100c mismatch on a fresh DB.
- Step 3 done: `pnpm test:e2e` 57 passed (108 skipped by project gating); the gated
  `E2E_END_SET=1` tests (cockpit "manter premido", console Phase 7 flow) pass, each on a fresh DB.
  The run exposed 9 product bugs, all fixed (see DECISIONS, "E2E run"). Confirmed payment →
  cockpit card measured < 2 s in dev.
- Operational: restart `pnpm worker` after every `pnpm db:reset` (the pg-boss schema is wiped), and
  `supabase stop && supabase start` after editing `supabase/config.toml` (MFA TOTP is now enabled).
- Steps 4–8 still pending: `pnpm simulate` strict < 1 s latency, screenshots + B10.6 checklist,
  QR decode, subagent reviews.

## To verify locally (needs `supabase start` + `pnpm db:reset` + `pnpm dev` + `pnpm worker`)

In this order; fix selectors/labels as needed, then record results here:

1. `pnpm db:audit` → paste the result into `docs/SECURITY.md` §B12.7.
2. `SUPABASE_TEST=1 pnpm test` (integration: transitions, exactly-once
   refunds, NEXT concurrency, RLS matrix).
3. `pnpm test:e2e` (all projects). Known assumptions written into the specs:
   - fixtures sign guests in through `POST {SUPABASE_URL}/auth/v1/signup`
     (anonymous sign-ins enabled in `supabase/config.toml`);
   - manager/admin MFA: fixtures delete the account's TOTP factors through the
     Supabase admin API (`SUPABASE_SERVICE_ROLE_KEY` from `.env.local`) and
     compute codes from the enrolment secret shown on `/login/mfa`;
   - guest spec reaches "Tocou" by having the DJ play a second request (the
     play route marks the previous playing request as played);
   - the pause test expects `createPaidRequest` to be refused while paused;
   - the console session form defaults must pass server validation.
4. `E2E_END_SET=1 pnpm test:e2e --project=ipad -g "manter premido"` and the
   gated console test, LAST (they end the seeded live session), then
   `pnpm db:reset`.
5. `pnpm simulate --rate 20 --minutes 2` with the cockpit open: confirm the
   < 1 s payment → card latency (B1.5) and the webhook p95 the script prints.
6. Screenshots with `scripts/screenshot.ts` at 393×852 (guest: session, search,
   tier, payment sheet, tracking, played), 1194×834 (cockpit: live, queue,
   stats, settings, end-set sheet) and 1440×900 (console: every page), plus
   the slow-motion review of the key animations; B10.6 checklist per screen,
   reduced motion / reduced transparency / increased contrast; axe on each.
7. Display Phase 6 criterion: decode the QR from `docs/screens/display-16x9.png`.
8. Money + security subagent reviews (A2.10) before closing Phase 8.

## Next step

Phase 8: wire Sentry (with `beforeSend` scrubbing) and PostHog behind env,
close the two Turnstile gaps named in `docs/SECURITY.md` (anonymous sign-in
captcha, staff login widget), run `scripts/load-test.ts` against a production
build and document the numbers, `pnpm audit`, gitleaks, B12 review; real PSP,
SMS, invoicing and catalog adapters when credentials arrive.

## Known issues

- Supabase CLI 2.78.1 (2.119 available) — fine for local dev.
- Real PSP/SMS/invoicing/catalog credentials not available; Phase 8 ships
  sandbox-ready adapters + docs instead of live validation.
- Turnstile is not enforced on anonymous session creation nor rendered on the
  staff login form (see `docs/SECURITY.md` B12.4) — Phase 8.
- `price.changed` broadcasts not yet emitted (screens refetch quotes on
  `queue.changed`); wire a quote-service hook if live tickers are wanted.
- TierQuote.reason lacks an `order_conflict` code: a tier made unavailable by
  the guaranteed-order rule returns `available:false` without a reason enum.
- Mock PSP keeps intent state in-process; cross-process status relies on
  webhooks + the payments table (fine for mock; real PSP has real status API).
- Cockpit SW offline fallback page carries one inline pt-PT line (documented in
  DECISIONS: a service worker cannot use next-intl).
- The `pnpm install` in a fresh environment reports ignored build scripts
  (`@swc/core`, `esbuild`, `unrs-resolver`, `@parcel/watcher`); the approved
  list in `package.json` is intentional (B12.6). Add to
  `pnpm.onlyBuiltDependencies` only if a tool actually needs its native build.
