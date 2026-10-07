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

## 2026-10-02 - Editorial redesign (design-taste-frontend + apple-design)

- **Context:** the product surfaces were correct but flat (boxed cards, a dev
  index as `/`). Reference: Floria (dark editorial) via the taste-skill repo.
- **Decision:** `/` is now the public landing (hero, how it works, three
  sides, guarantee, footer); signed dev links render only outside production
  in a footer strip (E2E reads them from `/`). Sign-in/MFA use `AuthShell`.
  Guest session and House Screen get ambient light and the `Disc` record
  (CSS only, no stock imagery); NowPlaying drops its border for one surface.
  Shared atmosphere lives in `app/globals.css` (`.grain`, `.ambient`,
  `.disc`, `.material-top`), all token-driven, no raw hex in components.
- **B10 over the skill:** kept warm black, gold as the single accent (ember
  only for live), Unbounded display, system UI font. Instrument Serif stays
  only where B10.3 allows it (money >= 28px, highlight phrases in the guest
  app and House Screen); the skill bans it as a default and mixed-family
  emphasis, so marketing and sign-in emphasise with Unbounded 300 instead.
- **Taste-skill pre-flight (plugin v1.0.0) applied to `/` and `/login`:** zero
  em-dashes in UI copy (also fixed in guest/display), hero headline on one
  line at lg, no uppercase eyebrows or numbered steps (icons instead), bento
  cells with distinct surfaces (glow, record, grooves), meta separators
  rationed. Open item: real photography; none is available here, so the
  hero art is the CSS record (a single geometric mark) until photos exist.
- **Inner guest screens:** the guest layout carries the shared grain and
  ambient light; search rows and TrackHero use `Disc` (tilted per title) in
  place of initials tiles, tier prices are 32px, back-header titles wrap to
  two lines instead of truncating.
- **Out of scope:** Cockpit and Console dashboards (skill section 13); they
  inherit tokens only, plus the new NowPlaying look in the live screen.
  Left as they were on purpose: dense, glove-sized and already on-brand.
- **Rejected:** stock photography (picsum) and a div-built fake phone mockup
  (both skill "AI tells"); a floating pill nav (kept a slim blur bar, 64px).

## 2026-10-02 — E2E run: fixes found by the first real run

Context: first `pnpm test:e2e` against local Supabase (57 passed, 108 skipped by project gating).
Product bugs it exposed, all fixed at the root:

- `supabase/config.toml` had TOTP MFA disabled (`enroll_enabled/verify_enabled = false`), so
  managers/admins could never enrol (B12.3). Now enabled; needs `supabase stop && supabase start`.
- `requireStaff` always redirected to `/login/mfa?next=/console` (layout fallback), losing the
  deep link. The middleware now sets `x-pathname` and `requireStaff` prefers it.
- Payment sheet: the 1.2 s hand-off timer was restarted by the parent's 1 s quote-countdown
  re-render (inline callbacks in deps), so the guest never reached tracking. Callbacks now in a ref.
- Declined MB WAY showed "expired" (request expires on decline; poll checked `expired` first).
- Share card `story` format crashed Satori (`flex: undefined`).
- Cockpit ignored `request.rejected` (DJ reject), so rejections never reached the activity feed.
- `useRealtimeChannel` joined the private channel before `setAuth()` resolved; now awaited.
- `MockPaymentProvider.refund` throws on refs created in another process (worker vs Next); it
  now accepts unknown refs (the payments table already caps the refundable amount). Alternative
  rejected: a shared store for the mock — more machinery than a dev mock deserves.
- Progressbar in `NowPlaying` had no accessible name (axe serious) — labelled by the track title.
- Tests: login limiter is per IP, so fixtures send a random `x-forwarded-for`; the RLS suite
  seeded an immutable `psp_clearing` ledger row that faked a reconciliation mismatch.

## 2026-10-03 - Swiss palette and typeface (Helvetica specimen) replace B10.2/B10.3

