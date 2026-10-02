# Progress

## Phase status

| Phase | Status | Notes |
| --- | --- | --- |
| 0 — Plan | done | Env verified: Node 25, pnpm 12, Docker OK, supabase CLI 2.78, gitleaks installed |
| 1 — Foundations | done* | Scaffold, tokens, DB+RLS+seed, 18 components+stories, staff auth+MFA. *Visual review of tokens/Storybook happens with the surfaces screenshot pass |
| 2 — Pricing engine | done | B5 complete incl. exact B5.2 example + fast-check (simulator UI ships with console, Phase 7) |
| 3 — Domain & money | done | FSM (168 tests), mock PSP, ledger, services, worker; 393 unit + 20 integration tests green; money/security subagent review pending (scheduled before Phase 8 close) |
| 4 — Guest app | todo | |
| 5 — DJ cockpit | todo | |
| 6 — Venue display | todo | |
| 7 — Console | todo | |
| 8 — Real integrations & robustness | todo | Real PSP/SMS/invoicing credentials unavailable → adapters stay mocked behind interfaces, documented |
| 9 — Delivery | todo | |

## Next step (PAUSED 2026-10-02 at the owner's request — usage limit)

Phases 4–7 were being built by 4 parallel agents (one vertical slice each:
pages + API + translations + E2E spec). They were STOPPED mid-flight; their
partial work is committed as a WIP checkpoint (typecheck/lint NOT yet green):

- Guest (`app/(guest)`, `app/api/guest`, `app/api/webhooks`, `app/api/dev`,
  `messages/*/guest.json`, `components/guest`): server/API layer written;
  stopped while starting the client components ("shared utilities first").
- Cockpit (`app/(cockpit)`, `app/api/cockpit`, `components/cockpit`,
  `messages/pt-PT/cockpit.json`): Ao Vivo/actions/offline done; stopped at the
  Definições screen; `scripts/simulate.ts`, `public/sw-cockpit.js`, E2E spec
  may be missing.
- Display (`app/(display)`, `app/api/display`, `components/display`): stopped
  while clearing a corrupted `.next` cache (`rm -rf .next` before `pnpm dev`).
- Console (`app/(console)`, `app/api/console`, `components/console`): venue
  panel done; stopped at Admin BetBeat pages (casas).

To resume: `supabase start` → `pnpm db:reset` → `rm -rf .next` → `pnpm dev`
+ `pnpm worker`; run `pnpm typecheck` to list the seams; finish each surface
(re-launch one agent per surface with the SAME prompts/ownership, telling it
to continue from the existing files); then integration, E2E + screenshots
(4 viewports), B10.6 checklist, money/security subagent reviews, Phase 8, 9.

Also done this round: RLS access matrix test (108 passing,
`tests/integration/rls-access.integration.test.ts`), security headers E2E
(`tests/e2e/security.spec.ts`), funnel analytics lib (`lib/analytics`),
load test + screenshot scripts, tokens page reviewed (`docs/screens/tokens.png`).

## Known issues

- Supabase CLI 2.78.1 (2.119 available) — fine for local dev.
- Real PSP/SMS/invoicing/catalog credentials not available in this environment;
  Phase 8 ships sandbox-ready adapters + docs instead of live validation.
- `price.changed` broadcasts not yet emitted (screens refetch quotes on
  `queue.changed`); wire a quote-service hook if live tickers are wanted.
- TierQuote.reason lacks an `order_conflict` code: a tier made unavailable by
  the guaranteed-order rule returns `available:false` without a reason enum.
- Mock PSP keeps intent state in-process; cross-process status relies on
  webhooks + the payments table (fine for mock; real PSP has real status API).
