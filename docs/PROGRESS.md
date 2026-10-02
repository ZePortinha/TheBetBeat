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

Overall ≈ 75%. Phases 4–7 are ~85% built (WIP commits `4bcbb98`, `1f2ff25`;
typecheck/lint NOT yet verified green after the last agent round).

Per surface — what exists / what is missing:

- **Guest** (`app/(guest)`, `app/api/guest`, `app/api/webhooks`, `app/api/dev`,
  `components/guest`, `messages/*/guest.json`): all API routes + webhook + dev
  PSP panel; pages for session, search, track/tier, requests/[id] tracking,
  requests list, queue ("Agora na pista"), top. Agent was stopped during the
  curl smoke chain (quote → MB WAY request → dev-panel confirm → status).
  MISSING: `tests/e2e/guest.spec.ts`; end-to-end smoke not yet proven;
  phone screenshots not reviewed (first attempt timed out while Turbopack
  compiled — retry with `--wait 6000`).
- **Cockpit** (`app/(cockpit)`, `app/api/cockpit`, `components/cockpit`,
  `messages/pt-PT/cockpit.json`): Ao Vivo, Fila, Sessão & Receita, Definições
  (settings-screen typechecks), all action/session routes, offline queue,
  sounds, wake lock. MISSING: `public/sw-cockpit.js` + registration,
  `scripts/simulate.ts`, `tests/e2e/cockpit.spec.ts`, iPad screenshots.
- **Display**: DONE and verified — `docs/screens/display-16x9.png` and
  `display-9x16.png`, state API OK, translations OK. Still to do: E2E run +
  QR decode from screenshot (Phase 6 criterion).
- **Console** (`app/(console)`, `app/api/console`, `components/console`,
  `messages/pt-PT/console.json`): venue panel complete (sessões, zonas+print,
  preços+simulador, equipa, receita, análise) and admin pages (casas, sessões,
  falhas, reconciliação, flags, auditoria). Agent was stopped while moving two
  hardcoded aria-labels to translations and harvesting keys into console.json
  — VERIFY console.json covers every `t("...")` key (it was a `{}` placeholder
  before the agent filled it). MISSING: `tests/e2e/console.spec.ts`, the 7
  earlier typecheck errors may still exist (admin/casas/actions.ts,
  sessoes/actions.ts, zonas/actions.ts), desktop screenshots.

Infra notes from this round: `pnpm dev` now uses Turbopack (webpack dev on
Windows corrupted `.next` vendor-chunks under concurrent compiles);
`lib/i18n/request.ts` uses an explicit import map; `next-env.d.ts` is
lint-ignored.

To resume: `supabase start` → `pnpm db:reset` → `rm -rf .next` → `pnpm dev`
(+ `pnpm worker`); `pnpm typecheck && pnpm lint` and fix seams; finish the
MISSING items above (one agent per surface, same ownership); then E2E suite +
screenshots at 393×852 / 1194×834 / 1440×900 with B10.6 checklist review;
money + security subagent reviews (A2.10); Phase 8 (Sentry/PostHog wiring,
`scripts/load-test.ts` run, B12 review, `tests/e2e/security.spec.ts`);
Phase 9 (README, night-operations guide, docs/SECURITY.md, final docs).

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