- **Context:** the product owner asked for the colour palette and typeface of
  the Helvetica specimen (red, black, off-white; one grotesque) as inspiration.
  This supersedes the warm black + gold + Unbounded + Instrument Serif of B10.
  `BETBEAT_BRIEF.md` is untouched and now outdated on those two points; it
  needs aligning with the team.
- **Decision:** tokens in `styles/tokens.css`: neutral black `#0b0b0c` with
  four surfaces, off-white text `#f2f2f0`, one accent red `#e8112d`
  (`accent-500`: fills, primary action; `accent-400` `#ff4d5a`: accent as text
  and icons; `accent-300` hover; `accent-700` pressed). `gold-*` was renamed to
  `accent-*` across the code (`glow-gold` to `glow-accent`, chip/price tone
  `gold` to `accent`). `ember` shares the red family. Heat gradient is now
  amber to red. Amber and green stay as warning and success.
- **Type:** one family, Inter Tight (variable, via `next/font`), as the free
  stand-in for Helvetica (commercial, Linotype). Hierarchy by weight and size
  (display 800, emphasis 300). Instrument Serif and Unbounded are removed; the
  `font-editorial` token now aliases the same family. If Helvetica Now is
  licensed, change only `--font-sans` in `app/layout.tsx`.
- **Contrast deviation from B10.2 (AAA for prices and CTAs):** white on
  `accent-500` is 4.6:1 (AA). Prices are 20px or larger (large-text AAA with
  `accent-400` at 5.4:1+); small money text and body stay on neutrals.
- **Colour-block moment:** the landing's guarantee section is a full-bleed
  red block (the specimen's poster move); the interface stays dark-only.

## 2026-10-05 - Apple design language on top of the red palette

- **Context:** the product owner asked for the design to follow the
  `apple-design` skill. Motion and press feedback already did; this changes
  the visual language. Supersedes the neutrals and type of 2026-10-03; the
  red `accent-500` stays.
- **Palette:** Apple dark system neutrals: `#000000` base, surfaces
  `#1c1c1e` / `#242426` / `#2c2c2e`, text `#f5f5f7` / `#aeaeb2` / `#8e8e93`
  (tertiary still AA on base, surface-1 and surface-2). States use the iOS
  dark system colours: `accent-400`/`ember-500` `#ff453a`, `accent-300`
  `#ff6961`, amber `#ff9f0a`, green `#30d158`.
- **Type:** system font first (`-apple-system`, so SF Pro with its optical
  sizes on Apple devices), Inter with the `opsz` axis elsewhere (replaces
  Inter Tight). Headlines semibold, not extrabold. Tracking per size from
  Inter's dynamic metrics (display -0.022em, heading -0.019em, body
  -0.011em); body carries its tracking globally. `.label` is now a
  sentence-case section header (13px semibold), not uppercase.
- **Shape and surfaces:** buttons are capsules (`Button`, `HoldButton`,
  login/MFA submits); cards 18px, sheets/tiles 28px; inputs keep 12px. Film
  grain and the groove pattern are removed. The nav material is
  `rgba(22,22,23,.8)` + blur/saturate, with reduced-transparency and
  more-contrast fallbacks.
- **Layouts:** the landing is an Apple product page (centred hero, the
  record as the product shot, highlight tiles with bold lead-ins, a bento,
  the guarantee as a red tile, small-print footer). Login/MFA is a centred
  Apple ID-style column. The guest session links are an iOS inset grouped
  list with red icon tiles; the back control is an accent chevron.
- `BETBEAT_BRIEF.md` B10 stays outdated on palette, type and radii; align
  with the team.

## 2026-10-05 - Optional guest sign-in with phone number + SMS code

- **Context:** the product owner asked for guest sign-in by phone number
  with an SMS code, keeping the number so MB WAY is pre-filled.
