# Progress

## Phase status

| Phase | Status | Notes |
| --- | --- | --- |
| 0 — Plan | done | Env verified: Node 25, pnpm 12, Docker OK, supabase CLI 2.78, gitleaks installed |
| 1 — Foundations | in progress | Scaffold, tokens, DB schema+RLS+seed written; components/Storybook pending |
| 2 — Pricing engine | todo | |
| 3 — Domain & money | todo | |
| 4 — Guest app | todo | |
| 5 — DJ cockpit | todo | |
| 6 — Venue display | todo | |
| 7 — Console | todo | |
| 8 — Real integrations & robustness | todo | Real PSP/SMS/invoicing credentials unavailable → adapters stay mocked behind interfaces, documented |
| 9 — Delivery | todo | |

## Next step

Finish Phase 1: base components + Storybook, middleware/security headers,
i18n skeleton, db:audit script, `pnpm db:reset` green, token page screenshot.

## Known issues

- Supabase CLI 2.78.1 (2.119 available) — fine for local dev.
- Real PSP/SMS/invoicing/catalog credentials not available in this environment;
  Phase 8 ships sandbox-ready adapters + docs instead of live validation.
