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