- **Decision:** optional, never a gate. B1/B4 #3 ("QR → payment in under
  30 s, no registration or password") stays true: an account button on the
  session screen opens `/s/[qrToken]/account`; requesting and paying work
  exactly as before without it.
- **How:** own OTP flow on the existing pieces, not Supabase phone auth
  (that would keep the number in clear in `auth.users`, against B12.5, and
  needs a real SMS gateway before Phase 8). `POST /api/guest/phone` sends a
  6-digit code through the SMS provider interface (mock) and verifies it;
  codes live in `guest_phone_codes` as HMACs bound to guest + number, 5 min
  TTL, 5 attempts, consumed exactly once; sending is rate-limited per
  guest, per number and per IP and needs Turnstile. On success the number
  goes to `guests.phone_encrypted` (AES-GCM) with `phone_verified_at`; an
  audit row is written. `DELETE` forgets it (the salted `phone_hash` stays
  for the night limits, B4.7).
- **MB WAY pre-fill:** the payment sheet reads the saved number (verified
  or from the last MB WAY payment). Paying with a different number replaces
  it and clears `phone_verified_at`.
- **Identity stays per device** (anonymous auth uid). Signing in on a
  second phone saves the number there too; history is not merged across
  devices.
- **Dev only:** with the mock SMS provider and outside production the API
  returns the code and the screen shows it, so development and E2E can sign
  in without a phone.

## 2026-10-05 - Party guest list: phone login lands in the party

- **Context:** the product owner asked for a party login by phone number,
  the number being already associated with the party, so the guest lands
  in it automatically. Association source chosen: a guest list kept by
  staff (not derived from use).
- **Console:** the session page has a "Lista da festa" section. Managers
  paste PT mobile numbers (lines or commas; `lib/domain/phone.ts`
  normalizes `912 345 678`, `+351…`, `00351…`), up to 500 per add, and can
  remove entries. Numbers are stored in `session_guest_list` encrypted plus
  the salted `phone_hash` (B12.5), shown masked, server-only table; every
  add/remove is audited. Ended sessions are read-only.
- **Guest:** `/entrar` (landing pill "Entrar na festa"; staff login moved to
  "Área da equipa") reuses the SMS sign-in. After the code proves the
  number, `partyHref` is the live/paused party whose list holds it (a signed
  zone token of that venue) and the guest is sent there; a guest already
  signed in on that device goes straight in. Not on any live list: a clear
  "we could not find your party" screen with the QR as the fallback.
- **Privacy:** which party a number belongs to is only revealed after the
  SMS code, never from the number alone.
