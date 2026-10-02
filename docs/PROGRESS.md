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

## Next step

Phases 4–7: build the four surfaces (guest app, cockpit, display, console) on
top of lib/* services, then E2E + screenshots + interaction checklist review.

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
