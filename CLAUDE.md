# BetBeat

Guests at a nightclub pay to request songs from the DJ, choosing how long they are
willing to wait (dynamic pricing). The DJ always decides what plays; if a song does
not play, the guest is automatically refunded. One Next.js app serves four surfaces:
guest PWA, DJ cockpit (iPad), venue display (TV) and venue/admin console.

At the start of each session, read `docs/PROGRESS.md` and resume from the next step.
The source of truth is the brief: `BETBEAT_BRIEF.md` (never summarize it away).

## Stack & commands

- Next.js App Router + TypeScript strict + Tailwind v4 (tokens in `styles/tokens.css`)
- Motion (ex-Framer Motion), Vaul sheets, next-intl, zod
- Supabase (Postgres + Realtime Broadcast + RLS + anonymous auth), local via CLI
- Worker: Node + pg-boss (`worker/`)
- Tests: Vitest + fast-check, Playwright + axe, Storybook
- `pnpm dev` · `pnpm worker` · `pnpm typecheck` · `pnpm lint` · `pnpm test` ·
  `pnpm test:e2e` · `pnpm storybook` · `pnpm db:reset` · `pnpm db:audit` · `pnpm i18n:check` ·
  `pnpm simulate`

## Folder map

- `app/(guest|cockpit|display|console)/…` — the four surfaces; `app/api/` — routes/webhooks
- `lib/pricing` (pure quote math) · `lib/domain` (state machine, types) ·
  `lib/payments` · `lib/ledger` · `lib/security` · `lib/realtime` · `lib/catalog` ·
  `lib/invoicing` · `lib/notifications`
- `components/ui` (Storybook) · `messages/` (pt-PT.json, en.json) ·
  `supabase/migrations` · `worker/` · `scripts/` · `tests/e2e` · `docs/`

## Conventions

- Code, names, comments, commits: English. UI copy: pt-PT (+ EN on guest app),
  ALWAYS in `messages/*.json`, never hardcoded in components.
- Money: integer cents only. Time: UTC stored, Europe/Lisbon displayed.
- `now` is injected everywhere in domain code — never `Date.now()` inside logic.
- Only fictional data; no real names, no lorem ipsum.

## Non-negotiables (B1 + B4)

1. The DJ has the final say — nothing plays without acceptance.
2. If it doesn't play, the guest doesn't pay: full automatic refund; failed time
   promises refund the difference (SOON/NEXT demote to QUEUE).
3. QR → payment in under 30 s, no registration or password.
4. Final price, ETA and rules visible before paying.
5. < 1 s from confirmed payment to cockpit alert.
6. Designed for darkness, noise and one busy hand.
7. NOT gambling: deterministic outcome. Forbidden words in UI: "aposta",
   "apostar", "odds", "ganhar".
8. State transitions happen ONLY on the server; every transition writes a
   `request_event` + audit record. Quotes validated server-side (client sends
   `quoteId`, never prices). Refunds exactly-once (idempotency key per
   request+reason).

## Execution rules (A2 essentials)

- One phase at a time; green checks + updated `docs/PROGRESS.md` + commit before
  moving on. Record decisions in `docs/DECISIONS.md`.
- Run `pnpm typecheck && pnpm lint && pnpm test` after every relevant change.
- Screenshot every screen (Playwright) at its viewports: phone 393×852,
  iPad 1194×834, TV 1920×1080 / 1080×1920; review against B10.
- Load the `apple-design` skill (`.claude/skills/apple-design/SKILL.md`) before
  building or reviewing any screen, component, gesture or animation. B10 wins on
  brand conflicts (log the decision).
- Never commit secrets (`.env.local` only); never push without being asked.
- External integrations are mocks behind interfaces until Phase 8.