- QR entry is unchanged and still needs no list or sign-in (B1/B4 #3).

## 2026-10-05 - Guest app layout from the mockup (Apple palette and type kept)

- **Context:** the product owner shared a mockup of three guest screens
  ("Pedir faixa", "Fila ao vivo", "Rankings da noite") and asked for its
  layout of functions and buttons only. A first pass also copied its look
  (warm black, gold, Unbounded, serif titles); the owner preferred the
  previous palette and type, so that theme was removed again. The guest
  app keeps the Apple palette + red and SF Pro / Inter like the rest.
- **Chrome:** `app/(guest)/s/[qrToken]/layout.tsx` mounts `PartyChrome`
  once per party: "BETBEAT × venue" top bar (home, top, account), and a
  material tab bar (Pedir faixa → search, Fila ao vivo, Rankings) that
  persists across tabs; hidden on one-request and account screens. Main
  CTAs float above it (`DockCta`, a fade, never a second translucent bar).
- **Screens:** request screen with demand + fit card, selected track card,
  three compact tier cards side by side with the selected promise under
  them, extra value, saved MB WAY number; live queue with the next track
  highlighted; rankings with a top-3 podium and the most requested tracks.
- **Deviations from the mockup, on purpose (kept):** no public amounts per guest
  or per request (B6.7/B6.8, counts instead) and no auction words
  ("licitação", "lance", "oferta"): prices are the tier prices of B4.1.
  No crowd size, ticker or event logo: there is no data for them yet.
  (The NEXT battle below later introduced "oferta" for NEXT offers only.)

## 2026-10-05 - NEXT battle ("Batalha pelo A Seguir")

- **Context:** the product owner asked for a built-in "bet battle" where
  guests compete for the next song, to drive outbidding and revenue.
- **Rule (lib/domain/battle.ts, pure + tested):** until the DJ accepts it,
  the NEXT slot belongs to the highest offer. A new offer must beat the
  holder by `nextBattleIncrementCents` (default 5 €, never above the NEXT
  max). The displaced holder gets the new state-machine event `outbid`:
  demoted to QUEUE with the difference to its quote's QUEUE price refunded
  at once (same money rule as an SLA miss, B4.1), the decision window
  restarts on the QUEUE length, and it can answer by upgrading back to
  NEXT (paying the difference). The DJ's acceptance locks the slot; the
  DJ keeps the final say (B1). Session config `nextBattleEnabled`
  (default on) turns it off: then the first paid NEXT keeps it as before.
- **Not gambling (B1/B4 #7):** no chance anywhere. The highest offer at
  confirmation time decides, losers never pay more than a QUEUE request
  and get everything back if it does not play. UI name is "Batalha"; the
  words "aposta", "apostar", "ganhar" and "odds" are not used, and the
  feature is not called "bet" anywhere a guest can see it.
- **Where it is settled:** when an offer's money lands (MB WAY webhook,
  card hold, upgrade payment), under a per-session transaction advisory
  lock (`pg_advisory_xact_lock`). Not `sessions … FOR UPDATE`: by then the
  webhook has posted ledger rows whose FK holds a KEY SHARE lock on the
  session, and two confirmations upgrading to FOR UPDATE deadlocked in the
  integration test. Reservations only read the holder; settlement is the
  authoritative check, so an offer overtaken while its MB WAY push was out
  simply loses (outbid at confirmation).
- **Schema (migration 0005):** `requests.outbid_at`; the unique index
  `requests_one_active_next_idx` now guards the LOCKED slot (accepted or
  playing). Offers may be pending/paid side by side only inside the
  settlement; at most one paid NEXT exists after every commit (integration
  test: two simultaneous offers → exactly one holder).
- **Exactly-once money:** outbid refunds use the key `outbid:<now>` (a
  request can be outbid more than once); upgrade payments answering the
  Nth outbid use `pay:<id>:upgrade:NEXT:rN`; a lost answer is refunded
  with `upgrade_unavailable:<paymentId>`.
- **Guest UI:** contested NEXT shows a "Batalha" tag, the price to beat
  and the battle rules before paying (B1/B4 #4); the tracking screen shows
  "leading" or "outbid" with the refund and an "answer" button (NEXT
  listed first); queue and home show a battle call-out with the number of
  offers (never amounts, B6.8) and a "join" button.
- **Not done yet:** Console switch for `nextBattleEnabled` and the
  increment (config JSON only for now), a battle badge in the Cockpit, the
  House Screen call-out.
- **Superseded the same day** by slot auctions (next entry): the battle is
  removed once the auction flow replaces the tiers.

## 2026-10-05 - Slot auctions replace the tiers (product owner brief "leilões")

Product owner answers to the plan:
- Auctions REPLACE QUEUE/SOON/NEXT and the dynamic tier pricing. The
  ranking shows who SPENT the most, not who played the most tracks.
- The NEXT battle is removed (auctions replace it).
- Amounts are PUBLIC in auctions and rankings (pride is the point).
  Supersedes B6.7/B6.8 "amounts never public" for this model.
- UI word for the top bidder after the close: "Vencedor" ("ganhar" stays
  forbidden).
- No night spend limit at 150 €: 150 € is the mic-announcement tier, and
  bidding is meant to go past it. Only a configurable safety cap per bid
  (2 000 € by default) against typos/fraud.
- Outbid money stays in the app as balance: usable for the next bids,
  returned at the end of the night or kept for another night (open
  questions on charging model and legal, see phase 2).
- Re-bidding pays only the difference.
- Timing: a slot is its CLOSE time; auction opens 4 min before (specials
  30 min), the DJ plays within 10 min of the close, refund at 15 min; the
  "last song" closes 15 min before the night ends.
- No groups needed: anyone may put money behind any bid ("a favor de").
  Rule: every action (new bid, raising your own, backing someone else's)
  must leave that bid at ≥ top + max(1 €, 5%), so it becomes the top.
- Each bidder's track is fixed per slot.
- Guests appear by their @ handle, a table, or anonymous (default); no
  real names exist in the app.

Phase 1 (done): `lib/auction/` — pure rules, all club-configurable:
`config.ts` (defaults + strict parsing + problems for the Console),
`time.ts` (Lisbon wall clock, midnight and DST; phase times read forward
from the night's local noon so late openings keep the order),
`schedule.ts` (phases, evenly spread slots, specials replacing clashing
regular slots, ~15% of songs cap), `bidding.ts` (increment, quick-bid
totals, server-clock window, soft close +30 s up to +3 min, minimum
price), `recognition.ts` (labels, 50/150/300 € tiers, mic limit per
rolling hour, anonymous never announced). Defaults where the brief gave a
range: ramp 2/h, peak 4/h, close 2/h, specials 10 €, 18 songs/hour.

Phases 2-5 (done, owner said "faz todas as fases, aprovo o que achares
melhor"; choices below are mine and listed as open questions for review):
- Money model: every bid is charged when placed (card/wallet captured at
  once, MB WAY push). Outbid money goes to a per-guest, per-club wallet
  (`wallet_entries`), usable immediately for the next bid; whatever is
  left is refunded to the original payment method at the end of the night
  (`finishNightAuctions`, called first by `endSession`) or on demand
  ("Devolver"). "Keep for another night" is OFF until a legal check
  (stored balance may count as e-money / Banco de Portugal rules).
- Engine `lib/auction/service.ts` (migration 0006): slot rows locked FOR
  UPDATE, per-wallet advisory locks, publish after commit; worker tick
  (1 s) plans, opens, closes, refunds unplayed winners after 15 min and
  expires MB WAY top-ups. DJ reject = refund the winner and reopen a fresh
  4-minute auction at the same price.
- Ranking = money behind winners that actually played, per guest.
- Guest app: auction card on the home screen (server-clock countdown, red
  last minute, "Subir" / "Apoiar" in a sheet, outbid toast + vibration,
  "Vencedor" celebration), bid screen from search (quick totals, @/table/
  anonymous, wallet vs charge breakdown), "As minhas licitações" with the
  wallet, live screen with "A seguir" and winners, ranking by spend.
- DJ cockpit: winner "A seguir" with the 10-minute target, accept / play /
  played / reject-and-reopen, mic alert (name + track, "Anunciado"),
  special moment; open auctions, schedule with pause/resume/cancel and
  "Abrir leilão agora". Venue screen: open auction, "A seguir", ranking
  (amounts per `showAmountOnScreen`).
- Console "Leilões": every rule above per club (`venues.settings.auction`,
  snapshotted onto each night when planned) with a cap preview, plus
  metrics per night and per slot from `auction_slot_metrics`.
- NEXT battle removed (code, UI, messages, tests); the original B4.3 NEXT
  exclusivity test is back. Migration 0005 (`requests.outbid_at` + index)
  stays applied and unused, harmless.
- The tier request API (quotes/requests) still exists for in-flight
  requests and the cockpit queue; the guest app no longer reaches it.

Owner review of the open questions (same day): charge at bid time (kept),
ranking = money behind played winners (kept), DJ reject = reopen (kept).
Balance at the end of the night: **the guest chooses** "Devolver" or
"Guardar para outra noite" (migration 0007 `wallet_preferences`). Only
honoured when the club switches on `keepBalanceAllowed` in Console >
Leilões, which stays OFF by default until the legal check on stored
balances; no expiry for kept balances yet (to be set by that check).

Owner follow-up (same day):
- Kept balances expire after **30 days without movement** (club setting
  `keepBalanceDays`, 1-365): a daily worker job (`wallet-expiry`, 05:30
  UTC, `WORKER_WALLET_EXPIRY_CRON`) refunds them to the payment method.
  Any movement (a new bid, money coming back) restarts the count. It also
  sweeps any other balance left unused that long.
- The night's **first auction opens at the start of the night** (club
  setting `firstAuctionFromStart`, on by default), so it is the longest
  one: with the defaults it runs 23:00 → 01:00 at the ramp price. Later
  auctions keep the 4-minute window (specials 30 min). Applies to nights
  planned from now on (a planned night keeps its snapshot).

## 2026-10-06 - Full music catalog, BPM detection and transition pricing

Owner asks: guests can pick any song (Spotify/Deezer size), search by album
and see its songs, an "AI" tells the BPM and how viable the transition from
the current track is, and harder transitions start at a higher price.

- Catalog = Deezer public API (`CATALOG_PROVIDER=deezer`, no key): search
  with paging ("Mostrar mais"), album search + every song of an album,
  charts ("Em alta agora"), covers. Spotify was not used: its catalog is
  essentially the same, it needs developer credentials, and it no longer
  gives BPM (audio features) to new apps. Deezer's quota is per server IP
  (~50 requests / 5 s): searches are cached 10 min per instance.
- BPM: Deezer's value when present (~30 % of tracks), otherwise measured
  on the server from the 30 s preview (`lib/catalog/tempo.ts`: spectral
  flux + autocorrelation with a 120 BPM prior; 9/10 right on a reference
  set, the miss was half-time). Server-side so a guest cannot fake a tempo.
  Measured by the worker in the background (`tracks.bpm_wanted_at`); the
  bid screen measures on open if still unknown.
- "AI" = a deterministic transition assistant (`lib/auction/transition.ts`),
  not a language model: tempo change after half/double time (easy ≤ 4 %,
  medium ≤ 8 % = the usual pitch range, else hard), one step harder on a
  Camelot key clash when both keys are known. Accurate, instant and free;
  a generative model would guess BPMs.
- Price: a new bid must reach the auction minimum × the difficulty
  multiplier (easy ×1, medium ×1.5, hard ×2.5, unknown ×1.5), editable
  per club in Console › Leilões, enforced in `placeInTx`. Raising or
  backing an existing bid is not re-priced.
- New nights open the full catalog by default; the DJ can still choose
  "Só biblioteca". Library imports now skip songs already in the library.

## 2026-10-06 - "Carregar saldo": load the balance before bidding

- Why: an MB WAY push takes 30-60 s; in the last seconds of an auction that wait loses the slot. Loading once makes every bid instant.
- How: same path as a bid's top-up (intent -> payment -> wallet entry), with no slot and no target. The intent ends `credited` (migration 0010). Card is captured at once; MB WAY credits on confirmation, late confirmations included.
- Amounts 10 / 20 / 50 / 100 € in the UI, 5-200 € accepted by the API. Rate-limited and bot-checked like every money route.
- What is not spent goes back at the end of the night (or is kept, where the club allows it), exactly like any other balance.

## 2026-10-06 - Guest layout: auction-first, centre gavel tab

Product owner brief. Replaces the "Pedir faixa / Fila ao vivo / Rankings" tab bar.

- Tab bar "Agora · Leilão · Ranking". The auction is the raised red gavel in the middle, with a live dot while one is open.
- Leilão tab: pick the auction first (several open = a picker), then its options: bid with a track, raise, back the leader. The next auctions are listed below. Search and the bid screen show which auction the track is for.
- Home "Agora": the playing track is the hero, with the album art as the background and "Escolhida por @x" (or the DJ's pick) under the title. Below it: the live auction (one tap to bid), "A seguir" and only the last 3 winners. The "Fila ao vivo" screen is gone.
- The @ shown under the playing track is the label the winner chose when bidding. Anonymous stays anonymous. The 50 € threshold still governs the venue screen.
- "Carregar saldo" was removed (reverses the entry above): money is asked at bid time. The balance shows only when there is one, as a small pill top right. Tapping it gives "Devolver" and the end-of-night choice.
- Ranking: the top 3 on a podium (1st in the middle, tallest, crown); everyone else below, smaller and muted. Up to 50.
- "O meu @" is the default way to appear. Anonymous and table come second. The last @ is remembered on the phone.
- One shared auction state per party layout (AuctionProvider): one poll, no reload when switching tabs. The last-30-s flash and the winner celebration show on every tab.

## 2026-10-06 - A phone number owns one @

- Product owner: the first time someone gives their number, it gets associated with an @ that follows them.
- `phone_handles` (salted phone hash → @, unique ignoring case). The link is made only when the number is proven: the SMS code, or an MB WAY payment approved in the app (that now also marks the number verified).
- A proven number brings its @ back on any device. An @ owned by another number cannot be used (`handle_taken`, with how to recover it: sign in with the number). A typed, unproven number never counts as ownership, so nobody can borrow someone's @.
- There is no lookup by number from the client: knowing someone's number never reveals their @. The bid form prefills the guest's own @ from `GET /api/guest/profile`.
- MB WAY in development: the mock provider sends nothing to the phone. The waiting screen now says so and shows the simulator buttons. Real requests need the ifthenpay keys (docs/INTEGRATIONS.md).
- Integration tests now hide their "AU …/IT …" tracks from the dev club's library after each run (they were showing up in search and on the home).

## 2026-10-06 - Guests' front door: QR camera + live events; per-event QR

- "/" is now the guests' entry. First comes the camera reading the event's QR: native BarcodeDetector where available, jsQR elsewhere (iPhone). Below it is the list of events live on BetBeat right now. The venue landing moved to /casas.
- The scanner only follows a BetBeat guest path (/s/<token>) and always stays on this site: a QR pointing elsewhere is refused. `Permissions-Policy` now allows the camera for this origin.
- New signed token kind `session`: an event QR opens that event only (through the venue's first zone), never another night at the same venue. The zone QR still opens whatever is live there.
- "Gerar QR code" for the event: on the console event page (manager/admin) and in the cockpit "Sessão" (DJ). Download PNG 1200 px with the quiet zone, share, copy link.
- Listing live events publicly means anyone can join from the list, not only people at the venue. Product owner's call; an opt-in per event can come later if a club wants to stay unlisted.
- Instagram: the winner screen shares a 1080x1920 story image through the phone's share sheet (where Instagram lives). There is no Instagram web intent, so on desktop the image is saved instead.

## 2026-10-07 - Quality pass: performance, accessibility, SEO, polish

Measured in a cloud session without Docker: Postgres 16 with stubbed `auth`/`realtime` schemas plus a tiny local stand-in for Supabase Auth/PostgREST, production build, Lighthouse 12 (mobile) and axe on 33 screens at their B10 viewports.

- Contrast (axe): destructive fills use `ember-700` (white text was 3.4:1 on `ember-500`); red text on `surface-3` chips uses `accent-300`. The cockpit content area is a `<main>`; the landing footer nav has its own label; the empty revenue header cell is a `<td>`.
- Boot intro plays once per tab: a nonce'd inline script reads a `sessionStorage` flag before first paint, so reloads and the "/" → party hand-off no longer replay the 2 s splash. A fresh tab still gets it (the E2E intro test opens a fresh context).
- /casas hero: entrance is a CSS animation instead of `whileInView` opacity, so the headline paints with the HTML instead of waiting for hydration. Below-the-fold blocks keep `Reveal`.
- SEO: localized metadata (`common.meta`), `metadataBase`, Open Graph + Twitter card with a generated 1200x630 share image (Inter subsets in `assets/fonts`, OFL), canonical URLs, `robots.txt`, `sitemap.xml`. Only `/` and `/casas` are indexable; party pages (`/s/…`, signed tokens), `/entrar`, display, cockpit, console and login are `noindex`. Lighthouse SEO on those pages reads lower on purpose.
- Icons: `favicon.ico`, `icon.svg`, a full-bleed `apple-icon.png`, and a maskable 512 icon in both manifests (`id`, `scope`, `lang` added).
- 404 page and a root error boundary; the "QR já não é válido" screen and the /entrar "not on the list" note now link to "/" (camera + live events). The /casas "Entrar na festa" links to "/" too: since 2026-10-06 that is the guests' entry, and /entrar only works for guest lists.
- Venue display: the "Próximo leilão" heading is hidden when nothing is open or scheduled (it was a heading over an empty row on the TV).
- Guest layout preconnects to Supabase (anonymous sign-in and realtime start there).
- `htmlLimitedBots: /.*/` in next.config: Next 15 streamed the page metadata into `<body>` for every client; it now goes in `<head>` (link previews and audits that do not run JS were missing the description).
- /casas copy caught up with the auction-first guest app (2026-10-06): the hero, step 2 and the guarantee no longer describe the old "Na Fila / Em Breve / A Seguir" tiers; they describe bidding and the balance refund, in the same words the guest app uses.
- Storybook stories used real artists and track titles; replaced with the fictional seed names (A2.5).
- List cover images load lazily; the MFA QR alt text moved to translations.

## 2026-10-07 - Big moments: intro, last 30 s, gavel, winner

Product owner asked for better animation quality on the logo, the auction ending and the win. Reviewed frame by frame on `/dev/motion` (dev-only stage; `?scene=intro|final|win`).

- Countdowns (guest card, teaser, strip, venue display, "next opens") roll digit by digit like a mechanical clock (`TickingCountdown`, springDefault); only changed digits move. The leader's amount rolls the same way. The looping `animate-pulse` on the last minute is gone (B10.6: no loops except live indicators).
- Last 30 s: the edge glow beats once per second, on the second the digits roll, driven per tick with Web Animations on opacity (`FinalStretchFrame`). The old 1 s box-shadow keyframes repainted the whole viewport every frame and drifted out of step with the clock. Last 10 s: each beat is the BetBeat lub-dub. The digits tick (scale 1.08 → 1) on the beat; cards just run hot (static red border + glow) instead of flashing. Last 5 s of an auction I am in: a 12 ms haptic tick per second. Never more than two pulses a second (under the 3 Hz flash limit). Reduced motion: steady red edge, digits cross-fade.
- Closing: the gavel strikes (springMomentum: a blow may overshoot) with a ring from the point of impact and one 40 ms buzz for guests in the auction, timed to the impact.
- Logo intro: on leaving, the mark comes towards the viewer (scale 1.9) and dissolves as the black lifts, instead of a flat fade. The CSS safety fallback moved to 2.8 s so it no longer cuts the exit.
- Winner: a bottom scrim keeps the amount, track and hint readable over the confetti and rays.
- Party screens arrive with a 240 ms rise + fade (`template.tsx`, CSS only).
- The intro's nonce'd inline script carries `suppressHydrationWarning` (browsers hide nonce attributes after load, which React reported as a mismatch).
- Losing the lead shakes the auction card once (the iOS "no"); taking it lifts it slightly. The leader's amount rolls like the countdown.
- The venue display also shows the gavel strike at 0:00.
- Party-screen entrance plays only on navigation, not on the first load (keeps LCP and the server markup intact).
- Toasts sit above the guest tab bar and its raised gavel (`body:has([data-guest-dock])`); before, "Foste ultrapassado" covered the Leilão button for 4 s.
