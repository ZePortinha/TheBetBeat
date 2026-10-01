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

## 2026-10-02 — Session "active now" seed

- **Context:** Dev/demo needs a live session whenever `db:reset` runs.
- **Decision:** Seed session starts `now()-1h`, ends `now()+5h`, status `live`.
- **Rejected:** Fixed timestamps — would go stale immediately.
