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

## 2026-10-11 - PRs #1-#6 integrated (branch claude/project-thread-cp9ey2)

One branch from main with the six open PRs merged (#1, #3, #2, #4, #6, #5)
and the conflicts resolved (see DECISIONS 2026-10-11). Verified in the cloud
container on the real local Supabase stacks: typecheck, lint, i18n:check,
`pnpm test` (494), `SUPABASE_TEST=1 pnpm test` (161), `pnpm db:audit`, and
`pnpm test:e2e` (all 61 run green on Chromium; the phone project ran on
Chromium, not WebKit). Still to check on a real phone: the Instagram video
share and the celebration's frame rate (PR #4).

## Real MB WAY hardening (cloud session — 2026-10-06)

Branch `claude/mbway-integracao-real-rz5b2z`. ifthenpay refund endpoint fixed;
PSP journal (migration 0013) for exactly-once pushes/refunds across restarts,
refund cap per payment, unknown outcomes alert instead of retrying, orphan
payments auto-refunded; `pnpm mbway:smoke` go-live check. Green: typecheck,
lint, `pnpm test` (459), `tests/integration/psp-journal.integration.test.ts`
on a plain Postgres 16. Still to run locally: `pnpm db:reset`, `pnpm db:audit`,
`SUPABASE_TEST=1 pnpm test`; with the real keys, `pnpm mbway:smoke` (see
docs/INTEGRATIONS.md, steps 5–6). Details in DECISIONS.

## Security hardening (cloud session, overnight — 2026-10-06)

Same branch. Column grants (migration 0014) stop guests and managers writing
protected columns through PostgREST (verified phone, @handle, BetBeat fee);
`db:audit` now checks column privileges. Also: client IP from the right end of
X-Forwarded-For (`TRUSTED_PROXY_HOPS`), Origin check on API writes, MFA (AAL2)
on the cockpit API for managers, safe post-login/MFA redirects, preview SSRF
allowlist, reserved @handles, durable SMS caps, per-IP caps + 1 s cache on
public reads, coalesced realtime hints, forced change of temporary staff
passwords, cockpit caches cleared at sign-in, Turnstile on staff sign-in
(and Supabase Auth CAPTCHA ready behind `NEXT_PUBLIC_SUPABASE_CAPTCHA`),
/api body caps, race-free SMS code attempts, sign-in limits in Postgres
(migration 0015), indexes for the busiest payment/refund/ledger lookups
(migration 0016), and integration tests for parallel bids, parallel duplicate
webhooks and DJ accept/reject races. Green: typecheck, lint,
`pnpm test` (479), db:audit and the RLS/domain/auction/worker/journal
integration suites (47 tests) on a plain Postgres 16 with a Supabase stub.
Still to run locally: `pnpm db:reset`, `pnpm db:audit`, `SUPABASE_TEST=1 pnpm test`,
`pnpm test:e2e`; restart Supabase (config.toml: min password 12).
## 2026-10-11 - Backing messages, top-spender winner, 150 € shoutout (branch claude/apoios-vencedor-shoutout-87072g)

Backing carries a 10-character note for the bidder; the guest who spends the
most on a song wins it (runner-up rollover follows); winning bids from 150 €
always get the DJ's mic shoutout, stated in the bid panel and the balance
rules. Migration 20. See DECISIONS of the same date.

## 2026-10-10 - Phone login and balance with rollover (branch claude/login-telemovel-saldo-y25pn1)

Owner's brief (see DECISIONS 2026-10-10): the number is the account on any
phone, the @ is chosen once, second place rolls into the next auction, third
or lower stays in a balance withdrawable for 7 days, balance panel top right.
Built on the phone gate from PR #4 (ported). Verified in the cloud container
on the real local Supabase stack: typecheck, lint, 465 unit tests,
`SUPABASE_TEST=1 pnpm test` 151/151 (rollover scenarios + cross-device login
with a real Auth session), `pnpm db:audit`, and E2E on Chromium: guest spec
green incl. the new login and balance-panel tests. Known E2E reds from main
(fixed by PR #3's library-only track pick): cockpit "vencedor 7 €" and
"recusar devolve 600" climb to a catalog track's 12,50 € floor. To do with
real SMS: try the second-phone login on two real phones.

## 2026-10-08 - Phone fixes and sharing (branch claude/correcoes-telemovel-partilhas-a9exxo)

From the owner's test on a phone (see DECISIONS 2026-10-08): last-30-s frame
on the page, 2D winner scene (~0.9 s after the close), winner video for
Instagram, ranking redesign + Story image, backing without an @, phone
sign-in at the party door. Verified in the cloud container on the real local
Supabase stack: typecheck, lint, unit tests (incl. `tests/unit/win-scene.test.ts`),
`tests/e2e/guest.spec.ts` on the phone viewport (Chromium), and Playwright
screenshots of each screen. To check on a real phone: the video share on
iOS Safari and Android Chrome (H.264 MP4), and the celebration's frame rate.

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

## E2E verification (cloud session, 2026-10-07)

Local Supabase + `pnpm dev` + `pnpm worker`, Chromium for every project (the
phone project's WebKit is not installed in the cloud image), the Deezer catalog
answered by a fictional stub (no network to api.deezer.com there).

- `pnpm typecheck`, `pnpm lint`, `pnpm test` (452) green.
- `pnpm test:e2e`: 56 passed, 104 skipped by project gating; a second and third
  run on the same DB, without `db:reset`, also green. Gated `E2E_END_SET=1`
  tests ("manter premido" on iPad, "Terminar sessão" in the console) pass on a
  fresh DB.
- Fixed: `track_not_found` (search listed catalog songs under "Populares" while
  the catalog was closed, and the fixture bid on the last song of any section);
  the outbid toast covering the winner screen's "Fechar"; the 150 € mic test
  failing on a second run within the hour (3 announcements/hour cap); the end-set
  test reading the wallet through the guest API after the night ended.
- `SUPABASE_TEST=1 pnpm test`: 146 integration tests green, twice in a row,
  with `pnpm worker` STOPPED (a running worker picks up the suite's failed
  refunds and auctions and makes those tests fail). The suite also writes
  fictional "AU …" tracks into the seeded night: `pnpm db:reset` before
  looking at the screens. `pnpm db:audit` green.
- MVP flow walked end to end with screenshots (enter by QR, bid, outbid,
  raise, Vencedor, DJ accepts and plays, Ranking).
- New `tests/e2e/flows.spec.ts` (phone): entering from "Eventos em direto",
  finding a song by typing and bidding on it, backing the leading song. It
  found a bug, fixed: a guest without an @ yet could not back a song (the
  hidden "Como apareces" left the button disabled). Suite now 59 passed.

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

## Quality pass (cloud session, 2026-10-07)

Branch `claude/metricas-acabamento-9ep3sj`. See DECISIONS "Quality pass". Lighthouse mobile
before → after on the production build: "/" perf 86 → 98, best practices 96 → 100; /casas perf
95 → 98, best practices 96 → 100, SEO 90 → 100; axe: 0 violations on
all 33 screens (was 9 across cockpit, console, landing, 404). Remaining best-practice flags on
party pages come from the measurement setup (Turnstile blocked by the sandbox, no realtime).

## DJ library, BPM and event form (cloud session, 2026-10-11)

Branch `claude/bpm-biblioteca-evento-cfyj4o`, migration 18. Cockpit
"Biblioteca" (/cockpit/library: songs, artists, albums, styles; add by hand
or from the catalog, edit, remove), BPM + key of the songs in each open
auction, event form with styles, BPM range and the club/promoter/DJ split at
the flat 11% fee, "Estilo da noite" first in the guest's recommendations.
See DECISIONS 2026-10-11. Tests: unit, integration
(`tests/integration/library-split.integration.test.ts`) and E2E
(`tests/e2e/library-event.spec.ts`).

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
- Turnstile on anonymous session creation needs Supabase CAPTCHA on in production plus
  `NEXT_PUBLIC_SUPABASE_CAPTCHA=1` (off locally). See `docs/SECURITY.md` B12.4.
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
